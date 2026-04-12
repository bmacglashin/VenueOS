import { fileURLToPath } from "node:url";

import type { ResponsePolicyReason } from "@/src/services/response-policy";

export interface MockTenantKnowledgePack {
  slug: string;
  sourceName: string;
  sourceType: "markdown";
  fileUrl: URL;
  filePath: string;
}

export interface MockTenantSeedSpec {
  slug: string;
  name: string;
  ghlLocationId: string;
  knowledge: MockTenantKnowledgePack;
  sampleConversation: {
    seedKey: string;
    ghlConversationId: string;
    ghlContactId: string;
    inboundMessageId: string;
    inboundContent: string;
    draftContent: string;
    routeCategory:
      | "general_hospitality"
      | "high_ticket_event"
      | "booking_request"
      | "unknown_needs_review";
    routeConfidence: number;
    policyDecision: "safe_to_send" | "needs_review" | "block_send";
    policyReasons: ResponsePolicyReason[];
    occurredAt: string;
  };
}

function createKnowledgePack(
  slug: string,
  sourceName: string,
  relativePath: string
): MockTenantKnowledgePack {
  const fileUrl = new URL(relativePath, import.meta.url);

  return {
    slug,
    sourceName,
    sourceType: "markdown",
    fileUrl,
    filePath: fileURLToPath(fileUrl),
  };
}

const VERITAS_KNOWLEDGE_PACK = createKnowledgePack(
  "veritas",
  "veritas-knowledge",
  "./veritas-knowledge.md"
);

const HARBORVIEW_KNOWLEDGE_PACK = createKnowledgePack(
  "harborview-loft",
  "harborview-loft-knowledge",
  "./harborview-loft-knowledge.md"
);

const MOCK_TENANT_SEED_SPECS = [
  {
    slug: "veritas",
    name: "Veritas Vineyard",
    ghlLocationId: "mock-veritas-location",
    knowledge: VERITAS_KNOWLEDGE_PACK,
    sampleConversation: {
      seedKey: "veritas-review-seed",
      ghlConversationId: "seed-veritas-conversation",
      ghlContactId: "seed-veritas-contact",
      inboundMessageId: "seed-veritas-inbound-message",
      inboundContent:
        "Hi, I am planning a Saturday tasting visit and want to confirm your current hours plus whether walk-ins are still welcome.",
      draftContent:
        "Thanks for reaching out to Veritas Vineyard. I can help with current tasting room details, but I want a team member to confirm today's walk-in availability before we promise anything specific.",
      routeCategory: "general_hospitality",
      routeConfidence: 0.73,
      policyDecision: "needs_review",
      policyReasons: [
        {
          code: "availability_unverified",
          detail:
            "The response discusses same-day availability without a verified source of truth.",
        },
      ],
      occurredAt: "2026-04-11T14:00:00.000Z",
    },
  },
  {
    slug: "harborview-loft",
    name: "Harborview Loft",
    ghlLocationId: "mock-harborview-location",
    knowledge: HARBORVIEW_KNOWLEDGE_PACK,
    sampleConversation: {
      seedKey: "harborview-review-seed",
      ghlConversationId: "seed-harborview-conversation",
      ghlContactId: "seed-harborview-contact",
      inboundMessageId: "seed-harborview-inbound-message",
      inboundContent:
        "Hello, we are comparing rooftop buyout options for a 75-person rehearsal dinner in September. Can you tell me about minimums and outside catering?",
      draftContent:
        "Thanks for considering Harborview Loft for your rehearsal dinner. We host rooftop buyouts for this size, but I need our events team to confirm the current minimum spend and catering policy details before I send firm numbers.",
      routeCategory: "high_ticket_event",
      routeConfidence: 0.69,
      policyDecision: "needs_review",
      policyReasons: [
        {
          code: "pricing_unverified",
          detail:
            "Minimum-spend guidance needs an approved event-sales confirmation before it is sent externally.",
        },
      ],
      occurredAt: "2026-04-11T14:05:00.000Z",
    },
  },
] as const satisfies readonly MockTenantSeedSpec[];

export const DEFAULT_MOCK_TENANT_SLUG = "veritas";

export function listMockTenantSeedSpecs(): readonly MockTenantSeedSpec[] {
  return MOCK_TENANT_SEED_SPECS;
}

export function getMockTenantSeedSpecBySlug(
  slug: string
): MockTenantSeedSpec | null {
  const normalizedSlug = slug.trim().toLowerCase();

  return (
    MOCK_TENANT_SEED_SPECS.find((spec) => spec.slug === normalizedSlug) ?? null
  );
}

export function getMockTenantSeedSpecByLocationId(
  ghlLocationId: string
): MockTenantSeedSpec | null {
  const normalizedLocationId = ghlLocationId.trim().toLowerCase();

  return (
    MOCK_TENANT_SEED_SPECS.find(
      (spec) => spec.ghlLocationId.toLowerCase() === normalizedLocationId
    ) ?? null
  );
}

export function getDefaultMockTenantSeedSpec(): MockTenantSeedSpec {
  const defaultSpec = getMockTenantSeedSpecBySlug(DEFAULT_MOCK_TENANT_SLUG);

  if (defaultSpec == null) {
    throw new Error(
      `Default mock tenant slug "${DEFAULT_MOCK_TENANT_SLUG}" is not registered.`
    );
  }

  return defaultSpec;
}
