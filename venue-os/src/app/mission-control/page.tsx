import type { Metadata } from "next";

import { JsonPanel } from "@/src/components/mission-control/json-panel";
import { MissionControlShell } from "@/src/components/mission-control/mission-control-shell";
import { ReviewQueueFilters } from "@/src/components/mission-control/review-queue-filters";
import { ReviewQueueTable } from "@/src/components/mission-control/review-queue-table";
import { getMissionControlReviewQueue } from "@/src/services/review-queue";
import type {
  ReviewQueueConfidenceBand,
  ReviewQueueFilters as ReviewQueueFilterInput,
} from "@/src/services/review-queue-core";

export const metadata: Metadata = {
  title: "Mission Control Review Queue",
};

interface MissionControlPageProps {
  searchParams: Promise<{
    tenantId?: string | string[];
    route?: string | string[];
    status?: string | string[];
    confidenceBand?: string | string[];
  }>;
}

function readSearchParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
}

function readConfidenceBand(
  value?: string | string[]
): ReviewQueueConfidenceBand | undefined {
  const normalized = readSearchParam(value);

  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "unknown":
      return normalized;
    default:
      return undefined;
  }
}

function buildFilters(searchParams: Awaited<MissionControlPageProps["searchParams"]>): ReviewQueueFilterInput {
  return {
    tenantId: readSearchParam(searchParams.tenantId),
    route: readSearchParam(searchParams.route),
    status: readSearchParam(searchParams.status),
    confidenceBand: readConfidenceBand(searchParams.confidenceBand),
  };
}

export default async function MissionControlPage({
  searchParams,
}: MissionControlPageProps) {
  const filters = buildFilters(await searchParams);

  try {
    const data = await getMissionControlReviewQueue(filters);

    return (
      <MissionControlShell
        title="Mission Control review queue"
        description="Operator queue for stored AI draft candidates that require human review before any outbound action. Filters stay on the shared backend service layer so the page only renders queue results."
        selectedTenantName={data.selectedTenant?.name}
        resolvedOutboundMode={data.selectedTenant == null ? null : data.resolvedOutboundMode}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              review items
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.items.length}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              {filters.tenantId != null ||
              filters.route != null ||
              filters.status != null ||
              filters.confidenceBand != null
                ? `${data.totalCount} total queued candidates`
                : "Current queue count"}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              tenants represented
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.tenantCount}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Operators can narrow the queue to a single tenant when needed.
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              low confidence
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">
              {data.stats.lowConfidenceCount}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Count of queued items below the safe-send review threshold.
            </p>
          </section>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-6">
            <ReviewQueueFilters
              action="/mission-control"
              tenants={data.tenants}
              routes={data.routes}
              statuses={data.statuses}
              confidenceBands={data.confidenceBands}
              selectedTenantId={filters.tenantId}
              selectedRoute={filters.route}
              selectedStatus={filters.status}
              selectedConfidenceBand={filters.confidenceBand}
            />
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                Operator notes
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-400">
                <li>Every row is a stored AI draft with review status already recorded.</li>
                <li>Classification, confidence, policy decision, and policy reasons are visible inline for fast triage.</li>
                <li>Open the conversation detail view when you need transcript or raw payload context.</li>
              </ul>
            </section>
          </div>
          <ReviewQueueTable
            items={data.items}
            emptyMessage={
              data.totalCount === 0
                ? "No queued review candidates are stored yet."
                : "No queued review candidates match the active filters."
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
        title="Mission Control review queue"
        description="Operator queue for stored AI draft candidates that require human review before outbound action."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              review items
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">0</p>
            <p className="mt-2 text-sm text-zinc-500">
              Queue data is unavailable until the backend schema responds.
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              tenants represented
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">0</p>
            <p className="mt-2 text-sm text-zinc-500">
              Tenant counts resume automatically when the review service loads.
            </p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              low confidence
            </p>
            <p className="mt-2 text-3xl font-semibold text-zinc-100">0</p>
            <p className="mt-2 text-sm text-zinc-500">
              Confidence breakdown is waiting on the stored review queue.
            </p>
          </section>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-6">
            <ReviewQueueFilters
              action="/mission-control"
              tenants={[]}
              routes={[]}
              statuses={[]}
              confidenceBands={[]}
            />
            <JsonPanel
              title="Backend diagnostics"
              description="Mission Control reached the configured backend, but the review queue could not be loaded."
              value={{
                error: message,
                hint: "Check Supabase schema availability for messages, conversations, and venue_tenants.",
              }}
            />
          </div>
          <ReviewQueueTable
            items={[]}
            emptyMessage="No queue rows can be rendered until the backend service returns review candidates."
          />
        </div>
      </MissionControlShell>
    );
  }
}
