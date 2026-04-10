import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuditLogPanel } from "@/src/components/mission-control/audit-log-panel";
import { ConversationList } from "@/src/components/mission-control/conversation-list";
import { DraftReviewPanel } from "@/src/components/mission-control/draft-review-panel";
import { JsonPanel } from "@/src/components/mission-control/json-panel";
import { MessageTranscript } from "@/src/components/mission-control/message-transcript";
import { MissionControlShell } from "@/src/components/mission-control/mission-control-shell";
import { getMissionControlConversationDetail } from "@/src/services/mission-control";

interface MissionControlConversationPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: MissionControlConversationPageProps): Promise<Metadata> {
  const { id } = await params;

  return {
    title: `Conversation ${id.slice(0, 8)}`,
  };
}

export default async function MissionControlConversationPage({
  params,
}: MissionControlConversationPageProps) {
  const { id } = await params;

  try {
    const data = await getMissionControlConversationDetail(id);

    if (data == null) {
      notFound();
    }

    return (
      <MissionControlShell
        title={`Conversation ${data.conversation.id.slice(0, 8)}`}
        description="Internal conversation detail view with transcript, AI draft review, manual override staging, and raw payload / log panels."
        selectedTenantName={data.tenant.name}
        resolvedOutboundMode={data.resolvedOutboundMode}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              tenant
            </p>
            <p className="mt-2 text-lg font-semibold text-zinc-100">
              {data.tenant.name}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              messages
            </p>
            <p className="mt-2 text-lg font-semibold text-zinc-100">
              {data.messages.length}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              status
            </p>
            <p className="mt-2 text-lg font-semibold text-zinc-100">
              {data.conversation.status}
            </p>
          </section>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <ConversationList
            conversations={data.conversations}
            selectedConversationId={data.conversation.id}
            emptyMessage="No other conversations are available for this tenant yet."
          />
          <MessageTranscript messages={data.messages} />
          <div className="space-y-6">
            <DraftReviewPanel
              latestAiDraftMessage={data.latestAiDraftMessage}
              draftRouteCategory={data.draftRouteCategory}
              draftPolicyDecision={data.draftPolicyDecision}
              draftOutboundAction={data.draftOutboundAction}
              draftPolicyReasonCodes={data.draftPolicyReasonCodes}
              draftRequiresHumanReview={data.draftRequiresHumanReview}
            />
            <JsonPanel
              title="Raw payload panel"
              description="Latest inbound raw payload captured during ingestion."
              value={data.latestInboundMessage?.raw_payload}
            />
            <JsonPanel
              title="Draft metadata"
              description="Stored routing and persistence metadata attached to the latest AI draft."
              value={data.latestAiDraftMessage?.metadata}
            />
            <AuditLogPanel logs={data.auditLogs} />
          </div>
        </div>
      </MissionControlShell>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown backend failure.";

    return (
      <MissionControlShell
        title={`Conversation ${id.slice(0, 8)}`}
        description="Internal conversation detail view with transcript, AI draft review, manual override staging, and raw payload / log panels."
      >
        <JsonPanel
          title="Backend diagnostics"
          description="Mission Control could not load this conversation from the configured backend."
          value={{
            conversationId: id,
            error: message,
          }}
        />
      </MissionControlShell>
    );
  }
}
