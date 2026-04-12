import type {
  CanonicalContactDTO,
  CanonicalCustomFieldValue,
  CanonicalNoteDTO,
  CanonicalOpportunityDTO,
  CanonicalOutboundMessageDTO,
  CanonicalOutboundChannel,
  GhlContactPayload,
  GhlCustomFieldValue,
  GhlNotePayload,
  GhlOpportunityPayload,
  GhlOutboundMessagePayload,
  GhlOutboundMessageType,
} from "./types";

export interface ToGhlPayloadContext {
  locationId: string;
}

export interface FromGhlContactPayloadContext {
  tenantId: string;
  canonicalId?: string | null;
}

export interface FromGhlOpportunityPayloadContext {
  tenantId: string;
  canonicalId?: string | null;
  contactCanonicalId?: string | null;
}

export interface FromGhlNotePayloadContext {
  tenantId: string;
  canonicalId?: string | null;
  contactCanonicalId?: string | null;
}

export interface FromGhlOutboundMessagePayloadContext {
  tenantId: string;
  canonicalId?: string | null;
  conversationCanonicalId?: string | null;
  contactCanonicalId?: string | null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(
  values: readonly string[] | null | undefined
): string[] {
  return (values ?? [])
    .map((value) => normalizeNullableText(value))
    .filter((value): value is string => value != null);
}

function normalizeCustomFields(
  values: readonly CanonicalCustomFieldValue[]
): GhlCustomFieldValue[] {
  return values.map((field) => ({
    id: field.fieldKey,
    value: field.value,
  }));
}

function fromGhlCustomFields(
  values: readonly GhlCustomFieldValue[]
): CanonicalCustomFieldValue[] {
  return values.map((field) => ({
    fieldKey: field.id,
    value: field.value,
  }));
}

function resolveFullName(input: {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}): string | null {
  if (input.fullName != null) {
    return input.fullName;
  }

  const parts = [input.firstName, input.lastName].filter(
    (value): value is string => value != null
  );

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" ");
}

function toGhlOutboundMessageType(
  channel: CanonicalOutboundChannel
): GhlOutboundMessageType {
  return channel === "email" ? "Email" : "SMS";
}

function fromGhlOutboundMessageType(
  type: GhlOutboundMessageType
): CanonicalOutboundChannel {
  return type === "Email" ? "email" : "sms";
}

export function toGhlContactPayload(input: {
  contact: CanonicalContactDTO;
  context: ToGhlPayloadContext;
}): GhlContactPayload {
  const firstName = normalizeNullableText(input.contact.firstName);
  const lastName = normalizeNullableText(input.contact.lastName);
  const fullName = resolveFullName({
    firstName,
    lastName,
    fullName: normalizeNullableText(input.contact.fullName),
  });

  return {
    id: normalizeNullableText(input.contact.externalId),
    locationId: input.context.locationId,
    email: normalizeNullableText(input.contact.email),
    firstName,
    lastName,
    name: fullName,
    phone: normalizeNullableText(input.contact.phone),
    companyName: normalizeNullableText(input.contact.companyName),
    source: normalizeNullableText(input.contact.source),
    dnd: input.contact.doNotDisturb,
    website: normalizeNullableText(input.contact.websiteUrl),
    address1: normalizeNullableText(input.contact.addressLine1),
    city: normalizeNullableText(input.contact.city),
    state: normalizeNullableText(input.contact.state),
    postalCode: normalizeNullableText(input.contact.postalCode),
    country: normalizeNullableText(input.contact.country),
    tags: normalizeStringArray(input.contact.tags),
    attachments: normalizeStringArray(input.contact.attachmentUrls),
    assignedTo: normalizeNullableText(input.contact.assignedUserExternalId),
    customFields: normalizeCustomFields(input.contact.customFields),
    dateAdded: normalizeNullableText(input.contact.createdAt),
  };
}

export function fromGhlContactPayload(input: {
  payload: GhlContactPayload;
  context: FromGhlContactPayloadContext;
}): CanonicalContactDTO {
  const firstName = normalizeNullableText(input.payload.firstName);
  const lastName = normalizeNullableText(input.payload.lastName);
  const fullName = resolveFullName({
    firstName,
    lastName,
    fullName: normalizeNullableText(input.payload.name),
  });

  return {
    canonicalId: input.context.canonicalId ?? null,
    tenantId: input.context.tenantId,
    externalId: normalizeNullableText(input.payload.id),
    firstName,
    lastName,
    fullName,
    email: normalizeNullableText(input.payload.email),
    phone: normalizeNullableText(input.payload.phone),
    companyName: normalizeNullableText(input.payload.companyName),
    source: normalizeNullableText(input.payload.source),
    doNotDisturb: input.payload.dnd,
    websiteUrl: normalizeNullableText(input.payload.website),
    addressLine1: normalizeNullableText(input.payload.address1),
    city: normalizeNullableText(input.payload.city),
    state: normalizeNullableText(input.payload.state),
    postalCode: normalizeNullableText(input.payload.postalCode),
    country: normalizeNullableText(input.payload.country),
    tags: normalizeStringArray(input.payload.tags),
    attachmentUrls: normalizeStringArray(input.payload.attachments),
    assignedUserExternalId: normalizeNullableText(input.payload.assignedTo),
    customFields: fromGhlCustomFields(input.payload.customFields),
    createdAt: normalizeNullableText(input.payload.dateAdded),
    updatedAt: null,
  };
}

export function toGhlOpportunityPayload(input: {
  opportunity: CanonicalOpportunityDTO;
  context: ToGhlPayloadContext;
}): GhlOpportunityPayload {
  return {
    id: normalizeNullableText(input.opportunity.externalId),
    locationId: input.context.locationId,
    assignedTo: normalizeNullableText(input.opportunity.assignedUserExternalId),
    contactId: normalizeNullableText(input.opportunity.contactExternalId),
    monetaryValue: input.opportunity.monetaryValue,
    name: input.opportunity.name.trim(),
    pipelineId: normalizeNullableText(input.opportunity.pipelineExternalId),
    pipelineStageId: normalizeNullableText(
      input.opportunity.pipelineStageExternalId
    ),
    source: normalizeNullableText(input.opportunity.source),
    status: normalizeNullableText(input.opportunity.status),
    dateAdded: normalizeNullableText(input.opportunity.createdAt),
  };
}

export function fromGhlOpportunityPayload(input: {
  payload: GhlOpportunityPayload;
  context: FromGhlOpportunityPayloadContext;
}): CanonicalOpportunityDTO {
  return {
    canonicalId: input.context.canonicalId ?? null,
    tenantId: input.context.tenantId,
    externalId: normalizeNullableText(input.payload.id),
    contactCanonicalId: input.context.contactCanonicalId ?? null,
    contactExternalId: normalizeNullableText(input.payload.contactId),
    name: input.payload.name.trim(),
    monetaryValue: input.payload.monetaryValue,
    pipelineExternalId: normalizeNullableText(input.payload.pipelineId),
    pipelineStageExternalId: normalizeNullableText(
      input.payload.pipelineStageId
    ),
    source: normalizeNullableText(input.payload.source),
    status: normalizeNullableText(input.payload.status),
    assignedUserExternalId: normalizeNullableText(input.payload.assignedTo),
    createdAt: normalizeNullableText(input.payload.dateAdded),
    updatedAt: null,
  };
}

export function toGhlNotePayload(input: {
  note: CanonicalNoteDTO;
  context: ToGhlPayloadContext;
}): GhlNotePayload {
  return {
    id: normalizeNullableText(input.note.externalId),
    locationId: input.context.locationId,
    contactId: normalizeNullableText(input.note.contactExternalId),
    body: input.note.body.trim(),
    dateAdded: normalizeNullableText(input.note.createdAt),
  };
}

export function fromGhlNotePayload(input: {
  payload: GhlNotePayload;
  context: FromGhlNotePayloadContext;
}): CanonicalNoteDTO {
  return {
    canonicalId: input.context.canonicalId ?? null,
    tenantId: input.context.tenantId,
    externalId: normalizeNullableText(input.payload.id),
    contactCanonicalId: input.context.contactCanonicalId ?? null,
    contactExternalId: normalizeNullableText(input.payload.contactId),
    body: input.payload.body.trim(),
    createdAt: normalizeNullableText(input.payload.dateAdded),
    updatedAt: null,
  };
}

export function toGhlOutboundMessagePayload(input: {
  message: CanonicalOutboundMessageDTO;
  context: ToGhlPayloadContext;
}): GhlOutboundMessagePayload {
  const isEmail = input.message.channel === "email";
  const recipients = normalizeStringArray(input.message.to);

  return {
    contactId: normalizeNullableText(input.message.contactExternalId),
    locationId: input.context.locationId,
    messageId: normalizeNullableText(input.message.externalId),
    emailMessageId: isEmail
      ? normalizeNullableText(input.message.channelThreadExternalId)
      : null,
    type: toGhlOutboundMessageType(input.message.channel),
    attachments: normalizeStringArray(input.message.attachmentUrls),
    message: normalizeNullableText(input.message.textBody),
    phone: isEmail ? null : recipients[0] ?? null,
    emailTo: isEmail ? recipients : [],
    emailFrom: isEmail ? normalizeNullableText(input.message.from) : null,
    html: isEmail ? normalizeNullableText(input.message.htmlBody) : null,
    subject: isEmail ? normalizeNullableText(input.message.subject) : null,
    userId: normalizeNullableText(input.message.senderUserExternalId),
  };
}

export function fromGhlOutboundMessagePayload(input: {
  payload: GhlOutboundMessagePayload;
  context: FromGhlOutboundMessagePayloadContext;
}): CanonicalOutboundMessageDTO {
  const channel = fromGhlOutboundMessageType(input.payload.type);
  const to =
    channel === "email"
      ? normalizeStringArray(input.payload.emailTo)
      : normalizeStringArray(
          input.payload.phone != null ? [input.payload.phone] : []
        );

  return {
    canonicalId: input.context.canonicalId ?? null,
    tenantId: input.context.tenantId,
    externalId: normalizeNullableText(input.payload.messageId),
    channelThreadExternalId: normalizeNullableText(
      input.payload.emailMessageId
    ),
    conversationCanonicalId: input.context.conversationCanonicalId ?? null,
    conversationExternalId: null,
    contactCanonicalId: input.context.contactCanonicalId ?? null,
    contactExternalId: normalizeNullableText(input.payload.contactId),
    channel,
    textBody: normalizeNullableText(input.payload.message),
    htmlBody: normalizeNullableText(input.payload.html),
    subject: normalizeNullableText(input.payload.subject),
    to,
    from: normalizeNullableText(input.payload.emailFrom),
    senderUserExternalId: normalizeNullableText(input.payload.userId),
    attachmentUrls: normalizeStringArray(input.payload.attachments),
    createdAt: null,
    updatedAt: null,
  };
}
