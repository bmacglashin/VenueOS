# GHL shadow contract

This folder defines a typed, no-I/O shadow adapter for GoHighLevel. Canonical DTOs stay internal-first and GHL payloads are only produced or consumed through mapper functions and the provider contract.

## Assumptions

- `tenantId` and every `canonicalId` remain internal-only and never serialize into GHL payloads.
- `locationId` comes from the tenant/integration context, not from the canonical DTOs themselves.
- Contact, note, and opportunity payloads use the shared fields surfaced by the official HighLevel resource and webhook docs so the adapter stays stable before live wiring.
- `CanonicalCustomFieldValue.fieldKey` currently maps directly to `customFields[].id`. This assumes the caller has already resolved the correct GHL custom field identifier.
- Outbound messaging uses the HighLevel Conversation Provider outbound payload shape. That payload does not expose a conversation id, so `conversationExternalId` stays internal-only on the canonical DTO.
- Email recipients are normalized to `string[]`. This is based on the official outbound-provider example, even though one schema line currently describes `emailTo` as a singular string.
- `createdAt` maps to GHL `dateAdded` where available. `updatedAt` maps back as `null` because the referenced GHL payloads do not consistently expose a matching update timestamp.

## References

- [Create Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/)
- [Create Note](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-note/)
- [Opportunities API](https://marketplace.gohighlevel.com/docs/ghl/opportunities/opportunities/)
- [Conversation Provider - Outbound Message](https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/index.html)
