import Link from "next/link";

import type { MissionControlWebsiteInquiryListItem } from "@/src/services/mission-control-website-inquiries";

interface WebsiteInquiryListProps {
  inquiries: readonly MissionControlWebsiteInquiryListItem[];
  selectedInquiryId?: string | null;
  selectedTenantId?: string | null;
  emptyMessage: string;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(timestamp);
}

function summarizePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

function formatSummaryStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function getSummaryStatusClasses(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/50 text-emerald-200";
    case "failed":
      return "border-rose-500/60 text-rose-200";
    case "pending":
      return "border-amber-500/60 text-amber-200";
    default:
      return "border-zinc-700 text-zinc-300";
  }
}

export function WebsiteInquiryList({
  inquiries,
  selectedInquiryId,
  selectedTenantId,
  emptyMessage,
}: WebsiteInquiryListProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">
          Website inquiries
        </h2>
        <p className="text-sm text-zinc-400">
          Persisted intake submissions with operator-facing summary state.
        </p>
      </div>
      {inquiries.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {inquiries.map((item) => {
            const isSelected = item.inquiry.id === selectedInquiryId;
            const searchParams = new URLSearchParams();

            if (selectedTenantId != null) {
              searchParams.set("tenantId", selectedTenantId);
            }

            searchParams.set("inquiryId", item.inquiry.id);

            return (
              <li key={item.inquiry.id}>
                <Link
                  href={`/mission-control/website-inquiries?${searchParams.toString()}`}
                  className={`block rounded-lg border px-3 py-3 transition ${
                    isSelected
                      ? "border-amber-400 bg-amber-400/10"
                      : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 hover:bg-zinc-950"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-100">
                        {item.inquiry.contact_name}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] text-zinc-300">
                        {item.tenant.name}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] ${getSummaryStatusClasses(
                          item.inquiry.summary_status
                        )}`}
                      >
                        {formatSummaryStatus(item.inquiry.summary_status)}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-zinc-500">
                      {formatTimestamp(item.inquiry.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {item.inquiry.summary_short ??
                      summarizePreview(item.inquiry.message)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
