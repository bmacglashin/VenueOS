import type { Database, Json } from "@/src/lib/db/supabase";

type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];

interface AuditLogPanelProps {
  logs: readonly AuditLog[];
}

interface TimelineEntry {
  label: string;
  summary: string | null;
  policyDecision: string | null;
  policyReasons: string[];
  note: string | null;
  operatorDetail: string | null;
  sendResult: string | null;
  versionDetail: string | null;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const GROUP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function isJsonObject(
  value: Json | null | undefined
): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(
  value: Json | null | undefined
): { [key: string]: Json | undefined } | null {
  return isJsonObject(value) ? value : null;
}

function readArray(value: Json | null | undefined): Json[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: Json | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(timestamp);
}

function formatGroupLabel(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return GROUP_FORMATTER.format(timestamp);
}

function formatLabel(value: string | null): string {
  if (value == null) {
    return "Not recorded";
  }

  return value.replaceAll("_", " ");
}

function getStatusClasses(status: string): string {
  switch (status) {
    case "failed":
    case "blocked":
      return "border-rose-500/60 text-rose-200";
    case "review_required":
      return "border-amber-500/60 text-amber-200";
    case "succeeded":
      return "border-emerald-500/50 text-emerald-200";
    default:
      return "border-zinc-700 text-zinc-300";
  }
}

function getPolicyReasons(payload: Json): string[] {
  const payloadObject = readJsonObject(payload);
  const responsePolicy = readJsonObject(payloadObject?.responsePolicy);
  const reasons = readArray(responsePolicy?.reasons) ?? [];

  return reasons.flatMap((reason) => {
    const reasonObject = readJsonObject(reason);
    const code = readString(reasonObject?.code);
    const detail = readString(reasonObject?.detail);

    if (code == null && detail == null) {
      return [];
    }

    if (detail != null) {
      return [`${formatLabel(code)}: ${detail}`];
    }

    return [formatLabel(code)];
  });
}

function getDraftVersionLabel(value: Json | null | undefined): string | null {
  const versionObject = readJsonObject(value);
  const version = readNumber(versionObject?.version);

  return version == null ? null : `v${version}`;
}

function getSendResult(payload: Json): string | null {
  const payloadObject = readJsonObject(payload);
  const outboundDelivery = readJsonObject(payloadObject?.outboundDelivery);
  const transport = readJsonObject(outboundDelivery?.transport);

  if (transport == null) {
    const action = readString(outboundDelivery?.action);
    return action == null ? null : `Action recorded as ${formatLabel(action)}.`;
  }

  const outcome = readString(transport?.outcome);
  const provider = readString(transport?.provider);
  const detail = readString(transport?.detail);

  return [formatLabel(outcome), provider, detail].filter(Boolean).join(" | ");
}

function buildTimelineEntry(log: AuditLog): TimelineEntry {
  const payload = readJsonObject(log.payload) ?? {};
  const responsePolicy = readJsonObject(payload.responsePolicy);
  const operator = readJsonObject(payload.operator);
  const note = readString(payload.note);
  const previousVersion = getDraftVersionLabel(payload.previousDraftVersion);
  const nextVersion =
    getDraftVersionLabel(payload.nextDraftVersion) ??
    getDraftVersionLabel(payload.draftVersion);
  const policyDecision = readString(responsePolicy?.decision);
  const policyReasons = getPolicyReasons(log.payload);
  const sendResult = getSendResult(log.payload);
  const operatorLabel = readString(operator?.label);

  switch (log.event_type) {
    case "conversation_turn.persisted": {
      const outboundDelivery = readJsonObject(payload.outboundDelivery);
      const action = readString(outboundDelivery?.action);
      const route = readJsonObject(payload.route);
      const routeCategory = readString(route?.category);

      return {
        label:
          action === "queue"
            ? "AI draft queued for review"
            : action === "block"
              ? "Draft blocked"
              : "AI draft generated",
        summary:
          routeCategory == null
            ? null
            : `Route classified as ${formatLabel(routeCategory)}.`,
        policyDecision,
        policyReasons,
        note: null,
        operatorDetail: null,
        sendResult,
        versionDetail: nextVersion == null ? null : `Created ${nextVersion}.`,
      };
    }
    case "conversation_turn.failed":
      return {
        label: "Conversation turn failed",
        summary: readString(payload.error),
        policyDecision: null,
        policyReasons: [],
        note: null,
        operatorDetail: null,
        sendResult: null,
        versionDetail: null,
      };
    case "operator_action.note_added":
      return {
        label: "Manual note added",
        summary: null,
        policyDecision: null,
        policyReasons: [],
        note,
        operatorDetail: operatorLabel,
        sendResult: null,
        versionDetail:
          nextVersion == null ? null : `Attached to ${nextVersion}.`,
      };
    case "operator_action.approve_and_send":
      return {
        label: "Approved and sent",
        summary: "Operator moved the stored draft onto the shared transport path.",
        policyDecision,
        policyReasons,
        note: null,
        operatorDetail: operatorLabel,
        sendResult,
        versionDetail:
          nextVersion == null ? null : `Sent ${nextVersion}.`,
      };
    case "operator_action.edit_and_send": {
      const fromExcerpt = readString(payload.editedFromExcerpt);
      const toExcerpt = readString(payload.editedToExcerpt);

      return {
        label: "Edited and sent",
        summary:
          fromExcerpt == null || toExcerpt == null
            ? "Operator created a revised draft version and sent it."
            : `Updated from "${fromExcerpt}" to "${toExcerpt}".`,
        policyDecision,
        policyReasons,
        note: null,
        operatorDetail: operatorLabel,
        sendResult,
        versionDetail:
          previousVersion == null && nextVersion == null
            ? null
            : `${previousVersion ?? "Earlier version"} -> ${nextVersion ?? "new version"}`,
      };
    }
    case "operator_action.regenerate_draft":
      return {
        label: "Regenerated draft candidate",
        summary:
          "Operator requested a fresh backend-generated draft candidate for review.",
        policyDecision,
        policyReasons,
        note: null,
        operatorDetail: operatorLabel,
        sendResult,
        versionDetail:
          previousVersion == null && nextVersion == null
            ? null
            : `${previousVersion ?? "Earlier version"} -> ${nextVersion ?? "new version"}`,
      };
    default:
      return {
        label: formatLabel(log.event_type),
        summary: null,
        policyDecision,
        policyReasons,
        note,
        operatorDetail: operatorLabel,
        sendResult,
        versionDetail:
          previousVersion == null && nextVersion == null
            ? null
            : `${previousVersion ?? "Earlier version"} -> ${nextVersion ?? "new version"}`,
      };
  }
}

function groupLogsByDay(logs: readonly AuditLog[]) {
  const ordered = [...logs].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  const groups = new Map<string, AuditLog[]>();

  ordered.forEach((log) => {
    const key = new Date(log.created_at).toISOString().slice(0, 10);
    const existing = groups.get(key);

    if (existing == null) {
      groups.set(key, [log]);
      return;
    }

    existing.push(log);
  });

  return [...groups.entries()].map(([key, entries]) => ({
    key,
    label: formatGroupLabel(entries[0]?.created_at ?? key),
    entries,
  }));
}

export function AuditLogPanel({ logs }: AuditLogPanelProps) {
  const groupedLogs = groupLogsByDay(logs);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Audit timeline</h2>
        <p className="text-sm text-zinc-400">
          Readable chronology of routing, policy, operator intervention, and send
          outcomes for this conversation.
        </p>
      </div>
      {logs.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          No matching audit events were found yet.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {groupedLogs.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-800" />
                <h3 className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
                  {group.label}
                </h3>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>
              <ol className="relative space-y-4 border-l border-zinc-800 pl-5">
                {group.entries.map((log) => {
                  const entry = buildTimelineEntry(log);

                  return (
                    <li key={log.id} className="relative">
                      <span className="absolute -left-[29px] top-4 h-3 w-3 rounded-full border border-zinc-700 bg-zinc-950" />
                      <article className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-semibold text-zinc-100">
                                {entry.label}
                              </h4>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] ${getStatusClasses(
                                  log.status
                                )}`}
                              >
                                {formatLabel(log.status)}
                              </span>
                            </div>
                            {entry.summary != null ? (
                              <p className="text-sm leading-6 text-zinc-400">
                                {entry.summary}
                              </p>
                            ) : null}
                          </div>
                          <span className="font-mono text-xs text-zinc-500">
                            {formatTimestamp(log.created_at)}
                          </span>
                        </div>
                        {entry.versionDetail != null ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">
                            Version history: {entry.versionDetail}
                          </p>
                        ) : null}
                        {entry.operatorDetail != null ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">
                            Operator: {entry.operatorDetail}
                          </p>
                        ) : null}
                        {entry.note != null ? (
                          <div className="mt-3 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">
                              Manual note
                            </p>
                            <p className="mt-2 text-sm leading-6 text-sky-50">
                              {entry.note}
                            </p>
                          </div>
                        ) : null}
                        {entry.policyDecision != null || entry.policyReasons.length > 0 ? (
                          <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                                Policy decision
                              </p>
                              <p className="mt-2 text-sm font-medium text-zinc-100">
                                {formatLabel(entry.policyDecision)}
                              </p>
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                                Policy reasons
                              </p>
                              {entry.policyReasons.length === 0 ? (
                                <p className="mt-2 text-sm text-zinc-400">
                                  No policy reasons were recorded.
                                </p>
                              ) : (
                                <ul className="mt-2 space-y-2 text-sm leading-6 text-zinc-300">
                                  {entry.policyReasons.map((reason) => (
                                    <li key={`${log.id}-${reason}`}>{reason}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        ) : null}
                        {entry.sendResult != null ? (
                          <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200">
                              Send result
                            </p>
                            <p className="mt-2 text-sm leading-6 text-emerald-50">
                              {entry.sendResult}
                            </p>
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
