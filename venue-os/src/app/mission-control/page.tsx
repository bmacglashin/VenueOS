import type { Metadata } from "next";

import { ConversationList } from "@/src/components/mission-control/conversation-list";
import { JsonPanel } from "@/src/components/mission-control/json-panel";
import { MissionControlShell } from "@/src/components/mission-control/mission-control-shell";
import { TenantSelectForm } from "@/src/components/mission-control/tenant-select-form";
import { getMissionControlOverview } from "@/src/services/mission-control";

export const metadata: Metadata = {
  title: "Mission Control Queue",
};

interface MissionControlPageProps {
  searchParams: Promise<{
    tenantId?: string | string[];
  }>;
}

function readSearchParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default async function MissionControlPage({
  searchParams,
}: MissionControlPageProps) {
  const tenantId = readSearchParam((await searchParams).tenantId);

  try {
    const data = await getMissionControlOverview({
      tenantId,
    });

    return (
      <MissionControlShell
        title="Mission Control v0"
        description="Internal review surface for QA and demos. This route reads real conversation, draft, and audit data without exposing any outbound send controls."
        selectedTenantName={data.selectedTenant?.name}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              conversations
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.conversationCount}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              AI drafts
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.aiDraftCount}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              human review
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.humanReviewCount}
            </p>
          </section>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <TenantSelectForm
              action="/mission-control"
              tenants={data.tenants}
              selectedTenantId={data.selectedTenant?.id}
              buttonLabel="Load conversations"
              emptyStateText="No tenants found in Postgres"
            />
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                Internal notes
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-400">
                <li>Use this route to review conversation state and AI drafts.</li>
                <li>Outbound sending is intentionally withheld for Shift 10.</li>
                <li>
                  Open the sandbox to exercise the orchestration path without a
                  live GHL send.
                </li>
              </ul>
            </section>
          </div>
          <ConversationList
            conversations={data.conversations}
            emptyMessage={
              data.selectedTenant == null
                ? "No tenant is available yet. The sandbox route can create an internal test tenant if you need a controlled demo path."
                : "No conversations have been recorded for this tenant yet."
            }
          />
        </div>
      </MissionControlShell>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown backend failure.";

    return (
      <MissionControlShell
        title="Mission Control v0"
        description="Internal review surface for QA and demos. This route reads real conversation, draft, and audit data without exposing any outbound send controls."
      >
        <JsonPanel
          title="Backend diagnostics"
          description="Mission Control reached the configured backend, but the current environment could not load tenant data."
          value={{
            error: message,
            hint: "Check Supabase schema availability for venue_tenants and related Shift 6/7 tables.",
          }}
        />
      </MissionControlShell>
    );
  }
}
