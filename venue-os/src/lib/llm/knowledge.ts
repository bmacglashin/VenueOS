import "server-only";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const KNOWLEDGE_FILE_URL = new URL("../../data/veritas-knowledge.md", import.meta.url);
const KNOWLEDGE_FILE_PATH = fileURLToPath(KNOWLEDGE_FILE_URL);

let venueKnowledgeCache: string | null = null;
let venueKnowledgeLoadPromise: Promise<string> | null = null;

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

export async function getVenueKnowledge(): Promise<string> {
  if (venueKnowledgeCache != null) {
    return venueKnowledgeCache;
  }

  if (venueKnowledgeLoadPromise == null) {
    venueKnowledgeLoadPromise = loadVenueKnowledgeFromDisk();
  }

  const knowledge = await venueKnowledgeLoadPromise;
  venueKnowledgeCache = knowledge;

  return knowledge;
}

export function resetVenueKnowledgeCacheForDev(): void {
  venueKnowledgeCache = null;
  venueKnowledgeLoadPromise = null;
}
