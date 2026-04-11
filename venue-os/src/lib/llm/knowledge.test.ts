import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVenueKnowledgeLoader } from "./knowledge";

describe("createVenueKnowledgeLoader", () => {
  it("loads the registered knowledge pack for each tenant and syncs metadata per tenant", async () => {
    const ingested: Array<{ tenantId: string; sourceName: string }> = [];
    const loader = createVenueKnowledgeLoader({
      getTenantById: async (tenantId) => {
        switch (tenantId) {
          case "tenant-a":
            return {
              id: "tenant-a",
              slug: "veritas",
              ghl_location_id: "mock-veritas-location",
            };
          case "tenant-b":
            return {
              id: "tenant-b",
              slug: "harborview-loft",
              ghl_location_id: "mock-harborview-location",
            };
          default:
            return null;
        }
      },
      getTenantByGhlLocationId: async () => null,
      getFallbackLocationId: async () => null,
      ingestKnowledgeSource: async (input) => {
        ingested.push({
          tenantId: input.tenantId,
          sourceName: input.sourceName,
        });
      },
    });

    const tenantAKnowledge = await loader.getVenueKnowledge({
      tenantId: "tenant-a",
    });
    const tenantBKnowledge = await loader.getVenueKnowledge({
      tenantId: "tenant-b",
    });

    assert.match(tenantAKnowledge, /151 Veritas Lane/);
    assert.match(tenantBKnowledge, /240 Harbor Street/);
    assert.notEqual(tenantAKnowledge, tenantBKnowledge);
    assert.deepEqual(ingested, [
      {
        tenantId: "tenant-a",
        sourceName: "veritas-knowledge",
      },
      {
        tenantId: "tenant-b",
        sourceName: "harborview-loft-knowledge",
      },
    ]);
  });

  it("fails loudly when a tenant slug has no registered local knowledge pack", async () => {
    const loader = createVenueKnowledgeLoader({
      getTenantById: async () => ({
        id: "tenant-missing",
        slug: "unknown-tenant",
        ghl_location_id: null,
      }),
      getTenantByGhlLocationId: async () => null,
      getFallbackLocationId: async () => null,
      ingestKnowledgeSource: async () => undefined,
    });

    await assert.rejects(
      loader.getVenueKnowledge({
        tenantId: "tenant-missing",
      }),
      /No local knowledge pack is registered/
    );
  });
});
