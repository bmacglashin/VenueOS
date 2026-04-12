import type {
  InboundRouteClassification,
  RouteInboundReplySource,
} from "@/src/lib/llm/router";
import type {
  OperationalErrorType,
  StructuredEventName,
} from "@/src/lib/observability";
import type { OutboundMode } from "@/src/lib/config/outbound";
import type {
  GhlContactPayload,
  GhlNotePayload,
  GhlOpportunityPayload,
  GhlOutboundMessagePayload,
} from "@/src/services/ghl-shadow/types";
import type { ResponsePolicyDecision } from "@/src/services/response-policy";
import type { OutboundAction } from "@/src/services/outbound-control";

export type ReplayFixtureEntity =
  | "contact"
  | "opportunity"
  | "note"
  | "outboundMessage";

export interface ReplayFixtureTenant {
  id: string;
  slug: string;
  name: string;
  ghlLocationId: string;
}

export interface ReplayFixtureRecentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  direction: "inbound" | "outbound";
  content: string;
  createdAt: string;
  updatedAt?: string;
  source?: string;
  status?: string;
}

export interface ReplayFixtureExpectedIds {
  conversationId: string;
  inboundMessageId: string;
  aiDraftMessageId: string;
}

export interface ReplayFixture {
  id: string;
  description: string;
  entity: ReplayFixtureEntity;
  clock: {
    now: string;
  };
  tenant: ReplayFixtureTenant;
  ids: ReplayFixtureExpectedIds;
  webhook: {
    eventId: string;
    eventType: string;
    ghlContactId: string;
    ghlConversationId: string;
    ghlMessageId: string;
    messageBody: string;
    receivedAt: string;
    payload:
      | GhlContactPayload
      | GhlOpportunityPayload
      | GhlNotePayload
      | GhlOutboundMessagePayload;
  };
  recentMessages: readonly ReplayFixtureRecentMessage[];
  router: {
    classification: InboundRouteClassification;
    aiReply: string;
    replySource?: RouteInboundReplySource;
    pricingVerification?:
      | "not_applicable"
      | "verified_deterministic"
      | "verified_approved"
      | "unverified";
    availabilityVerification?:
      | "not_applicable"
      | "verified_deterministic"
      | "verified_approved"
      | "unverified";
  };
  overrides?: {
    outboundMode?: {
      globalMode: OutboundMode;
      tenantOverride?: OutboundMode | null;
    };
  };
  expect: {
    response: {
      accepted: boolean;
      duplicate: boolean;
      errorType: OperationalErrorType | null;
    };
    ids: {
      conversationId: string | null;
      inboundMessageId: string | null;
      aiDraftMessageId: string | null;
    };
    routeCategory:
      | InboundRouteClassification["category"]
      | null;
    policyDecision: ResponsePolicyDecision | null;
    outboundAction: OutboundAction | null;
    transportOutcome: "blocked" | "dry_run" | "skipped" | null;
    auditEvents: readonly StructuredEventName[];
  };
}

const VERITAS_TENANT = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "veritas",
  name: "Veritas Vineyard",
  ghlLocationId: "mock-veritas-location",
} as const satisfies ReplayFixtureTenant;

const HARBORVIEW_TENANT = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "harborview-loft",
  name: "Harborview Loft",
  ghlLocationId: "mock-harborview-location",
} as const satisfies ReplayFixtureTenant;

const CONTACT_PRICING_REVIEW = {
  id: "contact-pricing-review",
  description:
    "Contact upsert webhook should queue a pricing-heavy reply for review through the shared webhook loop.",
  entity: "contact",
  clock: {
    now: "2026-04-12T14:00:00.000Z",
  },
  tenant: VERITAS_TENANT,
  ids: {
    conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    inboundMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    aiDraftMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
  },
  webhook: {
    eventId: "evt-contact-pricing-001",
    eventType: "ContactUpdate",
    ghlContactId: "ghl-contact-contact-pricing-001",
    ghlConversationId: "ghl-conversation-contact-pricing-001",
    ghlMessageId: "ghl-message-contact-pricing-001",
    messageBody:
      "Taylor updated their profile and asked if weekday event pricing still starts around the same range.",
    receivedAt: "2026-04-12T13:58:00.000Z",
    payload: {
      id: "ghl-contact-contact-pricing-001",
      locationId: VERITAS_TENANT.ghlLocationId,
      email: "taylor@example.com",
      firstName: "Taylor",
      lastName: "Brooks",
      name: "Taylor Brooks",
      phone: "+15555550100",
      companyName: "Brooks Events",
      source: "website_form",
      dnd: false,
      website: "https://brooks-events.example.com",
      address1: "12 Vineyard Lane",
      city: "Afton",
      state: "VA",
      postalCode: "22920",
      country: "US",
      tags: ["pricing", "weekday"],
      attachments: [],
      assignedTo: "ghl-user-veritas-001",
      customFields: [
        {
          id: "preferred-event-type",
          value: "weekday rehearsal dinner",
        },
      ],
      dateAdded: "2026-04-12T13:50:00.000Z",
    },
  },
  recentMessages: [],
  router: {
    classification: {
      category: "general_hospitality",
      confidence: 0.93,
      requiresHumanReview: false,
      rationale:
        "The guest is asking a standard venue pricing question after a contact update.",
    },
    aiReply:
      "Our weekday event fee starts at $4,200 plus tax, and I can help outline next steps for your date.",
  },
  overrides: {
    outboundMode: {
      globalMode: "enabled",
    },
  },
  expect: {
    response: {
      accepted: true,
      duplicate: false,
      errorType: null,
    },
    ids: {
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      inboundMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
      aiDraftMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
    },
    routeCategory: "general_hospitality",
    policyDecision: "needs_review",
    outboundAction: "queue",
    transportOutcome: null,
    auditEvents: [
      "inbound.received",
      "route.classified",
      "policy.evaluated",
      "response.drafted",
      "review.queued",
    ],
  },
} as const satisfies ReplayFixture;

const OPPORTUNITY_BUYOUT_REVIEW = {
  id: "opportunity-buyout-review",
  description:
    "Opportunity webhook should preserve a high-touch buyout request in review without diverging from the internal webhook path.",
  entity: "opportunity",
  clock: {
    now: "2026-04-12T14:05:00.000Z",
  },
  tenant: HARBORVIEW_TENANT,
  ids: {
    conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    inboundMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
    aiDraftMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
  },
  webhook: {
    eventId: "evt-opportunity-buyout-001",
    eventType: "OpportunityUpdate",
    ghlContactId: "ghl-contact-opportunity-buyout-001",
    ghlConversationId: "ghl-conversation-opportunity-buyout-001",
    ghlMessageId: "ghl-message-opportunity-buyout-001",
    messageBody:
      "A rooftop buyout opportunity moved stages and the guest wants a polished follow-up on next steps.",
    receivedAt: "2026-04-12T14:03:00.000Z",
    payload: {
      id: "ghl-opportunity-buyout-001",
      locationId: HARBORVIEW_TENANT.ghlLocationId,
      assignedTo: "ghl-user-harborview-001",
      contactId: "ghl-contact-opportunity-buyout-001",
      monetaryValue: 12000,
      name: "September rooftop buyout",
      pipelineId: "pipeline-private-events",
      pipelineStageId: "stage-follow-up",
      source: "inbound_message",
      status: "open",
      dateAdded: "2026-04-12T13:55:00.000Z",
    },
  },
  recentMessages: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe",
      role: "user",
      direction: "inbound",
      content:
        "We are comparing rooftop buyout options for a September rehearsal dinner.",
      createdAt: "2026-04-12T13:54:00.000Z",
      source: "ghl_replay_fixture",
      status: "recorded",
    },
  ],
  router: {
    classification: {
      category: "high_ticket_event",
      confidence: 0.69,
      requiresHumanReview: true,
      rationale:
        "The message concerns a premium private-event opportunity that needs human follow-up.",
    },
    aiReply:
      "Thanks for considering Harborview Loft for your buyout. Our events team is reviewing the request and will follow up with next steps shortly.",
  },
  overrides: {
    outboundMode: {
      globalMode: "enabled",
    },
  },
  expect: {
    response: {
      accepted: true,
      duplicate: false,
      errorType: null,
    },
    ids: {
      conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      inboundMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
      aiDraftMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
    },
    routeCategory: "high_ticket_event",
    policyDecision: "needs_review",
    outboundAction: "queue",
    transportOutcome: null,
    auditEvents: [
      "inbound.received",
      "route.classified",
      "policy.evaluated",
      "response.drafted",
      "review.queued",
    ],
  },
} as const satisfies ReplayFixture;

const NOTE_HOURS_SAFE = {
  id: "note-hours-safe",
  description:
    "Note webhook should run the same loop and reach a dry-run transport outcome for a safe reply.",
  entity: "note",
  clock: {
    now: "2026-04-12T14:10:00.000Z",
  },
  tenant: VERITAS_TENANT,
  ids: {
    conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    inboundMessageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
    aiDraftMessageId: "cccccccc-cccc-4ccc-8ccc-ccccccccccce",
  },
  webhook: {
    eventId: "evt-note-hours-001",
    eventType: "NoteCreate",
    ghlContactId: "ghl-contact-note-hours-001",
    ghlConversationId: "ghl-conversation-note-hours-001",
    ghlMessageId: "ghl-message-note-hours-001",
    messageBody:
      "A coordinator note says the guest wants a simple follow-up from the team about planning a tasting visit.",
    receivedAt: "2026-04-12T14:08:00.000Z",
    payload: {
      id: "ghl-note-hours-001",
      locationId: VERITAS_TENANT.ghlLocationId,
      contactId: "ghl-contact-note-hours-001",
      body:
        "Guest is interested in planning a tasting visit and asked for a simple next-step follow-up.",
      dateAdded: "2026-04-12T14:07:00.000Z",
    },
  },
  recentMessages: [],
  router: {
    classification: {
      category: "general_hospitality",
      confidence: 0.88,
      requiresHumanReview: false,
      rationale:
        "The note maps to a standard guest follow-up without risky claims.",
    },
    aiReply:
      "Thanks for reaching out. A team member will follow up shortly to help with your visit.",
  },
  overrides: {
    outboundMode: {
      globalMode: "enabled",
    },
  },
  expect: {
    response: {
      accepted: true,
      duplicate: false,
      errorType: null,
    },
    ids: {
      conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      inboundMessageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
      aiDraftMessageId: "cccccccc-cccc-4ccc-8ccc-ccccccccccce",
    },
    routeCategory: "general_hospitality",
    policyDecision: "safe_to_send",
    outboundAction: "proceed",
    transportOutcome: "dry_run",
    auditEvents: [
      "inbound.received",
      "route.classified",
      "policy.evaluated",
      "response.drafted",
      "outbound.sent",
    ],
  },
} as const satisfies ReplayFixture;

const OUTBOUND_MESSAGE_SAFE = {
  id: "outbound-message-safe",
  description:
    "Outbound-message webhook should hit the same orchestration path and dry-run the transport guard safely.",
  entity: "outboundMessage",
  clock: {
    now: "2026-04-12T14:15:00.000Z",
  },
  tenant: HARBORVIEW_TENANT,
  ids: {
    conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    inboundMessageId: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
    aiDraftMessageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddf",
  },
  webhook: {
    eventId: "evt-outbound-safe-001",
    eventType: "ProviderOutboundMessage",
    ghlContactId: "ghl-contact-outbound-safe-001",
    ghlConversationId: "ghl-conversation-outbound-safe-001",
    ghlMessageId: "ghl-message-outbound-safe-001",
    messageBody:
      "The guest sent a calm follow-up and only needs an acknowledgement from the team.",
    receivedAt: "2026-04-12T14:13:00.000Z",
    payload: {
      contactId: "ghl-contact-outbound-safe-001",
      locationId: HARBORVIEW_TENANT.ghlLocationId,
      messageId: "ghl-message-outbound-safe-001",
      emailMessageId: null,
      type: "SMS",
      attachments: [],
      message: "Just checking in on the follow-up from your team.",
      phone: "+15555550101",
      emailTo: [],
      emailFrom: null,
      html: null,
      subject: null,
      userId: "ghl-user-harborview-001",
    },
  },
  recentMessages: [],
  router: {
    classification: {
      category: "booking_request",
      confidence: 0.91,
      requiresHumanReview: false,
      rationale:
        "The follow-up is a standard booking-adjacent acknowledgement that can remain on the shared safe path.",
    },
    aiReply:
      "Thanks for the follow-up. We have your message and a team member will reply shortly.",
  },
  overrides: {
    outboundMode: {
      globalMode: "enabled",
    },
  },
  expect: {
    response: {
      accepted: true,
      duplicate: false,
      errorType: null,
    },
    ids: {
      conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      inboundMessageId: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
      aiDraftMessageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddf",
    },
    routeCategory: "booking_request",
    policyDecision: "safe_to_send",
    outboundAction: "proceed",
    transportOutcome: "dry_run",
    auditEvents: [
      "inbound.received",
      "route.classified",
      "policy.evaluated",
      "response.drafted",
      "outbound.sent",
    ],
  },
} as const satisfies ReplayFixture;

const OUTBOUND_MESSAGE_DUPLICATE_DROP = {
  id: "outbound-message-duplicate-drop",
  description:
    "Replaying the same outbound-message event ID in one run should surface the shared idempotency drop path cleanly.",
  entity: "outboundMessage",
  clock: {
    now: "2026-04-12T14:16:00.000Z",
  },
  tenant: HARBORVIEW_TENANT,
  ids: {
    conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    inboundMessageId: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
    aiDraftMessageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddf",
  },
  webhook: {
    eventId: "evt-outbound-safe-001",
    eventType: "ProviderOutboundMessage",
    ghlContactId: "ghl-contact-outbound-safe-001",
    ghlConversationId: "ghl-conversation-outbound-safe-001",
    ghlMessageId: "ghl-message-outbound-safe-001",
    messageBody:
      "The same outbound-message event is replayed again to prove idempotency handling.",
    receivedAt: "2026-04-12T14:14:00.000Z",
    payload: {
      contactId: "ghl-contact-outbound-safe-001",
      locationId: HARBORVIEW_TENANT.ghlLocationId,
      messageId: "ghl-message-outbound-safe-001",
      emailMessageId: null,
      type: "SMS",
      attachments: [],
      message: "Just checking in on the follow-up from your team.",
      phone: "+15555550101",
      emailTo: [],
      emailFrom: null,
      html: null,
      subject: null,
      userId: "ghl-user-harborview-001",
    },
  },
  recentMessages: [],
  router: {
    classification: {
      category: "booking_request",
      confidence: 0.91,
      requiresHumanReview: false,
      rationale:
        "This fixture should not orchestrate because the idempotency claim is already taken.",
    },
    aiReply:
      "Thanks for the follow-up. We have your message and a team member will reply shortly.",
  },
  overrides: {
    outboundMode: {
      globalMode: "enabled",
    },
  },
  expect: {
    response: {
      accepted: true,
      duplicate: true,
      errorType: "idempotency_drop",
    },
    ids: {
      conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      inboundMessageId: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
      aiDraftMessageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddf",
    },
    routeCategory: null,
    policyDecision: null,
    outboundAction: null,
    transportOutcome: null,
    auditEvents: ["inbound.received", "idempotency.dropped"],
  },
} as const satisfies ReplayFixture;

export const GHL_REPLAY_FIXTURES = [
  CONTACT_PRICING_REVIEW,
  OPPORTUNITY_BUYOUT_REVIEW,
  NOTE_HOURS_SAFE,
  OUTBOUND_MESSAGE_SAFE,
  OUTBOUND_MESSAGE_DUPLICATE_DROP,
] as const satisfies readonly ReplayFixture[];

export function listGhlReplayFixtures(): readonly ReplayFixture[] {
  return GHL_REPLAY_FIXTURES;
}

export function getGhlReplayFixtureById(id: string): ReplayFixture | null {
  return (
    GHL_REPLAY_FIXTURES.find((fixture) => fixture.id === id.trim()) ?? null
  );
}
