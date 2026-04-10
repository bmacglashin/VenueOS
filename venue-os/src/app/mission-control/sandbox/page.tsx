import type { Metadata } from "next";
import Link from "next/link";

import { ConversationList } from "@/src/components/mission-control/conversation-list";
import { DraftReviewPanel } from "@/src/components/mission-control/draft-review-panel";
import { JsonPanel } from "@/src/components/mission-control/json-panel";
import { MessageTranscript } from "@/src/components/mission-control/message-transcript";
import { MissionControlShell } from "@/src/components/mission-control/mission-control-shell";
import { SandboxForm } from "@/src/components/mission-control/sandbox-form";
import { getMissionControlSandboxData } from "@/src/services/mission-control";

export const metadata: Metadata = {
  title: "Mission Control Sandbox",
};

interface MissionControlSandboxPageProps {
  searchParams: Promise<{
    tenantId?: string | string[];
    conversationId?: string | string[];
  }>;
}

function readSearchParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default async function MissionControlSandboxPage({
  searchParams,
}: MissionControlSandboxPageProps) {
  const resolvedSearchParams = await searchParams;
  const tenantId = readSearchParam(resolvedSearchParams.tenantId);
  const conversationId = readSearchParam(resolvedSearchParams.conversationId);

  try {
    const data = await getMissionControlSandboxData({
      tenantId,
      conversationId,
    });

    return (
      <MissionControlShell
        title="Sandbox tester"
        description="Internal-only route for QA and demos. Submit a test inbound message and inspect the resulting transcript and AI draft without any outbound send."
        selectedTenantName={
          data.selectedConversation?.tenant.name ?? data.selectedTenant?.name
        }
      >
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-6">
            <SandboxForm
              tenants={data.tenants}
              selectedTenant={data.selectedConversation?.tenant ?? data.selectedTenant}
              conversationId={data.selectedConversation?.conversation.id}
              willCreateTenantOnFirstRun={data.willCreateTenantOnFirstRun}
            />
            <ConversationList
              conversations={data.conversations}
              selectedConversationId={data.selectedConversation?.conversation.id}
              emptyMessage={
                data.selectedTenant == null
                  ? "No tenant exists yet. Submit the first sandbox message to create an internal-only tenant."
                  : "No stored sandbox-accessible conversations were found for this tenant yet."
              }
            />
          </div>
          {data.selectedConversation == null ? (
            <section className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-sm leading-7 text-zinc-400">
              Submit a sandbox message to create or continue an internal thread.
              After the turn runs, this page will show the stored transcript, AI
              draft, and the linked conversation detail route for handoff to QA
              or demos.
            </section>
          ) : (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Latest sandbox result
                    </h2>
                    <p className="mt-1 text-sm text-zinc-400">
                      This thread used the shared orchestration service and wrote
                      real message + draft records.
                    </p>
                  </div>
                  <Link
                    href={`/mission-control/conversations/${data.selectedConversation.conversation.id}`}
                    className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-950"
                  >
                    Open full conversation detail
                  </Link>
                </div>
              </div>
              <MessageTranscript messages={data.selectedConversation.messages} />
              <div className="grid gap-6 lg:grid-cols-2">
                <DraftReviewPanel
                  latestAiDraftMessage={data.selectedConversation.latestAiDraftMessage}
                  draftRouteCategory={data.selectedConversation.draftRouteCategory}
                  draftRequiresHumanReview={
                    data.selectedConversation.draftRequiresHumanReview
                  }
                />
                <JsonPanel
                  title="Latest inbound raw payload"
                  description="Sandbox submissions store an internal raw payload envelope so QA can inspect what reached orchestration."
                  value={data.selectedConversation.latestInboundMessage?.raw_payload}
                />
              </div>
            </div>
          )}
        </div>
      </MissionControlShell>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown backend failure.";

    return (
      <MissionControlShell
        title="Sandbox tester"
        description="Internal-only route for QA and demos. Submit a test inbound message and inspect the resulting transcript and AI draft without any outbound send."
      >
        <JsonPanel
          title="Backend diagnostics"
          description="Mission Control could not initialize sandbox data from the configured backend."
          value={{
            error: message,
            tenantId: tenantId ?? null,
            conversationId: conversationId ?? null,
          }}
        />
      </MissionControlShell>
    );
  }
}
