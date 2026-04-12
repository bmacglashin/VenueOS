interface WebsiteInquirySummaryPanelProps {
  status: string;
  shortSummary: string | null;
  keyFacts: readonly string[];
  confidence: number | null;
  generatedAt: string | null;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(timestamp);
}

function formatSummaryStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function formatConfidence(value: number | null): string {
  if (value == null) {
    return "Not scored";
  }

  return `${Math.round(value * 100)}%`;
}

function getSummaryStatusClasses(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-100";
    case "failed":
      return "border-rose-500/60 bg-rose-500/10 text-rose-100";
    case "pending":
      return "border-amber-500/60 bg-amber-500/10 text-amber-100";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-100";
  }
}

export function WebsiteInquirySummaryPanel({
  status,
  shortSummary,
  keyFacts,
  confidence,
  generatedAt,
}: WebsiteInquirySummaryPanelProps) {
  const formattedGeneratedAt = formatTimestamp(generatedAt);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">AI summary</h2>
        <p className="text-sm text-zinc-400">
          Stored separately from raw intake data so operators can compare both
          views.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${getSummaryStatusClasses(
            status
          )}`}
        >
          {formatSummaryStatus(status)}
        </span>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
          Confidence {formatConfidence(confidence)}
        </span>
        {formattedGeneratedAt != null ? (
          <span className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
            Generated {formattedGeneratedAt}
          </span>
        ) : null}
      </div>
      <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Short summary
        </p>
        <p className="mt-2 text-sm leading-6 text-zinc-200">
          {shortSummary ?? "No AI summary text is stored yet."}
        </p>
      </div>
      <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
          Extracted key facts
        </p>
        {keyFacts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">
            No extracted key facts are stored yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm leading-6 text-zinc-200">
            {keyFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
