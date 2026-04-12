import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGhlShadowMapperProvider,
  type GhlShadowProviderContract,
} from "./contract";
import {
  fromGhlContactPayload,
  fromGhlNotePayload,
  fromGhlOpportunityPayload,
  fromGhlOutboundMessagePayload,
  toGhlContactPayload,
  toGhlNotePayload,
  toGhlOpportunityPayload,
  toGhlOutboundMessagePayload,
} from "./mappers";
import {
  GHL_CONTACT_FIELD_MAPPING,
  GHL_NOTE_FIELD_MAPPING,
  GHL_OBJECT_MAPPING,
  GHL_OPPORTUNITY_FIELD_MAPPING,
  GHL_OUTBOUND_MESSAGE_FIELD_MAPPING,
} from "./mappings";
import type {
  CanonicalContactDTO,
  CanonicalNoteDTO,
  CanonicalOpportunityDTO,
  CanonicalOutboundMessageDTO,
  GhlContactPayload,
  GhlNotePayload,
  GhlOpportunityPayload,
  GhlOutboundMessagePayload,
} from "./types";

const context = {
  locationId: "loc-shadow-123",
};

function makeCanonicalContact(
  overrides: Partial<CanonicalContactDTO> = {}
): CanonicalContactDTO {
  return {
    canonicalId: "contact-internal-1",
    tenantId: "tenant-1",
    externalId: "ghl-contact-1",
    firstName: "Taylor",
    lastName: "Brooks",
    fullName: "Taylor Brooks",
    email: "taylor@example.com",
    phone: "+15555550100",
    companyName: "Veritas Events",
    source: "website_form",
    doNotDisturb: false,
    websiteUrl: "https://veritas.example.com",
    addressLine1: "101 Main Street",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11201",
    country: "US",
    tags: ["lead", "wedding"],
    attachmentUrls: ["https://cdn.example.com/intake.pdf"],
    assignedUserExternalId: "ghl-user-9",
    customFields: [
      {
        fieldKey: "custom-field-1",
        value: "October wedding",
      },
    ],
    createdAt: "2026-04-12T14:30:00.000Z",
    updatedAt: "2026-04-12T15:30:00.000Z",
    ...overrides,
  };
}

function makeCanonicalOpportunity(
  overrides: Partial<CanonicalOpportunityDTO> = {}
): CanonicalOpportunityDTO {
  return {
    canonicalId: "opportunity-internal-1",
    tenantId: "tenant-1",
    externalId: "ghl-opportunity-1",
    contactCanonicalId: "contact-internal-1",
    contactExternalId: "ghl-contact-1",
    name: "October Reception",
    monetaryValue: 15000,
    pipelineExternalId: "pipeline-1",
    pipelineStageExternalId: "stage-1",
    source: "website_form",
    status: "open",
    assignedUserExternalId: "ghl-user-9",
    createdAt: "2026-04-12T14:35:00.000Z",
    updatedAt: "2026-04-12T15:35:00.000Z",
    ...overrides,
  };
}

function makeCanonicalNote(
  overrides: Partial<CanonicalNoteDTO> = {}
): CanonicalNoteDTO {
  return {
    canonicalId: "note-internal-1",
    tenantId: "tenant-1",
    externalId: "ghl-note-1",
    contactCanonicalId: "contact-internal-1",
    contactExternalId: "ghl-contact-1",
    body: "Prospect prefers Saturday walk-throughs.",
    createdAt: "2026-04-12T14:40:00.000Z",
    updatedAt: "2026-04-12T15:40:00.000Z",
    ...overrides,
  };
}

function makeCanonicalSmsMessage(
  overrides: Partial<CanonicalOutboundMessageDTO> = {}
): CanonicalOutboundMessageDTO {
  return {
    canonicalId: "message-internal-1",
    tenantId: "tenant-1",
    externalId: "ghl-message-1",
    channelThreadExternalId: null,
    conversationCanonicalId: "conversation-internal-1",
    conversationExternalId: "ghl-conversation-1",
    contactCanonicalId: "contact-internal-1",
    contactExternalId: "ghl-contact-1",
    channel: "sms",
    textBody: "We have October 18 available.",
    htmlBody: null,
    subject: null,
    to: ["+15555550100"],
    from: null,
    senderUserExternalId: "ghl-user-9",
    attachmentUrls: ["https://cdn.example.com/brochure.pdf"],
    createdAt: "2026-04-12T14:45:00.000Z",
    updatedAt: "2026-04-12T15:45:00.000Z",
    ...overrides,
  };
}

function makeCanonicalEmailMessage(
  overrides: Partial<CanonicalOutboundMessageDTO> = {}
): CanonicalOutboundMessageDTO {
  return {
    ...makeCanonicalSmsMessage({
      channel: "email",
      channelThreadExternalId: "ghl-email-thread-1",
      textBody: "Sharing the proposal details below.",
      htmlBody: "<p>Sharing the proposal details below.</p>",
      subject: "Veritas proposal details",
      to: ["taylor@example.com", "planner@example.com"],
      from: "Veritas Team <hello@veritas.example.com>",
    }),
    ...overrides,
  };
}

describe("ghl shadow mappers", () => {
  it("maps canonical contacts into GHL contact payloads", () => {
    const payload = toGhlContactPayload({
      contact: makeCanonicalContact(),
      context,
    });

    assert.deepEqual(payload, {
      id: "ghl-contact-1",
      locationId: "loc-shadow-123",
      email: "taylor@example.com",
      firstName: "Taylor",
      lastName: "Brooks",
      name: "Taylor Brooks",
      phone: "+15555550100",
      companyName: "Veritas Events",
      source: "website_form",
      dnd: false,
      website: "https://veritas.example.com",
      address1: "101 Main Street",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11201",
      country: "US",
      tags: ["lead", "wedding"],
      attachments: ["https://cdn.example.com/intake.pdf"],
      assignedTo: "ghl-user-9",
      customFields: [
        {
          id: "custom-field-1",
          value: "October wedding",
        },
      ],
      dateAdded: "2026-04-12T14:30:00.000Z",
    } satisfies GhlContactPayload);
  });

  it("maps GHL contacts back into canonical contacts with internal-only fields nulled or preserved from context", () => {
    const contact = fromGhlContactPayload({
      payload: {
        id: "ghl-contact-1",
        locationId: "loc-shadow-123",
        email: "taylor@example.com",
        firstName: "Taylor",
        lastName: "Brooks",
        name: null,
        phone: "+15555550100",
        companyName: "Veritas Events",
        source: "website_form",
        dnd: true,
        website: "https://veritas.example.com",
        address1: "101 Main Street",
        city: "Brooklyn",
        state: "NY",
        postalCode: "11201",
        country: "US",
        tags: ["lead", "wedding"],
        attachments: ["https://cdn.example.com/intake.pdf"],
        assignedTo: "ghl-user-9",
        customFields: [
          {
            id: "custom-field-1",
            value: "October wedding",
          },
        ],
        dateAdded: "2026-04-12T14:30:00.000Z",
      },
      context: {
        tenantId: "tenant-1",
        canonicalId: "contact-internal-1",
      },
    });

    assert.equal(contact.canonicalId, "contact-internal-1");
    assert.equal(contact.tenantId, "tenant-1");
    assert.equal(contact.fullName, "Taylor Brooks");
    assert.equal(contact.doNotDisturb, true);
    assert.equal(contact.updatedAt, null);
  });

  it("maps opportunities into and out of the GHL opportunity payload shape", () => {
    const canonical = makeCanonicalOpportunity();
    const payload = toGhlOpportunityPayload({
      opportunity: canonical,
      context,
    });

    assert.deepEqual(payload, {
      id: "ghl-opportunity-1",
      locationId: "loc-shadow-123",
      assignedTo: "ghl-user-9",
      contactId: "ghl-contact-1",
      monetaryValue: 15000,
      name: "October Reception",
      pipelineId: "pipeline-1",
      pipelineStageId: "stage-1",
      source: "website_form",
      status: "open",
      dateAdded: "2026-04-12T14:35:00.000Z",
    } satisfies GhlOpportunityPayload);

    const roundTrip = fromGhlOpportunityPayload({
      payload,
      context: {
        tenantId: canonical.tenantId,
        canonicalId: canonical.canonicalId,
        contactCanonicalId: canonical.contactCanonicalId,
      },
    });

    assert.equal(roundTrip.externalId, canonical.externalId);
    assert.equal(roundTrip.contactExternalId, canonical.contactExternalId);
    assert.equal(roundTrip.contactCanonicalId, canonical.contactCanonicalId);
    assert.equal(roundTrip.updatedAt, null);
  });

  it("maps notes into and out of the GHL note payload shape", () => {
    const canonical = makeCanonicalNote();
    const payload = toGhlNotePayload({
      note: canonical,
      context,
    });

    assert.deepEqual(payload, {
      id: "ghl-note-1",
      locationId: "loc-shadow-123",
      contactId: "ghl-contact-1",
      body: "Prospect prefers Saturday walk-throughs.",
      dateAdded: "2026-04-12T14:40:00.000Z",
    } satisfies GhlNotePayload);

    const roundTrip = fromGhlNotePayload({
      payload,
      context: {
        tenantId: canonical.tenantId,
        canonicalId: canonical.canonicalId,
        contactCanonicalId: canonical.contactCanonicalId,
      },
    });

    assert.equal(roundTrip.externalId, canonical.externalId);
    assert.equal(roundTrip.contactExternalId, canonical.contactExternalId);
    assert.equal(roundTrip.updatedAt, null);
  });

  it("maps SMS outbound payloads and keeps the missing conversation id explicit", () => {
    const canonical = makeCanonicalSmsMessage();
    const payload = toGhlOutboundMessagePayload({
      message: canonical,
      context,
    });

    assert.deepEqual(payload, {
      contactId: "ghl-contact-1",
      locationId: "loc-shadow-123",
      messageId: "ghl-message-1",
      emailMessageId: null,
      type: "SMS",
      attachments: ["https://cdn.example.com/brochure.pdf"],
      message: "We have October 18 available.",
      phone: "+15555550100",
      emailTo: [],
      emailFrom: null,
      html: null,
      subject: null,
      userId: "ghl-user-9",
    } satisfies GhlOutboundMessagePayload);

    const roundTrip = fromGhlOutboundMessagePayload({
      payload,
      context: {
        tenantId: canonical.tenantId,
        canonicalId: canonical.canonicalId,
        conversationCanonicalId: canonical.conversationCanonicalId,
        contactCanonicalId: canonical.contactCanonicalId,
      },
    });

    assert.equal(roundTrip.channel, "sms");
    assert.deepEqual(roundTrip.to, ["+15555550100"]);
    assert.equal(roundTrip.conversationCanonicalId, "conversation-internal-1");
    assert.equal(roundTrip.conversationExternalId, null);
    assert.equal(roundTrip.createdAt, null);
  });

  it("maps email outbound payloads and treats emailTo as an array", () => {
    const canonical = makeCanonicalEmailMessage();
    const payload = toGhlOutboundMessagePayload({
      message: canonical,
      context,
    });

    assert.deepEqual(payload, {
      contactId: "ghl-contact-1",
      locationId: "loc-shadow-123",
      messageId: "ghl-message-1",
      emailMessageId: "ghl-email-thread-1",
      type: "Email",
      attachments: ["https://cdn.example.com/brochure.pdf"],
      message: "Sharing the proposal details below.",
      phone: null,
      emailTo: ["taylor@example.com", "planner@example.com"],
      emailFrom: "Veritas Team <hello@veritas.example.com>",
      html: "<p>Sharing the proposal details below.</p>",
      subject: "Veritas proposal details",
      userId: "ghl-user-9",
    } satisfies GhlOutboundMessagePayload);

    const roundTrip = fromGhlOutboundMessagePayload({
      payload,
      context: {
        tenantId: canonical.tenantId,
        canonicalId: canonical.canonicalId,
        contactCanonicalId: canonical.contactCanonicalId,
      },
    });

    assert.equal(roundTrip.channel, "email");
    assert.deepEqual(roundTrip.to, ["taylor@example.com", "planner@example.com"]);
    assert.equal(roundTrip.from, "Veritas Team <hello@veritas.example.com>");
    assert.equal(roundTrip.channelThreadExternalId, "ghl-email-thread-1");
  });

  it("captures the documented object and field mapping assumptions", () => {
    assert.deepEqual(GHL_OBJECT_MAPPING, {
      contact: "contacts",
      opportunity: "opportunities",
      note: "contactNotes",
      outboundMessage: "providerOutboundMessage",
    });

    assert.equal(GHL_CONTACT_FIELD_MAPPING.canonicalId, null);
    assert.equal(GHL_CONTACT_FIELD_MAPPING.externalId, "id");
    assert.equal(GHL_OPPORTUNITY_FIELD_MAPPING.contactCanonicalId, null);
    assert.equal(GHL_NOTE_FIELD_MAPPING.updatedAt, null);
    assert.deepEqual(GHL_OUTBOUND_MESSAGE_FIELD_MAPPING.to, [
      "phone",
      "emailTo",
    ]);
    assert.equal(GHL_OUTBOUND_MESSAGE_FIELD_MAPPING.conversationExternalId, null);
  });

  it("exposes a pure mapper-backed provider contract with no live API dependency", () => {
    const provider: GhlShadowProviderContract = createGhlShadowMapperProvider();
    const prepared = provider.prepareOutboundDispatch({
      message: makeCanonicalSmsMessage(),
      context,
    });

    assert.equal(provider.provider, "ghl-shadow");
    assert.equal(prepared.entity, "outboundMessage");
    assert.equal(prepared.action, "dispatch");
    assert.equal(prepared.locationId, "loc-shadow-123");
    assert.equal(prepared.payload.message, "We have October 18 available.");
  });
});
