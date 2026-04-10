import "server-only";

import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProviderMetadata,
} from "@ai-sdk/google";
import {
  Output,
  generateText,
  type FinishReason,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai";
import { z } from "zod";

import { env } from "../lib/config/env";

const GOOGLE_PROVIDER_NAME = "google.generative-ai" as const;
const PROMPT_VERSION = "shift-3-v1" as const;

export const VENUE_MODEL_MODES = [
  "general_hospitality",
  "high_ticket_event",
  "booking_request",
  "unknown_needs_review",
  "sandbox",
] as const;

export type VenueModelMode = (typeof VENUE_MODEL_MODES)[number];
export type VenueModelClassification = VenueModelMode;

export const VENUE_MESSAGE_ROLES = ["user", "assistant", "system"] as const;

export type VenueMessageRole = (typeof VENUE_MESSAGE_ROLES)[number];

export interface VenueRecentMessage {
  role: VenueMessageRole;
  content: string;
  timestamp?: Date | string;
}

export interface RunVenueModelInput {
  message: string;
  venueName: string;
  knowledgeContext: string | readonly string[];
  recentMessages: readonly VenueRecentMessage[];
  mode: VenueModelMode;
}

export const VENUE_STRUCTURED_OUTPUT_PURPOSES = [
  "inbound_message_routing",
] as const;

export type VenueStructuredOutputPurpose =
  (typeof VENUE_STRUCTURED_OUTPUT_PURPOSES)[number];

export interface RunVenueStructuredOutputInput<TSchema extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: TSchema;
  purpose: VenueStructuredOutputPurpose;
  schemaName?: string;
  schemaDescription?: string;
  temperature?: number;
  maxRetries?: number;
}

export interface VenueModelUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  raw?: LanguageModelUsage["raw"];
}

export interface VenueModelMetadata {
  provider: typeof GOOGLE_PROVIDER_NAME;
  model: string;
  mode: VenueModelMode;
  promptVersion: typeof PROMPT_VERSION;
  classificationSource: "mode";
  recentMessageCount: number;
  knowledgeContextItems: number;
  finishReason?: FinishReason;
  responseId?: string;
  responseTimestamp?: string;
  warnings?: string[];
  usage?: VenueModelUsageSummary;
  providerMetadata?: ProviderMetadata;
  google?: GoogleGenerativeAIProviderMetadata;
}

export interface RunVenueModelResult {
  replyText: string;
  classification: VenueModelClassification;
  confidence: number;
  metadata: VenueModelMetadata;
}

export interface VenueStructuredOutputMetadata {
  provider: typeof GOOGLE_PROVIDER_NAME;
  model: string;
  promptVersion: typeof PROMPT_VERSION;
  purpose: VenueStructuredOutputPurpose;
  finishReason?: FinishReason;
  responseId?: string;
  responseTimestamp?: string;
  warnings?: string[];
  usage?: VenueModelUsageSummary;
  providerMetadata?: ProviderMetadata;
  google?: GoogleGenerativeAIProviderMetadata;
}

export interface RunVenueStructuredOutputResult<OBJECT> {
  object: OBJECT;
  metadata: VenueStructuredOutputMetadata;
}

export interface VenueModelErrorDetails {
  provider: typeof GOOGLE_PROVIDER_NAME;
  model: string;
  mode: VenueModelMode;
}

export interface VenueStructuredOutputErrorDetails {
  provider: typeof GOOGLE_PROVIDER_NAME;
  model: string;
  purpose: VenueStructuredOutputPurpose;
}

export class VenueModelError extends Error {
  readonly details: VenueModelErrorDetails;
  override readonly cause?: unknown;

  constructor(
    message: string,
    details: VenueModelErrorDetails,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "VenueModelError";
    this.details = details;
    this.cause = options?.cause;
  }
}

export class VenueStructuredOutputError extends Error {
  readonly details: VenueStructuredOutputErrorDetails;
  override readonly cause?: unknown;

  constructor(
    message: string,
    details: VenueStructuredOutputErrorDetails,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "VenueStructuredOutputError";
    this.details = details;
    this.cause = options?.cause;
  }
}

const googleProvider = createGoogleGenerativeAI({
  apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  name: GOOGLE_PROVIDER_NAME,
});

const MODE_INSTRUCTIONS: Record<VenueModelMode, string> = {
  general_hospitality:
    "Respond like a polished hospitality assistant. Be warm, concise, and practical.",
  high_ticket_event:
    "Respond like a premium events coordinator. Be precise, detail-oriented, and avoid unsupported commitments.",
  booking_request:
    "Respond like a booking assistant. Move the guest toward the next booking step and ask only for the details needed to continue.",
  unknown_needs_review:
    "Respond cautiously. Ask clarifying questions when needed and avoid pretending certainty when the request is ambiguous.",
  sandbox:
    "Treat this as a sandbox simulation. Keep the reply useful for testing and make assumptions explicit when context is thin.",
};

const MODE_TEMPERATURE: Record<VenueModelMode, number> = {
  general_hospitality: 0.4,
  high_ticket_event: 0.3,
  booking_request: 0.2,
  unknown_needs_review: 0.1,
  sandbox: 0.6,
};

function getVenueLanguageModel() {
  return googleProvider(env.GOOGLE_MODEL);
}

function toTrimmedText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "No content provided.";
}

function formatTimestamp(timestamp?: Date | string): string {
  if (timestamp == null) {
    return "";
  }

  if (timestamp instanceof Date) {
    return ` @ ${timestamp.toISOString()}`;
  }

  return timestamp.trim().length > 0 ? ` @ ${timestamp.trim()}` : "";
}

function formatRole(role: VenueMessageRole): string {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "user":
    default:
      return "Guest";
  }
}

function indentBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatKnowledgeContext(
  knowledgeContext: RunVenueModelInput["knowledgeContext"]
): { itemCount: number; text: string } {
  if (typeof knowledgeContext === "string") {
    return {
      itemCount: knowledgeContext.trim().length > 0 ? 1 : 0,
      text:
        knowledgeContext.trim().length > 0
          ? knowledgeContext.trim()
          : "No knowledge context provided.",
    };
  }

  const items = knowledgeContext
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    return {
      itemCount: 0,
      text: "No knowledge context provided.",
    };
  }

  return {
    itemCount: items.length,
    text: items.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  };
}

function formatRecentMessages(recentMessages: readonly VenueRecentMessage[]): string {
  if (recentMessages.length === 0) {
    return "No recent messages provided.";
  }

  return recentMessages
    .map((recentMessage, index) => {
      const heading = `${index + 1}. ${formatRole(recentMessage.role)}${formatTimestamp(
        recentMessage.timestamp
      )}`;

      return `${heading}\n${indentBlock(toTrimmedText(recentMessage.content))}`;
    })
    .join("\n\n");
}

function buildVenuePrompt(input: RunVenueModelInput): {
  knowledgeContextItems: number;
  prompt: string;
  system: string;
} {
  const knowledgeContext = formatKnowledgeContext(input.knowledgeContext);
  const recentMessages = formatRecentMessages(input.recentMessages);

  const system = [
    "You are the reusable Venue OS response engine.",
    `Current mode: ${input.mode}. ${MODE_INSTRUCTIONS[input.mode]}`,
    `You are responding on behalf of ${input.venueName}.`,
    "Use the provided knowledge context and conversation history before answering.",
    "Do not invent venue-specific facts, policies, availability, pricing, or operational details.",
    "If the supplied context is not enough, say what is missing and ask a focused follow-up question.",
    "Return only the reply text that should be sent back to the requester.",
  ].join("\n");

  const prompt = [
    `Venue name: ${input.venueName}`,
    `Mode: ${input.mode}`,
    "",
    "Knowledge context:",
    knowledgeContext.text,
    "",
    "Recent messages:",
    recentMessages,
    "",
    "Latest incoming message:",
    toTrimmedText(input.message),
  ].join("\n");

  return {
    knowledgeContextItems: knowledgeContext.itemCount,
    prompt,
    system,
  };
}

function summarizeUsage(usage: LanguageModelUsage): VenueModelUsageSummary {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    raw: usage.raw,
  };
}

function extractGoogleMetadata(
  providerMetadata?: ProviderMetadata
): GoogleGenerativeAIProviderMetadata | undefined {
  const googleMetadata = providerMetadata?.[GOOGLE_PROVIDER_NAME];
  return googleMetadata as GoogleGenerativeAIProviderMetadata | undefined;
}

function summarizeWarnings(
  warnings: Awaited<ReturnType<typeof generateText>>["warnings"]
): string[] {
  return (
    warnings?.map((warning) => {
      if ("message" in warning) {
        return `${warning.type}:${warning.message}`;
      }

      if (warning.details != null) {
        return warning.details != null
          ? `${warning.type}:${warning.feature}:${warning.details}`
          : `${warning.type}:${warning.feature}`;
      }

      return `${warning.type}:${warning.feature}`;
    }) ?? []
  );
}

export async function runVenueModel(
  input: RunVenueModelInput
): Promise<RunVenueModelResult> {
  const modelId = env.GOOGLE_MODEL;
  const prompt = buildVenuePrompt(input);

  try {
    const result = await generateText({
      model: getVenueLanguageModel(),
      system: prompt.system,
      prompt: prompt.prompt,
      temperature: MODE_TEMPERATURE[input.mode],
      maxRetries: 2,
    });

    const replyText = result.text.trim();

    if (replyText.length === 0) {
      throw new VenueModelError("Venue model returned an empty reply.", {
        provider: GOOGLE_PROVIDER_NAME,
        model: modelId,
        mode: input.mode,
      });
    }

    return {
      replyText,
      classification: input.mode,
      confidence: 1,
      metadata: {
        provider: GOOGLE_PROVIDER_NAME,
        model: result.response.modelId || modelId,
        mode: input.mode,
        promptVersion: PROMPT_VERSION,
        classificationSource: "mode",
        recentMessageCount: input.recentMessages.length,
        knowledgeContextItems: prompt.knowledgeContextItems,
        finishReason: result.finishReason,
        responseId: result.response.id,
        responseTimestamp: result.response.timestamp.toISOString(),
        warnings: summarizeWarnings(result.warnings),
        usage: summarizeUsage(result.usage),
        providerMetadata: result.providerMetadata,
        google: extractGoogleMetadata(result.providerMetadata),
      },
    };
  } catch (error) {
    if (error instanceof VenueModelError) {
      throw error;
    }

    throw new VenueModelError(
      "Venue model request failed.",
      {
        provider: GOOGLE_PROVIDER_NAME,
        model: modelId,
        mode: input.mode,
      },
      { cause: error }
    );
  }
}

export async function runVenueStructuredOutput<TSchema extends z.ZodTypeAny>(
  input: RunVenueStructuredOutputInput<TSchema>
): Promise<RunVenueStructuredOutputResult<z.infer<TSchema>>> {
  const modelId = env.GOOGLE_MODEL;

  try {
    const result = await generateText({
      model: getVenueLanguageModel(),
      system: input.system,
      prompt: input.prompt,
      output: Output.object({
        schema: input.schema,
        name: input.schemaName,
        description: input.schemaDescription,
      }),
      temperature: input.temperature ?? 0,
      maxRetries: input.maxRetries ?? 2,
    });

    return {
      object: result.output as z.infer<TSchema>,
      metadata: {
        provider: GOOGLE_PROVIDER_NAME,
        model: result.response.modelId || modelId,
        promptVersion: PROMPT_VERSION,
        purpose: input.purpose,
        finishReason: result.finishReason,
        responseId: result.response.id,
        responseTimestamp: result.response.timestamp.toISOString(),
        warnings: summarizeWarnings(result.warnings),
        usage: summarizeUsage(result.usage),
        providerMetadata: result.providerMetadata,
        google: extractGoogleMetadata(result.providerMetadata),
      },
    };
  } catch (error) {
    if (error instanceof VenueStructuredOutputError) {
      throw error;
    }

    throw new VenueStructuredOutputError(
      "Venue structured output request failed.",
      {
        provider: GOOGLE_PROVIDER_NAME,
        model: modelId,
        purpose: input.purpose,
      },
      { cause: error }
    );
  }
}
