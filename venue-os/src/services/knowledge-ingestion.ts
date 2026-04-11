import { createHash } from "node:crypto";
import { basename } from "node:path";

import type { Database } from "@/src/lib/db/supabase";
import { DatabaseError } from "@/src/lib/observability";

type KnowledgeSource = Database["public"]["Tables"]["knowledge_sources"]["Row"];

type KnowledgeSourceInsert = Database["public"]["Tables"]["knowledge_sources"]["Insert"];
type KnowledgeSourceUpdate = Database["public"]["Tables"]["knowledge_sources"]["Update"];

export interface IngestKnowledgeSourceInput {
  tenantId: string;
  sourceType: string;
  sourceName: string;
  sourceRef?: string;
  content: string;
  revision?: string;
}

export interface IngestKnowledgeSourceResult {
  record: KnowledgeSource;
  checksum: string;
  status: "created" | "updated" | "unchanged";
}

interface KnowledgeIngestionRepo {
  findByChecksum(input: {
    tenantId: string;
    sourceType: string;
    sourceName: string;
    checksum: string;
  }): Promise<KnowledgeSource | null>;
  findActiveBySource(input: {
    tenantId: string;
    sourceType: string;
    sourceName: string;
  }): Promise<KnowledgeSource | null>;
  setInactiveBySource(input: {
    tenantId: string;
    sourceType: string;
    sourceName: string;
    excludeId?: string;
  }): Promise<void>;
  insert(record: KnowledgeSourceInsert): Promise<KnowledgeSource>;
  updateById(id: string, update: KnowledgeSourceUpdate): Promise<KnowledgeSource>;
}

function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function resolveRevision(input: { revision?: string; checksum: string }): string {
  const trimmed = input.revision?.trim();
  if (trimmed) {
    return trimmed;
  }

  return `sha256:${input.checksum.slice(0, 12)}`;
}

function resolveFileName(sourceRef: string | undefined, sourceName: string): string {
  if (!sourceRef || sourceRef.trim().length === 0) {
    return sourceName;
  }

  const fileName = basename(sourceRef);
  return fileName.trim().length > 0 ? fileName : sourceName;
}

async function getSupabaseAdminClient() {
  const { createSupabaseAdminClient } = await import("@/src/lib/db/admin");
  return createSupabaseAdminClient();
}

function createKnowledgeIngestionRepo(): KnowledgeIngestionRepo {
  return {
    async findByChecksum(input) {
      const supabase = await getSupabaseAdminClient();
      const result = await supabase
        .from("knowledge_sources")
        .select("*")
        .eq("tenant_id", input.tenantId)
        .eq("source_type", input.sourceType)
        .eq("source_name", input.sourceName)
        .eq("checksum", input.checksum)
        .maybeSingle();

      if (result.error != null) {
        throw new DatabaseError(
          `Failed to lookup knowledge source by checksum: ${result.error.message}`,
          { cause: result.error }
        );
      }

      return result.data;
    },

    async findActiveBySource(input) {
      const supabase = await getSupabaseAdminClient();
      const result = await supabase
        .from("knowledge_sources")
        .select("*")
        .eq("tenant_id", input.tenantId)
        .eq("source_type", input.sourceType)
        .eq("source_name", input.sourceName)
        .eq("status", "active")
        .order("ingested_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (result.error != null) {
        throw new DatabaseError(
          `Failed to lookup active knowledge source: ${result.error.message}`,
          { cause: result.error }
        );
      }

      return result.data;
    },

    async setInactiveBySource(input) {
      const supabase = await getSupabaseAdminClient();
      let query = supabase
        .from("knowledge_sources")
        .update({ status: "inactive" })
        .eq("tenant_id", input.tenantId)
        .eq("source_type", input.sourceType)
        .eq("source_name", input.sourceName)
        .eq("status", "active");

      if (input.excludeId != null) {
        query = query.neq("id", input.excludeId);
      }

      const result = await query;

      if (result.error != null) {
        throw new DatabaseError(
          `Failed to mark existing knowledge sources inactive: ${result.error.message}`,
          { cause: result.error }
        );
      }
    },

    async insert(record) {
      const supabase = await getSupabaseAdminClient();
      const result = await supabase
        .from("knowledge_sources")
        .insert(record)
        .select("*")
        .single();

      if (result.error != null || result.data == null) {
        throw new DatabaseError(
          `Failed to insert knowledge source metadata: ${result.error?.message ?? "no data returned"}`,
          { cause: result.error }
        );
      }

      return result.data;
    },

    async updateById(id, update) {
      const supabase = await getSupabaseAdminClient();
      const result = await supabase
        .from("knowledge_sources")
        .update(update)
        .eq("id", id)
        .select("*")
        .single();

      if (result.error != null || result.data == null) {
        throw new DatabaseError(
          `Failed to update knowledge source metadata: ${result.error?.message ?? "no data returned"}`,
          { cause: result.error }
        );
      }

      return result.data;
    },
  };
}

export async function ingestKnowledgeSource(
  input: IngestKnowledgeSourceInput,
  dependencies: {
    repo?: KnowledgeIngestionRepo;
    now?: () => Date;
  } = {}
): Promise<IngestKnowledgeSourceResult> {
  const repo = dependencies.repo ?? createKnowledgeIngestionRepo();
  const now = dependencies.now ?? (() => new Date());

  const checksum = computeChecksum(input.content);
  const revision = resolveRevision({ revision: input.revision, checksum });
  const sourceRef = input.sourceRef?.trim() || null;
  const fileName = resolveFileName(sourceRef ?? undefined, input.sourceName);
  const ingestedAt = now().toISOString();

  const existingByChecksum = await repo.findByChecksum({
    tenantId: input.tenantId,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    checksum,
  });

  if (existingByChecksum != null) {
    if (existingByChecksum.status !== "active") {
      await repo.setInactiveBySource({
        tenantId: input.tenantId,
        sourceType: input.sourceType,
        sourceName: input.sourceName,
        excludeId: existingByChecksum.id,
      });

      const reactivated = await repo.updateById(existingByChecksum.id, {
        status: "active",
        source_ref: sourceRef,
        file_name: fileName,
        revision,
        ingested_at: ingestedAt,
      });

      return {
        record: reactivated,
        checksum,
        status: "updated",
      };
    }

    return {
      record: existingByChecksum,
      checksum,
      status: "unchanged",
    };
  }

  const currentActive = await repo.findActiveBySource({
    tenantId: input.tenantId,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
  });

  if (currentActive != null) {
    await repo.setInactiveBySource({
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
    });
  }

  const created = await repo.insert({
    tenant_id: input.tenantId,
    source_type: input.sourceType,
    source_name: input.sourceName,
    source_ref: sourceRef,
    file_name: fileName,
    content: input.content,
    checksum,
    revision,
    ingested_at: ingestedAt,
    status: "active",
  });

  return {
    record: created,
    checksum,
    status: "created",
  };
}
