# Second-Tenant Validation Checklist

Use this checklist after adding or refreshing a second mock tenant in local/dev.

## Seed and knowledge

1. Run `npm run seed:mock-tenants`.
2. Confirm two tenants exist in `venue_tenants`:
   - `veritas`
   - `harborview-loft`
3. Confirm `knowledge_sources` has an active row for each tenant:
   - `veritas-knowledge`
   - `harborview-loft-knowledge`
4. Confirm each seeded conversation has at least one inbound message and one queued AI draft.

## Isolation checks

1. Open `/mission-control?tenantId=<tenant-a-id>` and confirm only Tenant A review rows appear.
2. Open a Tenant A conversation from the filtered queue and confirm the URL keeps `tenantId=<tenant-a-id>`.
3. Repeat the same check for Tenant B.
4. In `/mission-control/sandbox`, pick Tenant A and confirm the conversation list only shows Tenant A threads.
5. Attempt to open a Tenant B conversation while `tenantId=<tenant-a-id>` is present and confirm the detail view does not render cross-tenant data.

## Validation

1. Run `npm test`.
2. Run `npm run lint`.
3. If either check fails, fix the tenant-scoped retrieval path before merging.
