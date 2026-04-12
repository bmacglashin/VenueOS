import nextEnv from "@next/env";

import { readFile } from "node:fs/promises";

import type { Json } from "../src/lib/db/supabase";
import { listMockTenantSeedSpecs } from "../src/data/mock-tenants";
import { AI_DRAFT_SOURCE } from "../src/services/draft-history";

const { loadEnvConfig } = nextEnv;

function isJsonObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSeedKey(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const seed = value.seed;

  if (!isJsonObject(seed) || typeof seed.key !== "string") {
    return null;
  }

  const trimmed = seed.key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const [
    { findOrCreateConversation, findOrCreateTenant },
    {
      findMessageByGhlMessageIdForTenant,
      insertInboundMessage,
      insertOutboundMessage,
      listConversationMessages,
    },
    { ingestKnowledgeSource },
  ] = await Promise.all([
    import("../src/services/conversations"),
    import("../src/services/messages"),
    import("../src/services/knowledge-ingestion"),
  ]);

  for (const spec of listMockTenantSeedSpecs()) {
    const tenant = await findOrCreateTenant({
      slug: spec.slug,
      name: spec.name,
      ghlLocationId: spec.ghlLocationId,
    });
    const knowledge = await readFile(spec.knowledge.fileUrl, "utf8");

    await ingestKnowledgeSource({
      tenantId: tenant.id,
      sourceType: spec.knowledge.sourceType,
      sourceName: spec.knowledge.sourceName,
      sourceRef: spec.knowledge.filePath,
      content: knowledge,
    });

    const conversation = await findOrCreateConversation({
      tenantId: tenant.id,
      ghlContactId: spec.sampleConversation.ghlContactId,
      ghlConversationId: spec.sampleConversation.ghlConversationId,
      status: "open",
    });

    const inboundMessage =
      (await findMessageByGhlMessageIdForTenant({
        tenantId: tenant.id,
        ghlMessageId: spec.sampleConversation.inboundMessageId,
      })) ??
      (await insertInboundMessage({
        conversationId: conversation.id,
        role: "user",
        content: spec.sampleConversation.inboundContent,
        source: "website_inquiry_seed",
        status: "recorded",
        ghlMessageId: spec.sampleConversation.inboundMessageId,
        rawPayload: toJsonValue({
          seed: {
            key: spec.sampleConversation.seedKey,
            tenantSlug: spec.slug,
            tenantName: spec.name,
          },
          channel: "website",
        }),
        metadata: toJsonValue({
          seed: {
            key: spec.sampleConversation.seedKey,
          },
          channel: "website",
        }),
      }));

    const existingMessages = await listConversationMessages(conversation.id);
    const existingDraft = existingMessages.find(
      (message) =>
        message.source === AI_DRAFT_SOURCE &&
        readSeedKey(message.metadata) === spec.sampleConversation.seedKey
    );

    if (existingDraft == null) {
      await insertOutboundMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: spec.sampleConversation.draftContent,
        source: AI_DRAFT_SOURCE,
        status: "queued_for_review",
        metadata: toJsonValue({
          kind: "ai_draft",
          seed: {
            key: spec.sampleConversation.seedKey,
            tenantSlug: spec.slug,
          },
          route: {
            category: spec.sampleConversation.routeCategory,
            confidence: spec.sampleConversation.routeConfidence,
            requiresHumanReview: true,
            rationale:
              "Seeded review candidate used for second-tenant Mission Control validation.",
          },
          responsePolicy: {
            decision: spec.sampleConversation.policyDecision,
            reasons: spec.sampleConversation.policyReasons,
            transportAllowed: false,
            evaluatedAt: spec.sampleConversation.occurredAt,
          },
          outboundDelivery: {
            action: "queue",
            reasons: spec.sampleConversation.policyReasons,
            transport: null,
          },
          router: {
            persistence: {
              venueId: tenant.id,
              venueName: tenant.name,
              conversationId: conversation.id,
              inboundMessageId: inboundMessage.id,
              receivedAt: spec.sampleConversation.occurredAt,
              routedAt: spec.sampleConversation.occurredAt,
              routeCategory: spec.sampleConversation.routeCategory,
              routeConfidence: spec.sampleConversation.routeConfidence,
              requiresHumanReview: true,
              rationale:
                "Seeded review candidate used for second-tenant Mission Control validation.",
              replySource: "venue_model",
            },
          },
        }),
        policyDecision: spec.sampleConversation.policyDecision,
        policyReasons: spec.sampleConversation.policyReasons,
        policyEvaluatedAt: spec.sampleConversation.occurredAt,
      });
    }

    console.log(
      `Seeded mock tenant ${tenant.slug} (${tenant.id}) with knowledge "${spec.knowledge.sourceName}" and conversation ${conversation.id}.`
    );
  }

  console.log("Mock tenant seed complete.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Mock tenant seed failed: ${message}`);
  process.exit(1);
});
