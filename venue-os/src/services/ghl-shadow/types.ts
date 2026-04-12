import type { Json } from "@/src/lib/db/supabase";

// Canonical DTOs stay internal-first. The paired GHL payload types below are
// only adapter shapes for the shadow mapping layer.

export const CANONICAL_OUTBOUND_CHANNELS = ["sms", "email"] as const;
export type CanonicalOutboundChannel =
  (typeof CANONICAL_OUTBOUND_CHANNELS)[number];

export const GHL_OUTBOUND_MESSAGE_TYPES = ["SMS", "Email"] as const;
export type GhlOutboundMessageType =
  (typeof GHL_OUTBOUND_MESSAGE_TYPES)[number];

export interface CanonicalCustomFieldValue {
  fieldKey: string;
  value: Json;
}

export interface CanonicalContactDTO {
  canonicalId: string | null;
  tenantId: string;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: string | null;
  doNotDisturb: boolean;
  websiteUrl: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  tags: readonly string[];
  attachmentUrls: readonly string[];
  assignedUserExternalId: string | null;
  customFields: readonly CanonicalCustomFieldValue[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CanonicalOpportunityDTO {
  canonicalId: string | null;
  tenantId: string;
  externalId: string | null;
  contactCanonicalId: string | null;
  contactExternalId: string | null;
  name: string;
  monetaryValue: number | null;
  pipelineExternalId: string | null;
  pipelineStageExternalId: string | null;
  source: string | null;
  status: string | null;
  assignedUserExternalId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CanonicalNoteDTO {
  canonicalId: string | null;
  tenantId: string;
  externalId: string | null;
  contactCanonicalId: string | null;
  contactExternalId: string | null;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CanonicalOutboundMessageDTO {
  canonicalId: string | null;
  tenantId: string;
  externalId: string | null;
  channelThreadExternalId: string | null;
  conversationCanonicalId: string | null;
  conversationExternalId: string | null;
  contactCanonicalId: string | null;
  contactExternalId: string | null;
  channel: CanonicalOutboundChannel;
  textBody: string | null;
  htmlBody: string | null;
  subject: string | null;
  to: readonly string[];
  from: string | null;
  senderUserExternalId: string | null;
  attachmentUrls: readonly string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GhlCustomFieldValue {
  id: string;
  value: Json;
}

export interface GhlContactPayload {
  id: string | null;
  locationId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  phone: string | null;
  companyName: string | null;
  source: string | null;
  dnd: boolean;
  website: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  tags: readonly string[];
  attachments: readonly string[];
  assignedTo: string | null;
  customFields: readonly GhlCustomFieldValue[];
  dateAdded: string | null;
}

export interface GhlOpportunityPayload {
  id: string | null;
  locationId: string;
  assignedTo: string | null;
  contactId: string | null;
  monetaryValue: number | null;
  name: string;
  pipelineId: string | null;
  pipelineStageId: string | null;
  source: string | null;
  status: string | null;
  dateAdded: string | null;
}

export interface GhlNotePayload {
  id: string | null;
  locationId: string;
  contactId: string | null;
  body: string;
  dateAdded: string | null;
}

export interface GhlOutboundMessagePayload {
  contactId: string | null;
  locationId: string;
  messageId: string | null;
  emailMessageId: string | null;
  type: GhlOutboundMessageType;
  attachments: readonly string[];
  message: string | null;
  phone: string | null;
  emailTo: readonly string[];
  emailFrom: string | null;
  html: string | null;
  subject: string | null;
  userId: string | null;
}
