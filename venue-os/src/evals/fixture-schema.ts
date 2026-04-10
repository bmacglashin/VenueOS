import { z } from "zod";

import {
  inboundRouteClassificationSchema,
  ROUTE_INBOUND_REPLY_SOURCES,
} from "../lib/llm/route-contract";
import { conversationTurnRequestSchema } from "../services/conversation-orchestrator-core";
import { RESPONSE_POLICY_FACT_VERIFICATION_STATES } from "../services/response-policy";

export const EVAL_FIXTURE_SCHEMA_VERSION = 1 as const;

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

export const evalFixtureSchema = z.object({
  schemaVersion: z.literal(EVAL_FIXTURE_SCHEMA_VERSION),
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  clock: z.object({
    now: z.string().datetime(),
  }),
  input: fixtureInputSchema,
  recentMessages: z.array(recentMessageSchema).default([]),
  router: fixtureRouterSchema,
});

export type EvalFixture = z.infer<typeof evalFixtureSchema>;
