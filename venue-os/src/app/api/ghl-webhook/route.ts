import { createWebhookPostHandler } from "./handler";

export async function POST(req: Request) {
  const [
    { insertAuditLog },
    { orchestrateConversationTurn },
    { getTenantByGhlLocationId },
    {
      claimProcessedWebhookEvent,
      markProcessedWebhookEvent,
      releaseProcessedWebhookEventClaim,
    },
  ] = await Promise.all([
    import("@/src/services/audit-logs"),
    import("@/src/services/conversation-orchestrator"),
    import("@/src/services/conversations"),
    import("@/src/services/processed-webhook-events"),
  ]);

  return createWebhookPostHandler({
    getTenantByGhlLocationId,
    insertAuditLog,
    orchestrateConversationTurn,
    claimProcessedWebhookEvent,
    markProcessedWebhookEvent,
    releaseProcessedWebhookEventClaim,
  })(req);
}
