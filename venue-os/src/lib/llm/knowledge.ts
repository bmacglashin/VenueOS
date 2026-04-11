import { readFile } from "node:fs/promises";

import {
  getDefaultMockTenantSeedSpec,
  getMockTenantSeedSpecByLocationId,
  getMockTenantSeedSpecBySlug,
  type MockTenantSeedSpec,
} from "@/src/data/mock-tenants";

export interface VenueKnowledgeTenant {
  id: string;
  slug: string;
  ghl_location_id: string | null;
}

export interface GetVenueKnowledgeInput {
  tenantId?: string;
  tenantSlug?: string;
}

export interface VenueKnowledgeLoaderDependencies {
  getTenantById: (tenantId: string) => Promise<VenueKnowledgeTenant | null>;
  getTenantByGhlLocationId: (input: {
    ghlLocationId: string;
  }) => Promise<VenueKnowledgeTenant | null>;
  getFallbackLocationId: () => Promise<string | null>;
  ingestKnowledgeSource: (input: {
    tenantId: string;
    sourceType: string;
    sourceName: string;
    sourceRef?: string;
    content: string;
    revision?: string;
  }) => Promise<unknown>;
}

async function defaultGetTenantById(
  tenantId: string
): Promise<VenueKnowledgeTenant | null> {
  const { getTenantById } = await import("@/src/services/conversations");
  return getTenantById(tenantId);
}

async function defaultGetTenantByGhlLocationId(input: {
  ghlLocationId: string;
}): Promise<VenueKnowledgeTenant | null> {
  const { getTenantByGhlLocationId } = await import(
    "@/src/services/conversations"
  );
  return getTenantByGhlLocationId(input);
}

async function defaultGetFallbackLocationId(): Promise<string | null> {
  const { env } = await import("@/src/lib/config/env");
  return env.GHL_LOCATION_ID ?? null;
}

async function defaultIngestKnowledgeSource(input: {
  tenantId: string;
  sourceType: string;
  sourceName: string;
  sourceRef?: string;
  content: string;
  revision?: string;
}) {
  const { ingestKnowledgeSource } = await import(
    "@/src/services/knowledge-ingestion"
  );
  return ingestKnowledgeSource(input);
}

function buildMissingPackError(input: {
  tenantSlug: string;
  tenantId?: string;
}): Error {
  return new Error(
    `No local knowledge pack is registered for tenant slug "${input.tenantSlug}"${input.tenantId != null ? ` (tenant ${input.tenantId})` : ""}. Add a source file under src/data/ and register it in src/data/mock-tenants.ts.`
  );
}

async function readKnowledgePack(
  spec: MockTenantSeedSpec
): Promise<string> {
  try {
    return await readFile(spec.knowledge.fileUrl, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to load venue knowledge from ${spec.knowledge.filePath}. Ensure the registered tenant pack exists on disk.`,
      { cause: error }
    );
  }
}

export function createVenueKnowledgeLoader(
  overrides: Partial<VenueKnowledgeLoaderDependencies> = {}
) {
  const deps: VenueKnowledgeLoaderDependencies = {
    getTenantById: defaultGetTenantById,
    getTenantByGhlLocationId: defaultGetTenantByGhlLocationId,
    getFallbackLocationId: defaultGetFallbackLocationId,
    ingestKnowledgeSource: defaultIngestKnowledgeSource,
    ...overrides,
  };

  const knowledgeCache = new Map<string, string>();
  const knowledgeLoadPromises = new Map<string, Promise<string>>();
  const metadataSyncPromises = new Map<string, Promise<void>>();

  async function resolveTenantKnowledgeSpec(
    input: GetVenueKnowledgeInput
  ): Promise<{
    spec: MockTenantSeedSpec;
    tenant: VenueKnowledgeTenant | null;
  }> {
    if (input.tenantSlug != null) {
      const spec = getMockTenantSeedSpecBySlug(input.tenantSlug);

      if (spec == null) {
        throw buildMissingPackError({
          tenantSlug: input.tenantSlug,
          tenantId: input.tenantId,
        });
      }

      return {
        spec,
        tenant:
          input.tenantId == null ? null : await deps.getTenantById(input.tenantId),
      };
    }

    if (input.tenantId != null) {
      const tenant = await deps.getTenantById(input.tenantId);

      if (tenant == null) {
        throw new Error(
          `Tenant ${input.tenantId} was not found while resolving knowledge.`
        );
      }

      const spec = getMockTenantSeedSpecBySlug(tenant.slug);

      if (spec == null) {
        throw buildMissingPackError({
          tenantSlug: tenant.slug,
          tenantId: tenant.id,
        });
      }

      return {
        spec,
        tenant,
      };
    }

    const fallbackLocationId = await deps.getFallbackLocationId();

    if (fallbackLocationId != null) {
      const tenant = await deps.getTenantByGhlLocationId({
        ghlLocationId: fallbackLocationId,
      });
      const slugMatch =
        tenant == null ? null : getMockTenantSeedSpecBySlug(tenant.slug);

      if (slugMatch != null) {
        return {
          spec: slugMatch,
          tenant,
        };
      }

      const locationMatch = getMockTenantSeedSpecByLocationId(fallbackLocationId);

      if (locationMatch != null) {
        return {
          spec: locationMatch,
          tenant,
        };
      }
    }

    return {
      spec: getDefaultMockTenantSeedSpec(),
      tenant: null,
    };
  }

  async function syncKnowledgeMetadata(input: {
    spec: MockTenantSeedSpec;
    tenant: VenueKnowledgeTenant | null;
    knowledge: string;
  }): Promise<void> {
    if (input.tenant == null) {
      return;
    }

    try {
      await deps.ingestKnowledgeSource({
        tenantId: input.tenant.id,
        sourceName: input.spec.knowledge.sourceName,
        sourceType: input.spec.knowledge.sourceType,
        sourceRef: input.spec.knowledge.filePath,
        content: input.knowledge,
      });
    } catch (error) {
      console.warn("Knowledge metadata sync skipped.", error);
    }
  }

  async function getVenueKnowledge(
    input: GetVenueKnowledgeInput = {}
  ): Promise<string> {
    const { spec, tenant } = await resolveTenantKnowledgeSpec(input);
    const cacheKey = spec.slug;
    const metadataKey =
      tenant == null ? null : `${tenant.id}:${spec.knowledge.sourceName}`;

    if (!knowledgeCache.has(cacheKey)) {
      if (!knowledgeLoadPromises.has(cacheKey)) {
        knowledgeLoadPromises.set(cacheKey, readKnowledgePack(spec));
      }

      const knowledge = await knowledgeLoadPromises.get(cacheKey);

      if (knowledge == null) {
        throw new Error(
          `Knowledge load did not return content for tenant slug "${spec.slug}".`
        );
      }

      knowledgeCache.set(cacheKey, knowledge);
    }

    const knowledge = knowledgeCache.get(cacheKey);

    if (knowledge == null) {
      throw new Error(
        `Knowledge cache did not resolve for tenant slug "${spec.slug}".`
      );
    }

    if (metadataKey != null && !metadataSyncPromises.has(metadataKey)) {
      metadataSyncPromises.set(
        metadataKey,
        syncKnowledgeMetadata({
          spec,
          tenant,
          knowledge,
        })
      );
    }

    if (metadataKey != null) {
      await metadataSyncPromises.get(metadataKey);
    }

    return knowledge;
  }

  function resetVenueKnowledgeCacheForDev(): void {
    knowledgeCache.clear();
    knowledgeLoadPromises.clear();
    metadataSyncPromises.clear();
  }

  return {
    getVenueKnowledge,
    resetVenueKnowledgeCacheForDev,
  };
}

const venueKnowledgeLoader = createVenueKnowledgeLoader();

export const getVenueKnowledge = venueKnowledgeLoader.getVenueKnowledge;
export const resetVenueKnowledgeCacheForDev =
  venueKnowledgeLoader.resetVenueKnowledgeCacheForDev;
