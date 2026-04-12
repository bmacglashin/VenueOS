import type { Metadata } from "next";

import { JsonPanel } from "@/src/components/mission-control/json-panel";
import { MissionControlShell } from "@/src/components/mission-control/mission-control-shell";
import { WebsiteInquiryList } from "@/src/components/mission-control/website-inquiry-list";
import { WebsiteInquirySummaryPanel } from "@/src/components/mission-control/website-inquiry-summary-panel";
import { getMissionControlWebsiteInquiryData } from "@/src/services/mission-control-website-inquiries";

export const metadata: Metadata = {
  title: "Mission Control Website Inquiries",
};

interface MissionControlWebsiteInquiriesPageProps {
  searchParams: Promise<{
    tenantId?: string | string[];
    inquiryId?: string | string[];
  }>;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function readSearchParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(timestamp);
}

export default async function MissionControlWebsiteInquiriesPage({
  searchParams,
}: MissionControlWebsiteInquiriesPageProps) {
  const resolvedSearchParams = await searchParams;
  const tenantId = readSearchParam(resolvedSearchParams.tenantId);
  const inquiryId = readSearchParam(resolvedSearchParams.inquiryId);

  try {
    const data = await getMissionControlWebsiteInquiryData({
      tenantId,
      inquiryId,
    });

    return (
      <MissionControlShell
        title="Website inquiries"
        description="Operator view over persisted website submissions with raw payloads and optional AI summaries shown side by side."
        selectedTenantName={
          data.selectedTenant?.name ?? data.selectedInquiry?.tenant.name ?? null
        }
      >
        <div className="grid gap-4 lg:grid-cols-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              inquiries
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.inquiryCount}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              summaries completed
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.completedSummaryCount}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              summaries failed
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.failedSummaryCount}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              summaries pending
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.pendingSummaryCount}
            </p>
          </section>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <WebsiteInquiryList
            inquiries={data.inquiries}
            selectedInquiryId={data.selectedInquiry?.inquiry.id}
            selectedTenantId={data.selectedTenant?.id}
            emptyMessage="No website inquiries are stored for the active scope yet."
          />
          {data.selectedInquiry == null ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                Inquiry detail
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                Select a website inquiry to inspect the raw submission and the
                stored AI summary.
              </p>
            </section>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-4">
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    tenant
                  </p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {data.selectedInquiry.tenant.name}
                  </p>
                </section>
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    created
                  </p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {formatTimestamp(data.selectedInquiry.inquiry.created_at)}
                  </p>
                </section>
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    summary status
                  </p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {data.selectedInquiry.summary.status.replaceAll("_", " ")}
                  </p>
                </section>
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                    source
                  </p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {data.selectedInquiry.inquiry.source}
                  </p>
                </section>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <JsonPanel
                  title="Raw submission"
                  description="Original website inquiry payload captured at persistence time."
                  value={data.selectedInquiry.inquiry.raw_payload}
                />
                <WebsiteInquirySummaryPanel
                  status={data.selectedInquiry.summary.status}
                  shortSummary={data.selectedInquiry.summary.short}
                  keyFacts={data.selectedInquiry.summary.keyFacts}
                  confidence={data.selectedInquiry.summary.confidence}
                  generatedAt={data.selectedInquiry.summary.generatedAt}
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
        title="Website inquiries"
        description="Operator view over persisted website submissions with raw payloads and optional AI summaries shown side by side."
      >
        <JsonPanel
          title="Backend diagnostics"
          description="Mission Control could not load website inquiries from the configured backend."
          value={{
            inquiryId: inquiryId ?? null,
            tenantId: tenantId ?? null,
            error: message,
          }}
        />
      </MissionControlShell>
    );
  }
}
