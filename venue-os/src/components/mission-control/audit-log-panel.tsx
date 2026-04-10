import type { Database } from "@/src/lib/db/supabase";

type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

interface AuditLogPanelProps {
  logs: readonly AuditLog[];
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

function formatPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AuditLogPanel({ logs }: AuditLogPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Log panel</h2>
        <p className="text-sm text-zinc-400">
          Recent tenant-scoped audit entries touching this conversation.
        </p>
      </div>
      {logs.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          No matching audit logs were found yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {logs.map((log, index) => (
            <details
              key={log.id}
              open={index === 0}
              className="rounded-md border border-zinc-800 bg-zinc-950/80"
            >
              <summary className="cursor-pointer list-none px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-zinc-300">
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                      {log.event_type}
                    </span>
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                      {log.status}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-zinc-500">
                    {formatTimestamp(log.created_at)}
                  </span>
                </div>
              </summary>
              <pre className="border-t border-zinc-800 px-3 py-3 text-xs leading-6 text-zinc-200">
                {formatPayload(log.payload)}
              </pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
