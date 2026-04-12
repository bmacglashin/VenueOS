import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

export const REQUEST_ID_HEADER = "x-request-id";
export const TRACE_ID_HEADER = "x-trace-id";
const TRACEPARENT_HEADER = "traceparent";

export const STRUCTURED_EVENT_NAMES = [
  "inbound.received",
  "idempotency.dropped",
  "website_inquiry.persisted",
  "website_inquiry.summary_completed",
  "website_inquiry.summary_failed",
  "website_inquiry.sync_failed",
  "route.classified",
  "policy.evaluated",
  "response.drafted",
  "review.queued",
  "outbound.blocked",
  "outbound.sent",
  "outbound.failed",
  "orchestration.halted",
  "operator_action.note_added",
  "operator_action.approve_and_send",
  "operator_action.edit_and_send",
  "operator_action.regenerate_draft",
] as const;

export type StructuredEventName = (typeof STRUCTURED_EVENT_NAMES)[number];

export const OPERATIONAL_ERROR_TYPES = [
  "validation_error",
  "config_error",
  "db_error",
  "external_api_error",
  "timeout_error",
  "idempotency_drop",
  "unknown_error",
] as const;

export type OperationalErrorType = (typeof OPERATIONAL_ERROR_TYPES)[number];

export interface ObservabilityContext {
  requestId: string;
  traceId: string;
}

interface OperationalErrorOptions {
  cause?: unknown;
}

export class OperationalError extends Error {
  readonly type: OperationalErrorType;
  override readonly cause?: unknown;

  constructor(
    type: OperationalErrorType,
    message: string,
    options: OperationalErrorOptions = {}
  ) {
    super(message);
    this.name = "OperationalError";
    this.type = type;
    this.cause = options.cause;
  }
}

export class ValidationError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("validation_error", message, options);
    this.name = "ValidationError";
  }
}

export class ConfigError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("config_error", message, options);
    this.name = "ConfigError";
  }
}

export class DatabaseError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("db_error", message, options);
    this.name = "DatabaseError";
  }
}

export class ExternalApiError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("external_api_error", message, options);
    this.name = "ExternalApiError";
  }
}

export class TimeoutError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("timeout_error", message, options);
    this.name = "TimeoutError";
  }
}

export class IdempotencyDropError extends OperationalError {
  constructor(message: string, options: OperationalErrorOptions = {}) {
    super("idempotency_drop", message, options);
    this.name = "IdempotencyDropError";
  }
}

function toTrimmedId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
}

function parseTraceparentTraceId(value: string | null): string | undefined {
  const trimmed = value?.trim();

  if (trimmed == null || trimmed.length === 0) {
    return undefined;
  }

  const [, traceId] = trimmed.split("-");

  if (
    traceId != null &&
    /^[0-9a-f]{32}$/i.test(traceId) &&
    !/^0{32}$/i.test(traceId)
  ) {
    return traceId.toLowerCase();
  }

  return undefined;
}

export function createObservabilityContext(
  seed: Partial<ObservabilityContext> = {}
): ObservabilityContext {
  return {
    requestId: toTrimmedId(seed.requestId) ?? randomUUID(),
    traceId: toTrimmedId(seed.traceId) ?? randomUUID(),
  };
}

export function createObservabilityContextFromHeaders(
  headers: Headers
): ObservabilityContext {
  return createObservabilityContext({
    requestId: toTrimmedId(headers.get(REQUEST_ID_HEADER)),
    traceId:
      toTrimmedId(headers.get(TRACE_ID_HEADER)) ??
      parseTraceparentTraceId(headers.get(TRACEPARENT_HEADER)),
  });
}

export function applyObservabilityHeaders(
  headers: Headers,
  observability: ObservabilityContext
): Headers {
  headers.set(REQUEST_ID_HEADER, observability.requestId);
  headers.set(TRACE_ID_HEADER, observability.traceId);
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorCause(error: unknown): unknown {
  if (isRecord(error) && "cause" in error) {
    return error.cause;
  }

  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return undefined;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.name;
  }

  if (isRecord(error) && typeof error.name === "string") {
    return error.name;
  }

  return undefined;
}

function isTimeoutLike(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase();
  const code = getErrorCode(error)?.toLowerCase();
  const name =
    error instanceof Error ? error.name.toLowerCase() : undefined;

  return Boolean(
    name === "aborterror" ||
      name === "timeouterror" ||
      code === "etimedout" ||
      code === "timeout" ||
      message?.includes("timed out") ||
      message?.includes("timeout")
  );
}

function isDbLike(error: unknown): boolean {
  const code = getErrorCode(error);

  return Boolean(
    code != null &&
      (/^[0-9A-Z]{5}$/i.test(code) || code.toUpperCase().startsWith("PGRST"))
  );
}

function isDuplicateInboundMessageError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase() ?? "";
  const code = getErrorCode(error);

  return (
    code === "23505" &&
    (message.includes("messages_ghl_message_id_key") ||
      message.includes("ghl_message_id"))
  );
}

function isDuplicateWebhookClaimError(error: unknown): boolean {
  const message = getErrorMessage(error)?.toLowerCase() ?? "";
  const code = getErrorCode(error);

  return (
    code === "23505" &&
    (message.includes("processed_webhook_events_source_idempotency_key_key") ||
      message.includes("processed_webhook_events") ||
      message.includes("idempotency_key"))
  );
}

function classifyOperationalErrorInternal(
  error: unknown,
  seen: Set<unknown>
): OperationalErrorType {
  if (error == null || seen.has(error)) {
    return "unknown_error";
  }

  seen.add(error);

  if (error instanceof OperationalError) {
    return error.type;
  }

  if (error instanceof ZodError) {
    return "validation_error";
  }

  if (
    getErrorName(error) === "VenueModelError" ||
    getErrorName(error) === "VenueStructuredOutputError"
  ) {
    return "external_api_error";
  }

  if (isDuplicateInboundMessageError(error)) {
    return "idempotency_drop";
  }

  if (isDuplicateWebhookClaimError(error)) {
    return "idempotency_drop";
  }

  if (isTimeoutLike(error)) {
    return "timeout_error";
  }

  if (isDbLike(error)) {
    return "db_error";
  }

  const cause = getErrorCause(error);

  if (cause != null) {
    return classifyOperationalErrorInternal(cause, seen);
  }

  return "unknown_error";
}

export function classifyOperationalError(
  error: unknown
): OperationalErrorType {
  return classifyOperationalErrorInternal(error, new Set<unknown>());
}

export function getOperationalErrorMessage(error: unknown): string {
  return getErrorMessage(error) ?? "Unexpected unknown error.";
}
