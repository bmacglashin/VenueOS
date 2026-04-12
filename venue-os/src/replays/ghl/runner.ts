import type { Database, Json } from "@/src/lib/db/supabase";
import type { RouteInboundMessageResult } from "@/src/lib/llm/router";
import type {
  ClaimProcessedWebhookEventInput,
  ClaimProcessedWebhookEventResult,
  MarkProcessedWebhookEventInput,
  ReleaseProcessedWebhookEventClaimInput,
} from "@/src/services/processed-webhook-events";
import { classifyCandidateResponseForSafeSend } from "@/src/services/safe-send-classifier";
import { resolveOutboundMode } from "@/src/services/outbound-control";
import { evaluateResponsePolicy } from "@/src/services/response-policy";
import {
  createConversationOrchestrator,
  type OrchestrateConversationTurnResult,
} from "@/src/services/conversation-orchestrator-core";
import { dispatchOutboundTransportCore } from "@/src/services/outbound-transport-core";
import { createWebhookPostHandler } from "@/src/app/api/ghl-webhook/handler";

import {
  getGhlReplayFixtureById,
  listGhlReplayFixtures,
  type ReplayFixture,
  type ReplayFixtureRecentMessage,
} from "./fixture-library";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];
type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];
type ProcessedWebhookEvent =
  Database["public"]["Tables"]["processed_webhook_events"]["Row"];

const FIXTURE_SOURCE = "ghl_replay_fixture";
const FIXTURE_ROUTER_MODEL = "ghl-replay-router";
const FIXTURE_RESPONSE_MODEL = "ghl-replay-response";
const FIXTURE_PROMPT_VERSION = "shift-12h-03-replay-v1" as const;

interface ReplayRunState {
  processedWebhookEvents: Map<string, ProcessedWebhookEvent>;
  nextProcessedWebhookEventId: number;
}

interface ReplayFixtureState {
  fixture: ReplayFixture;
  tenant: Tenant;
  conversation: Conversation;
  recentMessages: Message[];
}

interface ReplayCheck {
  name: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  reason: string;
}

interface ReplayLogEntry {
  level: "info" | "warn" | "error";
  event: string;
  runId: string;
  fixtureId?: string;
  sequence?: number;
  [key: string]: Json | string | number | boolean | null | undefined;
}

export interface ReplayFixtureResult {
  runId: string;
  sequence: number;
  fixtureId: string;
  entity: ReplayFixture["entity"];
  description: string;
  pass: boolean;
  requestId: string;
  traceId: string;
  idempotencyKey: string;
  response: {
    accepted: boolean;
    duplicate: boolean;
    errorType: string | null;
    message: string;
    requestId: string;
    traceId: string;
    conversationId: string | null;
    inboundMessageId: string | null;
    aiDraftMessageId: string | null;
  };
  actual: {
    routeCategory: string | null;
    policyDecision: string | null;
    outboundAction: string | null;
    transportOutcome: string | null;
    auditEvents: string[];
  };
  checks: ReplayCheck[];
}

export interface ReplayRunSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface ReplayRunResult {
  runId: string;
  summary: ReplayRunSummary;
  results: ReplayFixtureResult[];
}

export interface ReplayRunOptions {
  runId?: string;
  fixtureIds?: readonly string[];
  logger?: {
    write: (entry: ReplayLogEntry) => void;
  };
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function createStructuredLogger(logger: ReplayRunOptions["logger"]) {
  if (logger != null) {
    return logger;
  }

  return {
    write(entry: ReplayLogEntry) {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    },
  };
}

function buildRunId(seed?: string): string {
  const trimmed = seed?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : "ghl-replay-local";
}

function buildRequestId(runId: string, sequence: number, fixtureId: string) {
  return `${runId}:${String(sequence).padStart(2, "0")}:${fixtureId}:request`;
}

function buildTraceId(runId: string, sequence: number, fixtureId: string) {
  return `${runId}:${String(sequence).padStart(2, "0")}:${fixtureId}:trace`;
}

function buildProcessedWebhookEventId(index: number): string {
  return `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`;
}

function buildMessageRow(
  fixture: ReplayFixture,
  input: {
    id: string;
    direction: "inbound" | "outbound";
    role: string;
    content: string;
    source: string;
    status: string;
    ghlMessageId?: string | null;
    metadata?: Json;
    rawPayload?: Json;
    policyDecision?: string | null;
    policyReasons?: Json;
    policyEvaluatedAt?: string | null;
    createdAt: string;
    updatedAt?: string;
  }
): Message {
  return {
    id: input.id,
    conversation_id: fixture.ids.conversationId,
    role: input.role,
    content: input.content,
    direction: input.direction,
    ghl_message_id: input.ghlMessageId ?? null,
    source: input.source,
    status: input.status,
    raw_payload: input.rawPayload ?? {},
    metadata: input.metadata ?? {},
    policy_decision:
      (input.policyDecision as Message["policy_decision"]) ?? null,
    policy_reasons: (input.policyReasons as Message["policy_reasons"]) ?? [],
    policy_evaluated_at:
      (input.policyEvaluatedAt as Message["policy_evaluated_at"]) ?? null,
    created_at: input.createdAt,
    updated_at: input.updatedAt ?? input.createdAt,
  };
}

function buildRecentMessageRow(
  fixture: ReplayFixture,
  recentMessage: ReplayFixtureRecentMessage
): Message {
  return buildMessageRow(fixture, {
    id: recentMessage.id,
    direction: recentMessage.direction,
    role: recentMessage.role,
    content: recentMessage.content,
    source: recentMessage.source ?? FIXTURE_SOURCE,
    status: recentMessage.status ?? "recorded",
    createdAt: recentMessage.createdAt,
    updatedAt: recentMessage.updatedAt ?? recentMessage.createdAt,
  });
}

function buildFixtureState(fixture: ReplayFixture): ReplayFixtureState {
  return {
    fixture,
    tenant: {
      id: fixture.tenant.id,
      name: fixture.tenant.name,
      slug: fixture.tenant.slug,
      ghl_location_id: fixture.tenant.ghlLocationId,
      outbound_mode_override:
        fixture.overrides?.outboundMode?.tenantOverride ?? null,
      created_at: fixture.clock.now,
      updated_at: fixture.clock.now,
    },
    conversation: {
      id: fixture.ids.conversationId,
      tenant_id: fixture.tenant.id,
      ghl_contact_id: fixture.webhook.ghlContactId,
      ghl_conversation_id: fixture.webhook.ghlConversationId,
      status: "open",
      created_at: fixture.clock.now,
      updated_at: fixture.clock.now,
    },
    recentMessages: fixture.recentMessages.map((message) =>
      buildRecentMessageRow(fixture, message)
    ),
  };
}

function buildFixtureRouteResult(
  fixture: ReplayFixture
): RouteInboundMessageResult {
  const classification = fixture.router.classification;
  const recentMessageCount = fixture.recentMessages.length;
  const replySource =
    fixture.router.replySource ??
    (classification.category === "unknown_needs_review"
      ? "premium_holding"
      : "venue_model");

  return {
    classification,
    aiReply: fixture.router.aiReply,
    metadata: {
      observability: {
        requestId: "fixture_request_id",
        traceId: "fixture_trace_id",
      },
      knowledgeSource: "getVenueKnowledge",
      knowledgeContextCharacters: 0,
      recentMessageCount,
      replySource,
      classificationMetadata: {
        provider: "google.generative-ai",
        model: FIXTURE_ROUTER_MODEL,
        promptVersion: FIXTURE_PROMPT_VERSION,
        purpose: "inbound_message_routing",
      },
      responseMetadata:
        replySource === "premium_holding"
          ? null
          : {
              provider: "google.generative-ai",
              model: FIXTURE_RESPONSE_MODEL,
              mode: classification.category,
              promptVersion: FIXTURE_PROMPT_VERSION,
              classificationSource: "mode",
              recentMessageCount,
              knowledgeContextItems: 0,
            },
      persistence: {
        venueId: fixture.tenant.id,
        venueName: fixture.tenant.name,
        conversationId: fixture.ids.conversationId,
        receivedAt: fixture.webhook.receivedAt,
        routedAt: fixture.clock.now,
        routeCategory: classification.category,
        routeConfidence: classification.confidence,
        requiresHumanReview: classification.requiresHumanReview,
        rationale: classification.rationale,
        replySource,
      },
    },
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function buildCheck(input: {
  name: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  reason: string;
}): ReplayCheck {
  return {
    name: input.name,
    pass: input.pass,
    expected: input.expected,
    actual: input.actual,
    reason: input.reason,
  };
}

function buildReplayTransportEnv(locationId: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GHL_EXECUTION_MODE: "dry_run",
    GHL_WRITE_KILL_SWITCH: "true",
    GHL_API_KEY: "replay-ghl-key",
    GHL_LOCATION_ID: locationId,
    GHL_BASE_URL: "https://services.example.com",
  };
}

async function withStructuredConsoleCapture<T>(
  input: {
    runId: string;
    fixtureId: string;
    sequence: number;
    logger: ReturnType<typeof createStructuredLogger>;
  },
  fn: () => Promise<T>
): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  function writeConsoleEvent(
    level: ReplayLogEntry["level"],
    args: unknown[]
  ) {
    const [first, ...rest] = args;
    const message =
      typeof first === "string"
        ? first
        : JSON.stringify(toJsonValue(first));

    input.logger.write({
      level,
      event: "ghl.replay.console",
      runId: input.runId,
      fixtureId: input.fixtureId,
      sequence: input.sequence,
      message,
      context:
        rest.length > 0 ? toJsonValue(rest.length === 1 ? rest[0] : rest) : null,
    });
  }

  console.log = (...args: unknown[]) => writeConsoleEvent("info", args);
  console.info = (...args: unknown[]) => writeConsoleEvent("info", args);
  console.warn = (...args: unknown[]) => writeConsoleEvent("warn", args);
  console.error = (...args: unknown[]) => writeConsoleEvent("error", args);

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function buildWebhookRequestBody(fixture: ReplayFixture) {
  return {
    eventType: fixture.webhook.eventType,
    eventId: fixture.webhook.eventId,
    locationId: fixture.tenant.ghlLocationId,
    contactId: fixture.webhook.ghlContactId,
    conversationId: fixture.webhook.ghlConversationId,
    messageId: fixture.webhook.ghlMessageId,
    messageBody: fixture.webhook.messageBody,
    receivedAt: fixture.webhook.receivedAt,
    payload: {
      entity: fixture.entity,
      eventType: fixture.webhook.eventType,
      [fixture.entity]: fixture.webhook.payload,
    },
  };
}

function buildIdempotencyMapKey(input: {
  source: string;
  idempotencyKey: string;
}) {
  return `${input.source}::${input.idempotencyKey}`;
}

function createReplayPostHandler(input: {
  fixture: ReplayFixture;
  fixtureState: ReplayFixtureState;
  runState: ReplayRunState;
  auditEvents: string[];
  logger: ReturnType<typeof createStructuredLogger>;
  runId: string;
  sequence: number;
  capture: {
    orchestrationResult: OrchestrateConversationTurnResult | null;
  };
}) {
  const fixtureOutboundMode = input.fixture.overrides?.outboundMode;
  const orchestrator = createConversationOrchestrator({
    resolveConversation: async () => input.fixtureState.conversation,
    fetchRecentMessages: async () => input.fixtureState.recentMessages,
    findMessageByGhlMessageId: async () => null,
    routeInboundMessage: async () => buildFixtureRouteResult(input.fixture),
    insertInboundMessage: async (messageInput) =>
      buildMessageRow(input.fixture, {
        id: input.fixture.ids.inboundMessageId,
        direction: "inbound",
        role: messageInput.role,
        content: messageInput.content,
        source: messageInput.source,
        status: messageInput.status ?? "recorded",
        ghlMessageId: messageInput.ghlMessageId ?? null,
        rawPayload: messageInput.rawPayload,
        metadata: messageInput.metadata,
        createdAt: input.fixture.clock.now,
      }),
    insertOutboundMessage: async (messageInput) =>
      buildMessageRow(input.fixture, {
        id: input.fixture.ids.aiDraftMessageId,
        direction: "outbound",
        role: messageInput.role,
        content: messageInput.content,
        source: messageInput.source,
        status: messageInput.status ?? "draft",
        ghlMessageId: messageInput.ghlMessageId ?? null,
        rawPayload: messageInput.rawPayload,
        metadata: messageInput.metadata,
        policyDecision: messageInput.policyDecision ?? null,
        policyReasons: toJsonValue(messageInput.policyReasons ?? []),
        policyEvaluatedAt: messageInput.policyEvaluatedAt ?? null,
        createdAt: input.fixture.clock.now,
      }),
    insertAuditLog: async (auditInput) => {
      input.auditEvents.push(auditInput.eventType);
      return auditInput;
    },
    classifyCandidateResponseForSafeSend: (classifierInput) =>
      classifyCandidateResponseForSafeSend({
        ...classifierInput,
        pricingVerification: input.fixture.router.pricingVerification,
        availabilityVerification: input.fixture.router.availabilityVerification,
      }),
    evaluateResponsePolicy,
    resolveOutboundMode: async () =>
      resolveOutboundMode({
        globalMode: fixtureOutboundMode?.globalMode ?? "enabled",
        tenantOverride: fixtureOutboundMode?.tenantOverride ?? null,
      }),
    dispatchOutboundTransport: async (dispatchInput) =>
      dispatchOutboundTransportCore(dispatchInput, {
        env: buildReplayTransportEnv(input.fixture.tenant.ghlLocationId),
        locationId: input.fixture.tenant.ghlLocationId,
      }),
    now: () => new Date(input.fixture.clock.now),
  });

  return createWebhookPostHandler({
    getTenantByGhlLocationId: async ({ ghlLocationId }) =>
      ghlLocationId === input.fixture.tenant.ghlLocationId
        ? {
            id: input.fixtureState.tenant.id,
            name: input.fixtureState.tenant.name,
          }
        : null,
    insertAuditLog: async (auditInput) => {
      input.auditEvents.push(auditInput.eventType);
      return auditInput;
    },
    orchestrateConversationTurn: async (requestInput) => {
      const result = await orchestrator(requestInput);
      input.capture.orchestrationResult = result;
      return result;
    },
    claimProcessedWebhookEvent: async (
      claimInput: ClaimProcessedWebhookEventInput
    ): Promise<ClaimProcessedWebhookEventResult> => {
      const mapKey = buildIdempotencyMapKey({
        source: claimInput.source,
        idempotencyKey: claimInput.idempotencyKey,
      });
      const existingRecord = input.runState.processedWebhookEvents.get(mapKey);

      if (existingRecord != null) {
        return {
          claimed: false,
          record: existingRecord,
        };
      }

      const record: ProcessedWebhookEvent = {
        id: buildProcessedWebhookEventId(
          input.runState.nextProcessedWebhookEventId++
        ),
        source: claimInput.source,
        idempotency_key: claimInput.idempotencyKey,
        tenant_id: claimInput.tenantId ?? null,
        status: "processing",
        upstream_event_id: claimInput.upstreamEventId ?? null,
        upstream_message_id: claimInput.upstreamMessageId ?? null,
        request_id: claimInput.requestId,
        trace_id: claimInput.traceId,
        payload: claimInput.payload ?? {},
        response_payload: {},
        created_at: input.fixture.clock.now,
        updated_at: input.fixture.clock.now,
      };

      input.runState.processedWebhookEvents.set(mapKey, record);

      input.logger.write({
        level: "info",
        event: "ghl.replay.idempotency.claimed",
        runId: input.runId,
        fixtureId: input.fixture.id,
        sequence: input.sequence,
        idempotencyKey: claimInput.idempotencyKey,
      });

      return {
        claimed: true,
        record,
      };
    },
    markProcessedWebhookEvent: async (markInput: MarkProcessedWebhookEventInput) => {
      const mapKey = buildIdempotencyMapKey({
        source: markInput.source,
        idempotencyKey: markInput.idempotencyKey,
      });
      const existingRecord = input.runState.processedWebhookEvents.get(mapKey);

      if (existingRecord == null) {
        throw new Error(
          `Missing processed webhook event for ${markInput.source}:${markInput.idempotencyKey}.`
        );
      }

      const updatedRecord: ProcessedWebhookEvent = {
        ...existingRecord,
        tenant_id: markInput.tenantId ?? existingRecord.tenant_id,
        status: "processed",
        request_id: markInput.requestId ?? existingRecord.request_id,
        trace_id: markInput.traceId ?? existingRecord.trace_id,
        payload:
          markInput.payload !== undefined
            ? toJsonValue(markInput.payload)
            : existingRecord.payload,
        response_payload:
          markInput.responsePayload !== undefined
            ? toJsonValue(markInput.responsePayload)
            : existingRecord.response_payload,
        updated_at: input.fixture.clock.now,
      };

      input.runState.processedWebhookEvents.set(mapKey, updatedRecord);
      return updatedRecord;
    },
    releaseProcessedWebhookEventClaim: async (
      releaseInput: ReleaseProcessedWebhookEventClaimInput
    ) => {
      const mapKey = buildIdempotencyMapKey({
        source: releaseInput.source,
        idempotencyKey: releaseInput.idempotencyKey,
      });
      input.runState.processedWebhookEvents.delete(mapKey);
    },
  });
}

function buildChecks(input: {
  fixture: ReplayFixture;
  response: ReplayFixtureResult["response"];
  actual: ReplayFixtureResult["actual"];
}): ReplayCheck[] {
  return [
    buildCheck({
      name: "response.accepted",
      pass: input.response.accepted === input.fixture.expect.response.accepted,
      expected: input.fixture.expect.response.accepted,
      actual: input.response.accepted,
      reason: "Replay response.accepted should match the fixture expectation.",
    }),
    buildCheck({
      name: "response.duplicate",
      pass: input.response.duplicate === input.fixture.expect.response.duplicate,
      expected: input.fixture.expect.response.duplicate,
      actual: input.response.duplicate,
      reason: "Replay response.duplicate should match the fixture expectation.",
    }),
    buildCheck({
      name: "response.errorType",
      pass: input.response.errorType === input.fixture.expect.response.errorType,
      expected: input.fixture.expect.response.errorType,
      actual: input.response.errorType,
      reason: "Replay response.errorType should match the fixture expectation.",
    }),
    buildCheck({
      name: "response.requestId",
      pass: input.response.requestId.length > 0,
      expected: "non-empty request id",
      actual: input.response.requestId,
      reason: "Replay response should propagate a request ID.",
    }),
    buildCheck({
      name: "response.traceId",
      pass: input.response.traceId.length > 0,
      expected: "non-empty trace id",
      actual: input.response.traceId,
      reason: "Replay response should propagate a trace ID.",
    }),
    buildCheck({
      name: "response.conversationId",
      pass:
        input.response.conversationId === input.fixture.expect.ids.conversationId,
      expected: input.fixture.expect.ids.conversationId,
      actual: input.response.conversationId,
      reason: "Replay response conversationId should match the fixture snapshot.",
    }),
    buildCheck({
      name: "response.inboundMessageId",
      pass:
        input.response.inboundMessageId ===
        input.fixture.expect.ids.inboundMessageId,
      expected: input.fixture.expect.ids.inboundMessageId,
      actual: input.response.inboundMessageId,
      reason:
        "Replay response inboundMessageId should match the fixture snapshot.",
    }),
    buildCheck({
      name: "response.aiDraftMessageId",
      pass:
        input.response.aiDraftMessageId ===
        input.fixture.expect.ids.aiDraftMessageId,
      expected: input.fixture.expect.ids.aiDraftMessageId,
      actual: input.response.aiDraftMessageId,
      reason:
        "Replay response aiDraftMessageId should match the fixture snapshot.",
    }),
    buildCheck({
      name: "orchestration.routeCategory",
      pass: input.actual.routeCategory === input.fixture.expect.routeCategory,
      expected: input.fixture.expect.routeCategory,
      actual: input.actual.routeCategory,
      reason: "Replay route category should match the fixture expectation.",
    }),
    buildCheck({
      name: "orchestration.policyDecision",
      pass: input.actual.policyDecision === input.fixture.expect.policyDecision,
      expected: input.fixture.expect.policyDecision,
      actual: input.actual.policyDecision,
      reason: "Replay policy decision should match the fixture expectation.",
    }),
    buildCheck({
      name: "orchestration.outboundAction",
      pass: input.actual.outboundAction === input.fixture.expect.outboundAction,
      expected: input.fixture.expect.outboundAction,
      actual: input.actual.outboundAction,
      reason: "Replay outbound action should match the fixture expectation.",
    }),
    buildCheck({
      name: "orchestration.transportOutcome",
      pass:
        input.actual.transportOutcome === input.fixture.expect.transportOutcome,
      expected: input.fixture.expect.transportOutcome,
      actual: input.actual.transportOutcome,
      reason: "Replay transport outcome should match the fixture expectation.",
    }),
    buildCheck({
      name: "audit.events",
      pass: arraysEqual(
        input.actual.auditEvents,
        [...input.fixture.expect.auditEvents]
      ),
      expected: input.fixture.expect.auditEvents,
      actual: input.actual.auditEvents,
      reason: "Replay audit event sequence should match the fixture expectation.",
    }),
  ];
}

async function runReplayFixture(input: {
  fixture: ReplayFixture;
  runId: string;
  sequence: number;
  runState: ReplayRunState;
  logger: ReturnType<typeof createStructuredLogger>;
}): Promise<ReplayFixtureResult> {
  const fixtureState = buildFixtureState(input.fixture);
  const auditEvents: string[] = [];
  const capture = {
    orchestrationResult: null as OrchestrateConversationTurnResult | null,
  };
  const requestId = buildRequestId(input.runId, input.sequence, input.fixture.id);
  const traceId = buildTraceId(input.runId, input.sequence, input.fixture.id);
  const idempotencyKey = `event:${input.fixture.webhook.eventId}`;
  const POST = createReplayPostHandler({
    fixture: input.fixture,
    fixtureState,
    runState: input.runState,
    auditEvents,
    logger: input.logger,
    runId: input.runId,
    sequence: input.sequence,
    capture,
  });

  input.logger.write({
    level: "info",
    event: "ghl.replay.fixture.started",
    runId: input.runId,
    fixtureId: input.fixture.id,
    sequence: input.sequence,
    entity: input.fixture.entity,
    idempotencyKey,
  });

  const response = await withStructuredConsoleCapture(
    {
      runId: input.runId,
      fixtureId: input.fixture.id,
      sequence: input.sequence,
      logger: input.logger,
    },
    async () =>
      POST(
        new Request("https://example.test/api/ghl-webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            "x-trace-id": traceId,
            "x-ghl-event-id": input.fixture.webhook.eventId,
          },
          body: JSON.stringify(buildWebhookRequestBody(input.fixture)),
        })
      )
  );

  const responseBody = (await response.json()) as ReplayFixtureResult["response"];
  const actual = {
    routeCategory: capture.orchestrationResult?.classification.category ?? null,
    policyDecision: capture.orchestrationResult?.policy.decision ?? null,
    outboundAction: capture.orchestrationResult?.outboundDecision.action ?? null,
    transportOutcome:
      capture.orchestrationResult?.outboundTransport?.outcome ?? null,
    auditEvents,
  };
  const checks = buildChecks({
    fixture: input.fixture,
    response: responseBody,
    actual,
  });
  const pass = checks.every((check) => check.pass);
  const result: ReplayFixtureResult = {
    runId: input.runId,
    sequence: input.sequence,
    fixtureId: input.fixture.id,
    entity: input.fixture.entity,
    description: input.fixture.description,
    pass,
    requestId,
    traceId,
    idempotencyKey,
    response: responseBody,
    actual,
    checks,
  };

  input.logger.write({
    level: pass ? "info" : "error",
    event: "ghl.replay.fixture.completed",
    runId: input.runId,
    fixtureId: input.fixture.id,
    sequence: input.sequence,
    pass,
    duplicate: responseBody.duplicate,
    routeCategory: actual.routeCategory,
    policyDecision: actual.policyDecision,
    outboundAction: actual.outboundAction,
    transportOutcome: actual.transportOutcome,
  });

  return result;
}

function resolveFixtures(fixtureIds?: readonly string[]): readonly ReplayFixture[] {
  if (fixtureIds == null || fixtureIds.length === 0) {
    return listGhlReplayFixtures();
  }

  return fixtureIds.map((fixtureId) => {
    const fixture = getGhlReplayFixtureById(fixtureId);

    if (fixture == null) {
      throw new Error(`Unknown GHL replay fixture "${fixtureId}".`);
    }

    return fixture;
  });
}

export async function runGhlReplaySuite(
  options: ReplayRunOptions = {}
): Promise<ReplayRunResult> {
  const logger = createStructuredLogger(options.logger);
  const runId = buildRunId(options.runId);
  const fixtures = resolveFixtures(options.fixtureIds);
  const runState: ReplayRunState = {
    processedWebhookEvents: new Map<string, ProcessedWebhookEvent>(),
    nextProcessedWebhookEventId: 1,
  };
  const results: ReplayFixtureResult[] = [];

  logger.write({
    level: "info",
    event: "ghl.replay.run.started",
    runId,
    fixtureCount: fixtures.length,
    mode: "dry_run",
    liveWritesEnabled: false,
  });

  for (const [index, fixture] of fixtures.entries()) {
    results.push(
      await runReplayFixture({
        fixture,
        runId,
        sequence: index + 1,
        runState,
        logger,
      })
    );
  }

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
  };

  logger.write({
    level: summary.failed === 0 ? "info" : "error",
    event: "ghl.replay.run.completed",
    runId,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    mode: "dry_run",
  });

  return {
    runId,
    summary,
    results,
  };
}

function formatFailureChecks(result: ReplayFixtureResult): string[] {
  return result.checks
    .filter((check) => !check.pass)
    .map(
      (check) =>
        `  - ${check.name}: ${check.reason} Expected ${JSON.stringify(
          check.expected
        )}, got ${JSON.stringify(check.actual)}.`
    );
}

export function formatGhlReplaySummary(result: ReplayRunResult): string {
  const lines = [
    `Replay run ${result.runId}: ${result.summary.passed}/${result.summary.total} passed, ${result.summary.failed} failed`,
  ];

  for (const fixtureResult of result.results) {
    lines.push(
      `${fixtureResult.pass ? "PASS" : "FAIL"} ${fixtureResult.fixtureId} [${
        fixtureResult.entity
      }] accepted=${fixtureResult.response.accepted} duplicate=${
        fixtureResult.response.duplicate
      } route=${fixtureResult.actual.routeCategory ?? "none"} policy=${
        fixtureResult.actual.policyDecision ?? "none"
      } outbound=${fixtureResult.actual.outboundAction ?? "none"} transport=${
        fixtureResult.actual.transportOutcome ?? "none"
      } trace=${fixtureResult.response.traceId}`
    );

    if (!fixtureResult.pass) {
      lines.push(...formatFailureChecks(fixtureResult));
    }
  }

  return lines.join("\n");
}
