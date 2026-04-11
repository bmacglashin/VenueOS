import type { Database, Json } from "@/src/lib/db/supabase";

type Message = Database["public"]["Tables"]["messages"]["Row"];

export const AI_DRAFT_SOURCE = "venue_os_ai_draft";
export const OPERATOR_EDIT_SOURCE = "mission_control_operator_edit";

export const DRAFT_VERSION_KINDS = [
  "ai_draft",
  "regenerated_ai_draft",
  "operator_edit",
] as const;

export type DraftVersionKind = (typeof DRAFT_VERSION_KINDS)[number];

export interface DraftVersionSnapshot {
  familyId: string;
  version: number;
  parentMessageId: string | null;
  originInboundMessageId: string | null;
  kind: DraftVersionKind;
}

function isJsonObject(
  value: Json | null | undefined
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(
  value: Json | null | undefined
): { [key: string]: Json | undefined } | null {
  return isJsonObject(value) ? value : null;
}

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: Json | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export function isDraftVersionKind(value: string | null): value is DraftVersionKind {
  return (
    value != null &&
    DRAFT_VERSION_KINDS.some((candidate) => candidate === value)
  );
}

export function getDraftVersionSnapshot(
  message: Message | null | undefined
): DraftVersionSnapshot | null {
  const metadata = readJsonObject(message?.metadata);
  const draftVersion = readJsonObject(metadata?.draftVersion);
  const familyId = readString(draftVersion?.familyId);
  const version = readNumber(draftVersion?.version);
  const originInboundMessageId = readString(draftVersion?.originInboundMessageId);
  const parentMessageId = readString(draftVersion?.parentMessageId);
  const kind = readString(draftVersion?.kind);

  if (
    familyId == null ||
    version == null ||
    !isDraftVersionKind(kind)
  ) {
    return null;
  }

  return {
    familyId,
    version,
    parentMessageId,
    originInboundMessageId,
    kind,
  };
}

export function buildDraftVersionMetadata(input: {
  existingMetadata?: Json | null;
  familyId: string;
  version: number;
  parentMessageId?: string | null;
  originInboundMessageId?: string | null;
  kind: DraftVersionKind;
  createdBy: "orchestrator" | "operator";
  createdAt: string;
}): Json {
  const existingMetadata = readJsonObject(input.existingMetadata) ?? {};

  return toJsonValue({
    ...existingMetadata,
    draftVersion: {
      familyId: input.familyId,
      version: input.version,
      parentMessageId: input.parentMessageId ?? null,
      originInboundMessageId: input.originInboundMessageId ?? null,
      kind: input.kind,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    },
  });
}

export function isDraftVersionMessage(message: Message): boolean {
  if (
    message.source === AI_DRAFT_SOURCE ||
    message.source === OPERATOR_EDIT_SOURCE
  ) {
    return true;
  }

  const metadata = readJsonObject(message.metadata);
  const kind = readString(metadata?.kind);
  return kind === "ai_draft";
}

export function listDraftVersionMessages(
  messages: readonly Message[]
): Message[] {
  return [...messages]
    .filter(isDraftVersionMessage)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function getLatestDraftVersionMessage(
  messages: readonly Message[]
): Message | null {
  return listDraftVersionMessages(messages).at(-1) ?? null;
}

export function getNextDraftVersion(input: {
  baseMessage: Message;
  fallbackFamilyId: string;
  fallbackOriginInboundMessageId?: string | null;
  kind: DraftVersionKind;
}): DraftVersionSnapshot {
  const current = getDraftVersionSnapshot(input.baseMessage);

  return {
    familyId: current?.familyId ?? input.fallbackFamilyId,
    version: (current?.version ?? 0) + 1,
    parentMessageId: input.baseMessage.id,
    originInboundMessageId:
      current?.originInboundMessageId ??
      input.fallbackOriginInboundMessageId ??
      null,
    kind: input.kind,
  };
}
