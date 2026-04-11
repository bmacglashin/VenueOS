import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Database, Json } from "../lib/db/supabase";
import type { RouteInboundMessageResult } from "../lib/llm/router";
import {
  createConversationOrchestrator,
  type ConversationTurnRequest,
} from "../services/conversation-orchestrator-core";
import { resolveOutboundMode } from "../services/outbound-control";
import { evaluateResponsePolicy } from "../services/response-policy";
import { classifyCandidateResponseForSafeSend } from "../services/safe-send-classifier";
import {
  evalFixtureSchema,
  type EvalCaseCategory,
  type EvalFixture,
} from "./fixture-schema";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];

export const EVAL_ARTIFACT_VERSION = 2 as const;
export const EVAL_BASELINE_VERSION = "v2" as const;

const FIXTURE_SOURCE = "eval_fixture";
const FIXTURE_ROUTER_MODEL = "eval-fixture-router";
const FIXTURE_RESPONSE_MODEL = "eval-fixture-response";
const FIXTURE_PROMPT_VERSION = "shift-3-v1" as const;
const DEFAULT_OUTBOUND_MODE = "enabled" as const;
const FIXTURE_OBSERVABILITY = {
  requestId: "eval_request_id",
  traceId: "eval_trace_id",
} as const;

export const EVAL_SCORE_TYPES = [
  "classification_correctness",
  "policy_decision_correctness",
  "escalation_correctness",
  "pricing_availability_guardrail_correctness",
  "review_vs_send_correctness",
] as const;

export type EvalScoreType = (typeof EVAL_SCORE_TYPES)[number];

export interface LoadedEvalFixture extends EvalFixture {
  filePath: string;
  relativePath: string;
}

export interface EvalCheckResult {
  scorer: EvalScoreType;
  name: string;
  pass: boolean;
  expected: Json;
  actual: Json;
  reason: string;
}

export interface EvalCaseScore {
  pass: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: EvalCheckResult[];
}

export interface EvalCaseResult {
  caseId: string;
  category: EvalCaseCategory;
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
  outbound: {
    mode: string;
    source: string;
    action: string;
    reasons: Array<{ code: string; detail: string }>;
    transportAttempted: boolean;
    transportOutcome: string | null;
  };
  score: EvalCaseScore;
}

export interface EvalScoreBucket {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  score: number;
}

export interface EvalFailedCase {
  caseId: string;
  category: EvalCaseCategory;
  description: string;
  route: string;
  failedChecks: EvalCheckResult[];
}

export interface EvalArtifactReport {
  overall: EvalScoreBucket;
  byRoute: Record<string, EvalScoreBucket>;
  byCategory: Record<string, EvalScoreBucket>;
  failedCases: EvalFailedCase[];
}

export interface EvalArtifactIndex {
  artifactVersion: typeof EVAL_ARTIFACT_VERSION;
  baselineVersion: typeof EVAL_BASELINE_VERSION;
  totalCases: number;
  summaries: {
    routes: Record<string, number>;
    policyDecisions: Record<string, number>;
    categories: Record<string, number>;
  };
  report: EvalArtifactReport;
  cases: EvalCaseResult[];
}

interface EvalCaseSnapshot {
  caseId: string;
  category: EvalCaseCategory;
  description: string;
  fixtureFile: string;
  route: EvalCaseResult["route"];
  draft: EvalCaseResult["draft"];
  policy: EvalCaseResult["policy"];
  safeSend: EvalCaseResult["safeSend"];
  outbound: EvalCaseResult["outbound"];
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
      observability: FIXTURE_OBSERVABILITY,
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

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function buildCheck(input: {
  scorer: EvalScoreType;
  name: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  reason: string;
}): EvalCheckResult {
  return {
    scorer: input.scorer,
    name: input.name,
    pass: input.pass,
    expected: toJsonValue(input.expected),
    actual: toJsonValue(input.actual),
    reason: input.reason,
  };
}

function shouldScoreEscalation(fixture: LoadedEvalFixture): boolean {
  return (
    fixture.expect.safeSend.escalationSignal !== undefined ||
    fixture.category === "escalation" ||
    fixture.category === "policy_uncertainty" ||
    fixture.router.classification.requiresHumanReview ||
    fixture.router.classification.category === "unknown_needs_review"
  );
}

function shouldScorePricingGuardrail(fixture: LoadedEvalFixture): boolean {
  return (
    fixture.expect.safeSend.pricingDiscussed !== undefined ||
    fixture.expect.safeSend.pricingVerification !== undefined ||
    fixture.expect.policy.reasonCodes.includes("pricing_unverified")
  );
}

function shouldScoreAvailabilityGuardrail(fixture: LoadedEvalFixture): boolean {
  return (
    fixture.expect.safeSend.availabilityDiscussed !== undefined ||
    fixture.expect.safeSend.availabilityVerification !== undefined ||
    fixture.expect.policy.reasonCodes.includes("availability_unverified")
  );
}

function scoreClassificationCorrectness(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const expectedRoute = fixture.router.classification;

  checks.push(
    buildCheck({
      scorer: "classification_correctness",
      name: "route.classification",
      pass: snapshot.route.classification === expectedRoute.category,
      expected: expectedRoute.category,
      actual: snapshot.route.classification,
      reason: `Expected route classification ${expectedRoute.category}.`,
    })
  );

  checks.push(
    buildCheck({
      scorer: "classification_correctness",
      name: "route.confidence",
      pass: snapshot.route.confidence === expectedRoute.confidence,
      expected: expectedRoute.confidence,
      actual: snapshot.route.confidence,
      reason: `Expected route confidence ${expectedRoute.confidence}.`,
    })
  );

  checks.push(
    buildCheck({
      scorer: "classification_correctness",
      name: "route.requiresHumanReview",
      pass:
        snapshot.route.requiresHumanReview ===
        expectedRoute.requiresHumanReview,
      expected: expectedRoute.requiresHumanReview,
      actual: snapshot.route.requiresHumanReview,
      reason: `Expected requiresHumanReview=${expectedRoute.requiresHumanReview}.`,
    })
  );

  return checks;
}

function scorePolicyDecisionCorrectness(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const actualReasonCodes = snapshot.policy.reasons.map((reason) => reason.code);

  checks.push(
    buildCheck({
      scorer: "policy_decision_correctness",
      name: "policy.decision",
      pass: snapshot.policy.decision === fixture.expect.policy.decision,
      expected: fixture.expect.policy.decision,
      actual: snapshot.policy.decision,
      reason: `Expected policy decision ${fixture.expect.policy.decision}.`,
    })
  );

  checks.push(
    buildCheck({
      scorer: "policy_decision_correctness",
      name: "policy.reasonCodes",
      pass: arraysEqual(actualReasonCodes, fixture.expect.policy.reasonCodes),
      expected: fixture.expect.policy.reasonCodes,
      actual: actualReasonCodes,
      reason: "Expected policy reason codes to match the fixture snapshot exactly.",
    })
  );

  return checks;
}

function scoreEscalationCorrectness(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCheckResult[] {
  if (!shouldScoreEscalation(fixture)) {
    return [];
  }

  const expectedEscalation =
    fixture.expect.safeSend.escalationSignal ??
    (fixture.router.classification.requiresHumanReview ||
      fixture.router.classification.category === "unknown_needs_review");
  const actualReasonCodes = snapshot.policy.reasons.map((reason) => reason.code);
  const checks: EvalCheckResult[] = [
    buildCheck({
      scorer: "escalation_correctness",
      name: "safeSend.escalationSignal",
      pass: snapshot.safeSend.escalationSignal === expectedEscalation,
      expected: expectedEscalation,
      actual: snapshot.safeSend.escalationSignal,
      reason: `Expected escalationSignal=${expectedEscalation}.`,
    }),
  ];

  if (expectedEscalation) {
    checks.push(
      buildCheck({
        scorer: "escalation_correctness",
        name: "policy.escalationProtection",
        pass:
          actualReasonCodes.includes("escalation_required") &&
          snapshot.policy.decision !== "safe_to_send",
        expected: true,
        actual:
          actualReasonCodes.includes("escalation_required") &&
          snapshot.policy.decision !== "safe_to_send",
        reason:
          "Escalation cases must surface escalation_required and stay out of safe_to_send.",
      })
    );
  }

  return checks;
}

function scorePricingAvailabilityGuardrails(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const actualReasonCodes = snapshot.policy.reasons.map((reason) => reason.code);

  if (shouldScorePricingGuardrail(fixture)) {
    if (fixture.expect.safeSend.pricingDiscussed !== undefined) {
      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "safeSend.pricingDiscussed",
          pass:
            snapshot.safeSend.pricingDiscussed ===
            fixture.expect.safeSend.pricingDiscussed,
          expected: fixture.expect.safeSend.pricingDiscussed,
          actual: snapshot.safeSend.pricingDiscussed,
          reason: `Expected pricingDiscussed=${fixture.expect.safeSend.pricingDiscussed}.`,
        })
      );
    }

    if (fixture.expect.safeSend.pricingVerification !== undefined) {
      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "safeSend.pricingVerification",
          pass:
            snapshot.safeSend.pricingVerification ===
            fixture.expect.safeSend.pricingVerification,
          expected: fixture.expect.safeSend.pricingVerification,
          actual: snapshot.safeSend.pricingVerification,
          reason: `Expected pricingVerification=${fixture.expect.safeSend.pricingVerification}.`,
        })
      );
    }

    if (
      fixture.expect.safeSend.pricingDiscussed === true &&
      fixture.expect.safeSend.pricingVerification === "unverified"
    ) {
      const pricingTrapProtected =
        actualReasonCodes.includes("pricing_unverified") &&
        snapshot.policy.decision !== "safe_to_send";

      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "policy.pricingTrapProtection",
          pass: pricingTrapProtected,
          expected: true,
          actual: pricingTrapProtected,
          reason:
            "Unverified pricing claims must stay out of safe_to_send and include pricing_unverified.",
        })
      );
    }
  }

  if (shouldScoreAvailabilityGuardrail(fixture)) {
    if (fixture.expect.safeSend.availabilityDiscussed !== undefined) {
      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "safeSend.availabilityDiscussed",
          pass:
            snapshot.safeSend.availabilityDiscussed ===
            fixture.expect.safeSend.availabilityDiscussed,
          expected: fixture.expect.safeSend.availabilityDiscussed,
          actual: snapshot.safeSend.availabilityDiscussed,
          reason: `Expected availabilityDiscussed=${fixture.expect.safeSend.availabilityDiscussed}.`,
        })
      );
    }

    if (fixture.expect.safeSend.availabilityVerification !== undefined) {
      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "safeSend.availabilityVerification",
          pass:
            snapshot.safeSend.availabilityVerification ===
            fixture.expect.safeSend.availabilityVerification,
          expected: fixture.expect.safeSend.availabilityVerification,
          actual: snapshot.safeSend.availabilityVerification,
          reason: `Expected availabilityVerification=${fixture.expect.safeSend.availabilityVerification}.`,
        })
      );
    }

    if (
      fixture.expect.safeSend.availabilityDiscussed === true &&
      fixture.expect.safeSend.availabilityVerification === "unverified"
    ) {
      const availabilityTrapProtected =
        actualReasonCodes.includes("availability_unverified") &&
        snapshot.policy.decision !== "safe_to_send";

      checks.push(
        buildCheck({
          scorer: "pricing_availability_guardrail_correctness",
          name: "policy.availabilityTrapProtection",
          pass: availabilityTrapProtected,
          expected: true,
          actual: availabilityTrapProtected,
          reason:
            "Unverified availability claims must stay out of safe_to_send and include availability_unverified.",
        })
      );
    }
  }

  return checks;
}

function scoreReviewVsSendCorrectness(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [
    buildCheck({
      scorer: "review_vs_send_correctness",
      name: "outbound.action",
      pass: snapshot.outbound.action === fixture.expect.outbound.action,
      expected: fixture.expect.outbound.action,
      actual: snapshot.outbound.action,
      reason: `Expected outbound action ${fixture.expect.outbound.action}.`,
    }),
    buildCheck({
      scorer: "review_vs_send_correctness",
      name: "outbound.transportAttempted",
      pass:
        snapshot.outbound.transportAttempted ===
        (fixture.expect.outbound.action === "proceed"),
      expected: fixture.expect.outbound.action === "proceed",
      actual: snapshot.outbound.transportAttempted,
      reason:
        "Transport should only be attempted when the outbound action is proceed.",
    }),
  ];

  if (fixture.expect.outbound.draftStatus !== undefined) {
    checks.push(
      buildCheck({
        scorer: "review_vs_send_correctness",
        name: "draft.status",
        pass: snapshot.draft.status === fixture.expect.outbound.draftStatus,
        expected: fixture.expect.outbound.draftStatus,
        actual: snapshot.draft.status,
        reason: `Expected draft status ${fixture.expect.outbound.draftStatus}.`,
      })
    );
  }

  return checks;
}

function scoreEvalCase(
  fixture: LoadedEvalFixture,
  snapshot: EvalCaseSnapshot
): EvalCaseScore {
  const checks = [
    ...scoreClassificationCorrectness(fixture, snapshot),
    ...scorePolicyDecisionCorrectness(fixture, snapshot),
    ...scoreEscalationCorrectness(fixture, snapshot),
    ...scorePricingAvailabilityGuardrails(fixture, snapshot),
    ...scoreReviewVsSendCorrectness(fixture, snapshot),
  ];
  const passedChecks = checks.filter((check) => check.pass).length;

  return {
    pass: passedChecks === checks.length,
    totalChecks: checks.length,
    passedChecks,
    failedChecks: checks.length - passedChecks,
    checks,
  };
}

function buildScoreBucket(cases: readonly EvalCaseResult[]): EvalScoreBucket {
  const totalCases = cases.length;
  const passedCases = cases.filter((result) => result.score.pass).length;
  const totalChecks = cases.reduce(
    (sum, result) => sum + result.score.totalChecks,
    0
  );
  const passedChecks = cases.reduce(
    (sum, result) => sum + result.score.passedChecks,
    0
  );

  return {
    totalCases,
    passedCases,
    failedCases: totalCases - passedCases,
    totalChecks,
    passedChecks,
    failedChecks: totalChecks - passedChecks,
    score:
      totalChecks === 0
        ? 0
        : Number(((passedChecks / totalChecks) * 100).toFixed(1)),
  };
}

function buildArtifactReport(
  cases: readonly EvalCaseResult[]
): EvalArtifactReport {
  const byRoute = Object.fromEntries(
    [...new Set(cases.map((result) => result.route.classification))]
      .sort((left, right) => left.localeCompare(right))
      .map((route) => [
        route,
        buildScoreBucket(
          cases.filter((result) => result.route.classification === route)
        ),
      ])
  );
  const byCategory = Object.fromEntries(
    [...new Set(cases.map((result) => result.category))]
      .sort((left, right) => left.localeCompare(right))
      .map((category) => [
        category,
        buildScoreBucket(
          cases.filter((result) => result.category === category)
        ),
      ])
  );
  const failedCases = cases
    .filter((result) => !result.score.pass)
    .map((result) => ({
      caseId: result.caseId,
      category: result.category,
      description: result.description,
      route: result.route.classification,
      failedChecks: result.score.checks.filter((check) => !check.pass),
    }));

  return {
    overall: buildScoreBucket(cases),
    byRoute,
    byCategory,
    failedCases,
  };
}

function formatScoreBucket(label: string, bucket: EvalScoreBucket): string {
  return `- ${label}: ${bucket.score}% checks passed (${bucket.passedChecks}/${bucket.totalChecks}); case pass ${bucket.passedCases}/${bucket.totalCases}`;
}

export function formatEvalReport(artifact: EvalArtifactIndex): string {
  const lines = [
    `Overall: ${artifact.report.overall.score}% checks passed (${artifact.report.overall.passedChecks}/${artifact.report.overall.totalChecks}); case pass ${artifact.report.overall.passedCases}/${artifact.report.overall.totalCases}`,
    "By route:",
    ...Object.entries(artifact.report.byRoute).map(([route, bucket]) =>
      formatScoreBucket(route, bucket)
    ),
    "By category:",
    ...Object.entries(artifact.report.byCategory).map(([category, bucket]) =>
      formatScoreBucket(category, bucket)
    ),
  ];

  if (artifact.report.failedCases.length === 0) {
    lines.push("Failed cases: none");
    return lines.join("\n");
  }

  lines.push("Failed cases:");

  artifact.report.failedCases.forEach((failedCase) => {
    lines.push(
      `- ${failedCase.caseId} [${failedCase.route} / ${failedCase.category}]`
    );

    failedCase.failedChecks.forEach((check) => {
      lines.push(
        `  - ${check.scorer}.${check.name}: ${check.reason} Expected ${JSON.stringify(
          check.expected
        )}, got ${JSON.stringify(check.actual)}.`
      );
    });
  });

  return lines.join("\n");
}

function applyPolicyOverrides(
  input: {
    tenantState: "present" | "missing" | "unknown";
    inboundBodyState: "present" | "missing" | "unknown";
    routeCategory?: RouteInboundMessageResult["classification"]["category"] | null;
    routeConfidence?: number | null;
    escalationSignal: boolean;
    pricingDiscussed: boolean;
    availabilityDiscussed: boolean;
    pricingVerification:
      | "not_applicable"
      | "verified_deterministic"
      | "verified_approved"
      | "unverified";
    availabilityVerification:
      | "not_applicable"
      | "verified_deterministic"
      | "verified_approved"
      | "unverified";
  },
  fixture: LoadedEvalFixture
) {
  const policyOverrides = fixture.overrides.policy;

  if (policyOverrides == null) {
    return input;
  }

  return {
    ...input,
    tenantState: policyOverrides.tenantState ?? input.tenantState,
    inboundBodyState: policyOverrides.inboundBodyState ?? input.inboundBodyState,
  };
}

async function buildFixtureResolvedOutboundMode(fixture: LoadedEvalFixture) {
  const outboundModeOverride = fixture.overrides.outboundMode;

  return resolveOutboundMode({
    globalMode: outboundModeOverride?.globalMode ?? DEFAULT_OUTBOUND_MODE,
    tenantOverride: outboundModeOverride?.tenantOverride ?? null,
  });
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
): Promise<EvalCaseSnapshot> {
  const conversation = createConversationRow(fixture);
  const recentMessages = createRecentMessages(fixture);
  let messageSequence = recentMessages.length + 100;

  const orchestrateConversationTurn = createConversationOrchestrator({
    resolveConversation: async () => conversation,
    fetchRecentMessages: async () => recentMessages,
    findMessageByGhlMessageId: async () => null,
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
    evaluateResponsePolicy: (input, options) =>
      evaluateResponsePolicy(applyPolicyOverrides(input, fixture), options),
    resolveOutboundMode: async () => buildFixtureResolvedOutboundMode(fixture),
    dispatchOutboundTransport: async () => ({
      attempted: true,
      outcome: "skipped" as const,
      provider: "pending_live_wiring" as const,
      detail: "Eval runner transport stub.",
      dispatchedAt: fixture.clock.now,
      observability: FIXTURE_OBSERVABILITY,
    }),
    now: () => new Date(fixture.clock.now),
  });

  const result = await orchestrateConversationTurn(
    fixture.input as ConversationTurnRequest
  );

  return {
    caseId: fixture.id,
    category: fixture.category,
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
    outbound: {
      mode: result.resolvedOutboundMode.mode,
      source: result.resolvedOutboundMode.source,
      action: result.outboundDecision.action,
      reasons: result.outboundDecision.reasons,
      transportAttempted: result.outboundTransport != null,
      transportOutcome: result.outboundTransport?.outcome ?? null,
    },
  };
}

export async function runEvalSuite(
  fixtures: readonly LoadedEvalFixture[]
): Promise<EvalArtifactIndex> {
  const cases: EvalCaseResult[] = [];

  for (const fixture of fixtures) {
    const snapshot = await runEvalFixture(fixture);
    const score = scoreEvalCase(fixture, snapshot);

    cases.push({
      ...snapshot,
      score,
    });
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
      categories: summarizeCounts(cases.map((result) => result.category)),
    },
    report: buildArtifactReport(cases),
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

  await Promise.all([
    writeFile(path.join(outputDirectoryPath, "index.json"), toPrettyJson(artifact)),
    writeFile(
      path.join(outputDirectoryPath, "report.json"),
      toPrettyJson(artifact.report)
    ),
  ]);

  await Promise.all(
    artifact.cases.map((result) =>
      writeFile(
        path.join(casesDirectoryPath, `${result.caseId}.json`),
        toPrettyJson(result)
      )
    )
  );
}
