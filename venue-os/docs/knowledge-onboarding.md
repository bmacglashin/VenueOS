# Knowledge Onboarding SOP

This runbook defines the repeatable process for adding or refreshing venue knowledge content while preserving deterministic metadata in `knowledge_sources`.

## Folder and file conventions

- Keep the runtime knowledge entry point in `src/lib/llm/knowledge.ts`.
- Store local source files in `src/data/`.
- Use tenant-specific names when multiple sources are introduced (example: `oakridge-knowledge.md`).
- Prefer Markdown (`.md`) for deterministic diffs and source-control review.

## Naming rules

- `source_type`: lowercase classifier of input type (example: `markdown`, `pdf`, `csv`).
- `source_name`: stable logical source identifier, kebab-case, no file extension (example: `veritas-knowledge`).
- `source_ref`: original file path or source filename (example: `src/data/veritas-knowledge.md`, `faq-export-2026-04-11.csv`).
- `revision`: explicit revision marker if provided by operators (`v3`, `2026-04-11-cms-export`). If omitted, ingestion falls back to a deterministic checksum-derived marker.

## Required metadata fields (`knowledge_sources`)

Each ingestion must persist:

1. `tenant_id`
2. `source_name`
3. `source_type`
4. `source_ref` (path or original filename)
5. `checksum` (sha256 of content)
6. `revision` (explicit or checksum-derived)
7. `ingested_at`
8. `status` (`active` or `inactive`)

## Step-by-step ingestion SOP

1. Confirm tenant exists in `venue_tenants` and is mapped to the runtime location ID (`GHL_LOCATION_ID`) or seeded mock location id.
2. Place or update the source file in `src/data/`.
3. Register the tenant slug and source file in `src/data/mock-tenants.ts` so `src/lib/llm/knowledge.ts` can resolve the correct pack per tenant.
4. Trigger knowledge load by executing a route that calls `getVenueKnowledge()` (webhook path, sandbox flow, or targeted test).
5. Verify `knowledge_sources` behavior:
   - First ingest creates a new `active` row.
   - Re-ingest with identical content returns `unchanged` behavior (no duplicate row).
   - Re-ingest with modified content creates a new `active` row and marks the previous active row `inactive`.
6. Validate with automated tests before merge.

## Common failure cases

- **Tenant not found for runtime location:** metadata sync is skipped; confirm `GHL_LOCATION_ID` or mock location mapping.
- **Tenant slug missing from the knowledge registry:** add the local source file to `src/data/` and register it in `src/data/mock-tenants.ts`.
- **Duplicate rows for identical content:** ensure checksum uniqueness index exists and migration `0006_knowledge_source_metadata.sql` is applied.
- **Wrong source_name/source_type pairing:** creates parallel source history; keep naming stable per source.
- **Unexpected active row count > 1 for same source:** re-run ingestion after fixing stale rows or migration state; active toggling assumes one canonical active version.
- **Missing revision marker in operator workflows:** acceptable; fallback revision is generated from checksum.
