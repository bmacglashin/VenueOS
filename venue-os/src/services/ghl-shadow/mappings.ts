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

export const GHL_OBJECT_MAPPING = {
  contact: "contacts",
  opportunity: "opportunities",
  note: "contactNotes",
  outboundMessage: "providerOutboundMessage",
} as const;

type GhlFieldMapValue<TPayload> =
  | keyof TPayload
  | readonly (keyof TPayload)[]
  | null;

export const GHL_CONTACT_FIELD_MAPPING = {
  canonicalId: null,
  tenantId: null,
  externalId: "id",
  firstName: "firstName",
  lastName: "lastName",
  fullName: "name",
  email: "email",
  phone: "phone",
  companyName: "companyName",
  source: "source",
  doNotDisturb: "dnd",
  websiteUrl: "website",
  addressLine1: "address1",
  city: "city",
  state: "state",
  postalCode: "postalCode",
  country: "country",
  tags: "tags",
  attachmentUrls: "attachments",
  assignedUserExternalId: "assignedTo",
  customFields: "customFields",
  createdAt: "dateAdded",
  updatedAt: null,
} as const satisfies Record<
  keyof CanonicalContactDTO,
  GhlFieldMapValue<GhlContactPayload>
>;

export const GHL_OPPORTUNITY_FIELD_MAPPING = {
  canonicalId: null,
  tenantId: null,
  externalId: "id",
  contactCanonicalId: null,
  contactExternalId: "contactId",
  name: "name",
  monetaryValue: "monetaryValue",
  pipelineExternalId: "pipelineId",
  pipelineStageExternalId: "pipelineStageId",
  source: "source",
  status: "status",
  assignedUserExternalId: "assignedTo",
  createdAt: "dateAdded",
  updatedAt: null,
} as const satisfies Record<
  keyof CanonicalOpportunityDTO,
  GhlFieldMapValue<GhlOpportunityPayload>
>;

export const GHL_NOTE_FIELD_MAPPING = {
  canonicalId: null,
  tenantId: null,
  externalId: "id",
  contactCanonicalId: null,
  contactExternalId: "contactId",
  body: "body",
  createdAt: "dateAdded",
  updatedAt: null,
} as const satisfies Record<
  keyof CanonicalNoteDTO,
  GhlFieldMapValue<GhlNotePayload>
>;

export const GHL_OUTBOUND_MESSAGE_FIELD_MAPPING = {
  canonicalId: null,
  tenantId: null,
  externalId: "messageId",
  channelThreadExternalId: "emailMessageId",
  conversationCanonicalId: null,
  conversationExternalId: null,
  contactCanonicalId: null,
  contactExternalId: "contactId",
  channel: "type",
  textBody: "message",
  htmlBody: "html",
  subject: "subject",
  to: ["phone", "emailTo"],
  from: "emailFrom",
  senderUserExternalId: "userId",
  attachmentUrls: "attachments",
  createdAt: null,
  updatedAt: null,
} as const satisfies Record<
  keyof CanonicalOutboundMessageDTO,
  GhlFieldMapValue<GhlOutboundMessagePayload>
>;
