import Link from "next/link";

import type { ReviewQueueItem } from "@/src/services/review-queue-core";

interface ReviewQueueTableProps {
  items: readonly ReviewQueueItem[];
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

function formatLabel(value: string | null): string {
  if (value == null) {
    return "Not recorded";
  }

  return value.replaceAll("_", " ");
}

function formatConfidence(value: number | null): string {
  if (value == null) {
    return "Unknown";
  }

  return value.toFixed(2);
}

function getConfidenceClasses(value: string): string {
  switch (value) {
    case "low":
      return "border-rose-500/60 text-rose-200";
    case "medium":
      return "border-amber-500/60 text-amber-200";
    case "high":
      return "border-emerald-500/50 text-emerald-200";
    default:
      return "border-zinc-700 text-zinc-300";
  }
}

function getPolicyDecisionClasses(value: string | null): string {
  if (value === "block_send") {
    return "border-rose-500/60 text-rose-200";
  }

  if (value === "needs_review") {
    return "border-amber-500/60 text-amber-200";
  }

  if (value === "safe_to_send") {
    return "border-emerald-500/40 text-emerald-200";
  }

  return "border-zinc-700 text-zinc-300";
}

export function ReviewQueueTable({
  items,
  emptyMessage,
}: ReviewQueueTableProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">
          Needs-review queue
        </h2>
        <p className="text-sm text-zinc-400">
          Stored AI draft candidates waiting on operator review.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          {emptyMessage}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Item
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Tenant
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Status
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Inbound excerpt
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Classification
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Policy
                </th>
                <th className="border-b border-zinc-800 px-3 py-3 font-semibold">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="border-b border-zinc-900 px-3 py-3">
                    <div className="space-y-2">
                      <p className="font-mono text-xs text-zinc-100">
                        {item.id}
                      </p>
                      <Link
                        href={`/mission-control/conversations/${item.conversationId}`}
                        className="text-xs font-medium text-amber-300 transition hover:text-amber-200"
                      >
                        Open conversation
                      </Link>
                    </div>
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">
                    <p className="text-zinc-100">{item.tenantName}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      {item.tenantId.slice(0, 8)}
                    </p>
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">
                    <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] uppercase tracking-[0.22em] text-zinc-300">
                      {formatLabel(item.status)}
                    </span>
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3 text-zinc-300">
                    {item.inboundExcerpt ?? "No inbound excerpt recorded."}
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">
                    <div className="space-y-2">
                      <p className="text-zinc-100">{formatLabel(item.route)}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-300">
                          Confidence {formatConfidence(item.confidence)}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-1 uppercase tracking-[0.2em] ${getConfidenceClasses(
                            item.confidenceBand
                          )}`}
                        >
                          {item.confidenceBand}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.22em] ${getPolicyDecisionClasses(
                          item.policyDecision
                        )}`}
                      >
                        {formatLabel(item.policyDecision)}
                      </span>
                      {item.policyReasons.length > 0 ? (
                        <ul className="space-y-2 text-xs leading-5 text-zinc-400">
                          {item.policyReasons.map((reason) => (
                            <li key={`${item.id}-${reason.code}`}>
                              <span className="font-medium text-zinc-300">
                                {formatLabel(reason.code)}:
                              </span>{" "}
                              {reason.detail}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          No policy reasons recorded.
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3 font-mono text-xs text-zinc-500">
                    {formatTimestamp(item.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
