import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ingestKnowledgeSource } from "./knowledge-ingestion";

type MockRecord = {
  id: string;
  tenant_id: string;
  source_type: string;
  source_name: string;
  source_ref: string | null;
  file_name: string | null;
  content: string;
  checksum: string;
  revision: string;
  ingested_at: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function createRepo(records: MockRecord[]) {
  const state = records;

  return {
    state,
    async findByChecksum(input: {
      tenantId: string;
      sourceType: string;
      sourceName: string;
      checksum: string;
    }) {
      return (
        state.find(
          (item) =>
            item.tenant_id === input.tenantId &&
            item.source_type === input.sourceType &&
            item.source_name === input.sourceName &&
            item.checksum === input.checksum
        ) ?? null
      );
    },
    async findActiveBySource(input: {
      tenantId: string;
      sourceType: string;
      sourceName: string;
    }) {
      return (
        state.find(
          (item) =>
            item.tenant_id === input.tenantId &&
            item.source_type === input.sourceType &&
            item.source_name === input.sourceName &&
            item.status === "active"
        ) ?? null
      );
    },
    async setInactiveBySource(input: {
      tenantId: string;
      sourceType: string;
      sourceName: string;
      excludeId?: string;
    }) {
      for (const record of state) {
        if (
          record.tenant_id === input.tenantId &&
          record.source_type === input.sourceType &&
          record.source_name === input.sourceName &&
          record.status === "active" &&
          record.id !== input.excludeId
        ) {
          record.status = "inactive";
        }
      }
    },
    async insert(record: Omit<MockRecord, "id" | "created_at" | "updated_at">) {
      const inserted: MockRecord = {
        ...record,
        id: `row-${state.length + 1}`,
        created_at: record.ingested_at,
        updated_at: record.ingested_at,
      };

      state.push(inserted);
      return inserted;
    },
    async updateById(id: string, update: Partial<MockRecord>) {
      const existing = state.find((record) => record.id === id);

      if (!existing) {
        throw new Error(`Record ${id} not found`);
      }

      Object.assign(existing, update);
      return existing;
    },
  };
}

describe("ingestKnowledgeSource", () => {
  it("persists metadata and marks previous active source inactive when content changes", async () => {
    const repo = createRepo([
      {
        id: "row-1",
        tenant_id: "tenant-1",
        source_type: "markdown",
        source_name: "veritas-knowledge",
        source_ref: "src/data/veritas-knowledge.md",
        file_name: "veritas-knowledge.md",
        content: "old content",
        checksum: "old-checksum",
        revision: "v1",
        ingested_at: "2026-04-01T00:00:00.000Z",
        status: "active",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:00.000Z",
      },
    ]);

    const result = await ingestKnowledgeSource(
      {
        tenantId: "tenant-1",
        sourceType: "markdown",
        sourceName: "veritas-knowledge",
        sourceRef: "src/data/veritas-knowledge.md",
        content: "new content",
        revision: "v2",
      },
      {
        repo,
        now: () => new Date("2026-04-11T12:00:00.000Z"),
      }
    );

    assert.equal(result.status, "created");
    assert.equal(repo.state.length, 2);
    assert.equal(repo.state[0]?.status, "inactive");
    assert.equal(repo.state[1]?.status, "active");
    assert.equal(repo.state[1]?.source_name, "veritas-knowledge");
    assert.equal(repo.state[1]?.source_ref, "src/data/veritas-knowledge.md");
    assert.equal(repo.state[1]?.file_name, "veritas-knowledge.md");
    assert.equal(repo.state[1]?.revision, "v2");
    assert.equal(repo.state[1]?.ingested_at, "2026-04-11T12:00:00.000Z");
  });

  it("returns unchanged for re-ingesting matching checksum", async () => {
    const repo = createRepo([
      {
        id: "row-1",
        tenant_id: "tenant-1",
        source_type: "markdown",
        source_name: "veritas-knowledge",
        source_ref: "src/data/veritas-knowledge.md",
        file_name: "veritas-knowledge.md",
        content: "same content",
        checksum:
          "a636bd7cd42060a4d07fa1bfbcc010eb7794c2ba721e1e3e4c20335a15b66eaf",
        revision: "v1",
        ingested_at: "2026-04-01T00:00:00.000Z",
        status: "active",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:00.000Z",
      },
    ]);

    const result = await ingestKnowledgeSource(
      {
        tenantId: "tenant-1",
        sourceType: "markdown",
        sourceName: "veritas-knowledge",
        sourceRef: "src/data/veritas-knowledge.md",
        content: "same content",
      },
      {
        repo,
        now: () => new Date("2026-04-11T12:00:00.000Z"),
      }
    );

    assert.equal(result.status, "unchanged");
    assert.equal(repo.state.length, 1);
    assert.equal(repo.state[0]?.status, "active");
    assert.equal(repo.state[0]?.revision, "v1");
    assert.equal(repo.state[0]?.ingested_at, "2026-04-01T00:00:00.000Z");
  });
});
