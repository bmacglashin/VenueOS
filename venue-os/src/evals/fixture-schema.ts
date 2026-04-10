import { z } from "zod";

import { OUTBOUND_MODES } from "../lib/config/outbound";
import {
  inboundRouteClassificationSchema,
  ROUTE_INBOUND_REPLY_SOURCES,
} from "../lib/llm/route-contract";
import { conversationTurnRequestSchema } from "../services/conversation-orchestrator-core";
import { OUTBOUND_ACTIONS } from "../services/outbound-control";
import {
  RESPONSE_POLICY_DECISIONS,
  RESPONSE_POLICY_FACT_VERIFICATION_STATES,
  RESPONSE_POLICY_PRESENCE_STATES,
  RESPONSE_POLICY_REASON_CODES,
} from "../services/response-policy";

export const EVAL_FIXTURE_SCHEMA_VERSION = 1 as const;
export const EVAL_CASE_CATEGORIES = [
  "baseline_control",
  "ambiguity",
  "policy_uncertainty",
  "pricing_trap",
  "escalation",
  "missing_context",
] as const;

export type EvalCaseCategory = (typeof EVAL_CASE_CATEGORIES)[number];

const recentMessageSchema = z.object({
  id: z.string().uuid().optional(),
  role: z.string().trim().min(1),
  direction: z.enum(["inbound", "outbound"]),
  content: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

const fixtureInputSchema = conversationTurnRequestSchema.extend({
  conversation: conversationTurnRequestSchema.shape.conversation.extend({
    id: z.string().uuid(),
  }),
});

const fixtureRouterSchema = z.object({
  classification: inboundRouteClassificationSchema,
  aiReply: z.string().trim().min(1),
  replySource: z.enum(ROUTE_INBOUND_REPLY_SOURCES).optional(),
  pricingVerification: z
    .enum(RESPONSE_POLICY_FACT_VERIFICATION_STATES)
    .optional(),
  availabilityVerification: z
    .enum(RESPONSE_POLICY_FACT_VERIFICATION_STATES)
    .optional(),
});

const fixtureExpectationsSchema = z.object({
  policy: z.object({
    decision: z.enum(RESPONSE_POLICY_DECISIONS),
    reasonCodes: z.array(z.enum(RESPONSE_POLICY_REASON_CODES)).default([]),
  }),
  safeSend: z
    .object({
      escalationSignal: z.boolean().optional(),
      pricingDiscussed: z.boolean().optional(),
      availabilityDiscussed: z.boolean().optional(),
      pricingVerification: z
        .enum(RESPONSE_POLICY_FACT_VERIFICATION_STATES)
        .optional(),
      availabilityVerification: z
        .enum(RESPONSE_POLICY_FACT_VERIFICATION_STATES)
        .optional(),
    })
    .default({}),
  outbound: z.object({
    action: z.enum(OUTBOUND_ACTIONS),
    draftStatus: z
      .enum(["ready_to_send", "queued_for_review", "blocked"])
      .optional(),
  }),
});

const fixtureOverridesSchema = z
  .object({
    policy: z
      .object({
        tenantState: z.enum(RESPONSE_POLICY_PRESENCE_STATES).optional(),
        inboundBodyState: z.enum(RESPONSE_POLICY_PRESENCE_STATES).optional(),
      })
      .optional(),
    outboundMode: z
      .object({
        globalMode: z.enum(OUTBOUND_MODES).default("enabled"),
        tenantOverride: z.enum(OUTBOUND_MODES).nullable().optional(),
      })
      .optional(),
  })
  .default({});

export const evalFixtureSchema = z.object({
  schemaVersion: z.literal(EVAL_FIXTURE_SCHEMA_VERSION),
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.enum(EVAL_CASE_CATEGORIES),
  clock: z.object({
    now: z.string().datetime(),
  }),
  input: fixtureInputSchema,
  recentMessages: z.array(recentMessageSchema).default([]),
  router: fixtureRouterSchema,
  expect: fixtureExpectationsSchema,
  overrides: fixtureOverridesSchema,
});

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
