import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RouteInboundMessageResult } from "../lib/llm/router";
import type { Database, Json } from "../lib/db/supabase";
import { createConversationOrchestrator } from "../services/conversation-orchestrator-core";
import { evaluateResponsePolicy } from "../services/response-policy";
import { classifyCandidateResponseForSafeSend } from "../services/safe-send-classifier";
import {
  evalFixtureSchema,
  type EvalFixture,
} from "./fixture-schema";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

export const EVAL_ARTIFACT_VERSION = 1 as const;
export const EVAL_BASELINE_VERSION = "v1" as const;

const FIXTURE_SOURCE = "eval_fixture";
const FIXTURE_ROUTER_MODEL = "eval-fixture-router";
const FIXTURE_RESPONSE_MODEL = "eval-fixture-response";
const FIXTURE_PROMPT_VERSION = "shift-3-v1" as const;

export interface LoadedEvalFixture extends EvalFixture {
  filePath: string;
  relativePath: string;
}

export interface EvalCaseResult {
  caseId: string;
  description: string;
  fixtureFile: string;
  route: {
    classification: RouteInboundMessageResult["classification"]["category"];
    confidence: number;
    requiresHumanReview: boolean;
    rationale: string;
  };
  draft: {
    content: string;
    source: string;
    status: string;
  };
  policy: {
    decision: string;
    reasons: Array<{ code: string; detail: string }>;
    transportAllowed: boolean;
  };
  safeSend: {
    escalationSignal: boolean;
    pricingDiscussed: boolean;
    availabilityDiscussed: boolean;
    pricingVerification: string;
    availabilityVerification: string;
  };
}

export interface EvalArtifactIndex {
  artifactVersion: typeof EVAL_ARTIFACT_VERSION;
  baselineVersion: typeof EVAL_BASELINE_VERSION;
  totalCases: number;
  summaries: {
    routes: Record<string, number>;
    policyDecisions: Record<string, number>;
  };
  cases: EvalCaseResult[];
}

function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatIssuePath(pathSegments: ReadonlyArray<PropertyKey>): string {
  if (pathSegments.length === 0) {
    return "(root)";
  }

  return pathSegments
    .map((segment) =>
      typeof segment === "number" ? `[${segment}]` : String(segment)
    )
    .join(".");
}

function buildValidationErrorMessage(
  relativePath: string,
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>
): string {
  const details = issues
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");

  return `Invalid eval fixture ${relativePath}: ${details}`;
}

function createConversationRow(fixture: LoadedEvalFixture): Conversation {
  const now = fixture.clock.now;

  return {
    id: fixture.input.conversation.id,
    tenant_id: fixture.input.tenantId,
    ghl_contact_id: fixture.input.conversation.ghlContactId ?? null,
    ghl_conversation_id: fixture.input.conversation.ghlConversationId ?? null,
    status: fixture.input.conversation.status ?? "open",
    created_at: now,
    updated_at: now,
  };
}

function createMessageId(index: number): string {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

function createStoredMessage(input: {
  id: string;
  conversationId: string;
  role: string;
  direction: string;
  content: string;
  source: string;
  status: string;
  ghlMessageId?: string | null;
  rawPayload?: Json;
  metadata?: Json;
  policyDecision?: string | null;
  policyReasons?: Json;
  policyEvaluatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}): Message {
  return {
    id: input.id,
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    direction: input.direction,
    ghl_message_id: input.ghlMessageId ?? null,
    source: input.source,
    status: input.status,
    raw_payload: input.rawPayload ?? {},
    metadata: input.metadata ?? {},
    policy_decision: input.policyDecision ?? null,
    policy_reasons: input.policyReasons ?? [],
    policy_evaluated_at: input.policyEvaluatedAt ?? null,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  };
}

function createRecentMessages(fixture: LoadedEvalFixture): Message[] {
  return fixture.recentMessages.map((message, index) =>
    createStoredMessage({
      id: message.id ?? createMessageId(index + 1),
      conversationId: fixture.input.conversation.id,
      role: message.role,
      direction: message.direction,
      content: message.content,
      source: message.source ?? FIXTURE_SOURCE,
      status: message.status ?? "recorded",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt ?? message.createdAt,
    })
  );
}

function buildFixtureRouteResult(
  fixture: LoadedEvalFixture
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
        venueId: fixture.input.venue.id,
        venueName: fixture.input.venue.venueName,
        conversationId: fixture.input.conversation.id,
        routedAt: fixture.clock.now,
        receivedAt: fixture.input.inbound.receivedAt,
        routeCategory: classification.category,
        routeConfidence: classification.confidence,
        requiresHumanReview: classification.requiresHumanReview,
        rationale: classification.rationale,
        replySource,
      },
    },
  };
}

function summarizeCounts(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export async function loadEvalFixtures(
  directoryPath: string
): Promise<LoadedEvalFixture[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const fixtureFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (fixtureFiles.length === 0) {
    throw new Error(`No eval fixtures were found in ${directoryPath}.`);
  }

  const loadedFixtures = await Promise.all(
    fixtureFiles.map(async (filePath) => {
      const relativePath = path.relative(directoryPath, filePath);
      const rawContent = await readFile(filePath, "utf8");

      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(rawContent);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown JSON parse error";
        throw new Error(`Invalid eval fixture ${relativePath}: ${message}`);
      }

      const parsedFixture = evalFixtureSchema.safeParse(parsedJson);

      if (!parsedFixture.success) {
        throw new Error(
          buildValidationErrorMessage(relativePath, parsedFixture.error.issues)
        );
      }

      return {
        ...parsedFixture.data,
        filePath,
        relativePath,
      } satisfies LoadedEvalFixture;
    })
  );

  const seenIds = new Map<string, string>();

  loadedFixtures.forEach((fixture) => {
    const existing = seenIds.get(fixture.id);

    if (existing != null) {
      throw new Error(
        `Duplicate eval fixture id "${fixture.id}" found in ${existing} and ${fixture.relativePath}.`
      );
    }

    seenIds.set(fixture.id, fixture.relativePath);
  });

  return loadedFixtures.sort((left, right) => left.id.localeCompare(right.id));
}

export async function runEvalFixture(
  fixture: LoadedEvalFixture
): Promise<EvalCaseResult> {
  const conversation = createConversationRow(fixture);
  const recentMessages = createRecentMessages(fixture);
  let messageSequence = recentMessages.length + 100;

  const orchestrateConversationTurn = createConversationOrchestrator({
    resolveConversation: async () => conversation,
    fetchRecentMessages: async () => recentMessages,
    routeInboundMessage: async () => buildFixtureRouteResult(fixture),
    insertInboundMessage: async (input) =>
      createStoredMessage({
        id: createMessageId(messageSequence++),
        conversationId: input.conversationId,
        role: input.role,
        direction: "inbound",
        content: input.content,
        source: input.source,
        status: input.status ?? "recorded",
        ghlMessageId: input.ghlMessageId ?? null,
        rawPayload: input.rawPayload,
        metadata: input.metadata,
        createdAt: fixture.clock.now,
        updatedAt: fixture.clock.now,
      }),
    insertOutboundMessage: async (input) =>
      createStoredMessage({
        id: createMessageId(messageSequence++),
        conversationId: input.conversationId,
        role: input.role,
        direction: "outbound",
        content: input.content,
        source: input.source,
        status: input.status ?? "draft",
        ghlMessageId: input.ghlMessageId ?? null,
        rawPayload: input.rawPayload,
        metadata: input.metadata,
        policyDecision: input.policyDecision ?? null,
        policyReasons:
          JSON.parse(JSON.stringify(input.policyReasons ?? [])) as Json,
        policyEvaluatedAt: input.policyEvaluatedAt ?? null,
        createdAt: fixture.clock.now,
        updatedAt: fixture.clock.now,
      }),
    insertAuditLog: async () => undefined,
    classifyCandidateResponseForSafeSend: (input) =>
      classifyCandidateResponseForSafeSend({
        ...input,
        pricingVerification: fixture.router.pricingVerification,
        availabilityVerification: fixture.router.availabilityVerification,
      }),
    evaluateResponsePolicy,
    now: () => new Date(fixture.clock.now),
  });

  const result = await orchestrateConversationTurn(fixture.input);

  return {
    caseId: fixture.id,
    description: fixture.description,
    fixtureFile: fixture.relativePath,
    route: {
      classification: result.classification.category,
      confidence: result.classification.confidence,
      requiresHumanReview: result.classification.requiresHumanReview,
      rationale: result.classification.rationale,
    },
    draft: {
      content: result.aiDraftMessage.content,
      source: result.aiDraftMessage.source,
      status: result.aiDraftMessage.status,
    },
    policy: {
      decision: result.policy.decision,
      reasons: result.policy.reasons,
      transportAllowed: result.policy.transportAllowed,
    },
    safeSend: {
      escalationSignal: result.safeSendClassification.escalationSignal,
      pricingDiscussed: result.safeSendClassification.pricingDiscussed,
      availabilityDiscussed: result.safeSendClassification.availabilityDiscussed,
      pricingVerification: result.safeSendClassification.pricingVerification,
      availabilityVerification:
        result.safeSendClassification.availabilityVerification,
    },
  };
}

export async function runEvalSuite(
  fixtures: readonly LoadedEvalFixture[]
): Promise<EvalArtifactIndex> {
  const cases: EvalCaseResult[] = [];

  for (const fixture of fixtures) {
    cases.push(await runEvalFixture(fixture));
  }

  return {
    artifactVersion: EVAL_ARTIFACT_VERSION,
    baselineVersion: EVAL_BASELINE_VERSION,
    totalCases: cases.length,
    summaries: {
      routes: summarizeCounts(cases.map((result) => result.route.classification)),
      policyDecisions: summarizeCounts(
        cases.map((result) => result.policy.decision)
      ),
    },
    cases,
  };
}

export async function runEvalSuiteFromDirectory(
  directoryPath: string
): Promise<EvalArtifactIndex> {
  const fixtures = await loadEvalFixtures(directoryPath);
  return runEvalSuite(fixtures);
}

export async function writeEvalArtifacts(
  outputDirectoryPath: string,
  artifact: EvalArtifactIndex
): Promise<void> {
  const casesDirectoryPath = path.join(outputDirectoryPath, "cases");

  await rm(outputDirectoryPath, { recursive: true, force: true });
  await mkdir(casesDirectoryPath, { recursive: true });

  await writeFile(
    path.join(outputDirectoryPath, "index.json"),
    toPrettyJson(artifact)
  );

  await Promise.all(
    artifact.cases.map((result) =>
      writeFile(
        path.join(casesDirectoryPath, `${result.caseId}.json`),
        toPrettyJson(result)
      )
    )
  );
}
