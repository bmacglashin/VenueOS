import "server-only";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const KNOWLEDGE_FILE_URL = new URL("../../data/veritas-knowledge.md", import.meta.url);
const KNOWLEDGE_FILE_PATH = fileURLToPath(KNOWLEDGE_FILE_URL);

const KNOWLEDGE_SOURCE_NAME = "veritas-knowledge";
const KNOWLEDGE_SOURCE_TYPE = "markdown";

let venueKnowledgeCache: string | null = null;
let venueKnowledgeLoadPromise: Promise<string> | null = null;
let venueKnowledgeMetadataSyncPromise: Promise<void> | null = null;

async function loadVenueKnowledgeFromDisk(): Promise<string> {
  try {
    return await readFile(KNOWLEDGE_FILE_URL, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to load venue knowledge from ${KNOWLEDGE_FILE_PATH}. Ensure src/data/veritas-knowledge.md exists.`,
      { cause: error }
    );
  }
}

async function syncVenueKnowledgeMetadata(knowledge: string): Promise<void> {
  try {
    const [{ env }, { getTenantByGhlLocationId }, { ingestKnowledgeSource }] =
      await Promise.all([
        import("@/src/lib/config/env"),
        import("@/src/services/conversations"),
        import("@/src/services/knowledge-ingestion"),
      ]);

    const tenant = await getTenantByGhlLocationId({
      ghlLocationId: env.GHL_LOCATION_ID,
    });

    if (tenant == null) {
      return;
    }

    await ingestKnowledgeSource({
      tenantId: tenant.id,
      sourceName: KNOWLEDGE_SOURCE_NAME,
      sourceType: KNOWLEDGE_SOURCE_TYPE,
      sourceRef: KNOWLEDGE_FILE_PATH,
      content: knowledge,
    });
  } catch (error) {
    console.warn("Knowledge metadata sync skipped.", error);
  }
}

export async function getVenueKnowledge(): Promise<string> {
  if (venueKnowledgeCache != null) {
    return venueKnowledgeCache;
  }

  if (venueKnowledgeLoadPromise == null) {
    venueKnowledgeLoadPromise = loadVenueKnowledgeFromDisk();
  }

  const knowledge = await venueKnowledgeLoadPromise;

  if (venueKnowledgeMetadataSyncPromise == null) {
    venueKnowledgeMetadataSyncPromise = syncVenueKnowledgeMetadata(knowledge);
  }

  await venueKnowledgeMetadataSyncPromise;

  venueKnowledgeCache = knowledge;
  return knowledge;
}

export function resetVenueKnowledgeCacheForDev(): void {
  venueKnowledgeCache = null;
  venueKnowledgeLoadPromise = null;
  venueKnowledgeMetadataSyncPromise = null;
}
