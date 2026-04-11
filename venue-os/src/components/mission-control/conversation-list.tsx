import Link from "next/link";

import type { MissionControlConversationSummary } from "@/src/services/mission-control";

interface ConversationListProps {
  conversations: readonly MissionControlConversationSummary[];
  selectedConversationId?: string | null;
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

function formatRouteLabel(value: string | null): string {
  if (value == null) {
    return "Draft pending";
  }

  return value.replaceAll("_", " ");
}

function formatPolicyDecisionLabel(value: string | null): string {
  if (value == null) {
    return "Policy pending";
  }

  return value.replaceAll("_", " ");
}

function formatOutboundActionLabel(value: string | null): string {
  if (value == null) {
    return "Action pending";
  }

  switch (value) {
    case "proceed":
      return "Proceed";
    case "queue":
      return "Queue";
    case "block":
      return "Block";
    default:
      return value;
  }
}

function formatPolicyReasonCodes(value: readonly string[]): string {
  return value.map((reason) => reason.replaceAll("_", " ")).join(", ");
}

function shortConversationId(value: string): string {
  return value.slice(0, 8);
}

export function ConversationList({
  conversations,
  selectedConversationId,
  emptyMessage,
}: ConversationListProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">
          Conversation list
        </h2>
        <p className="text-sm text-zinc-400">
          Thin operator view over the real conversation records and drafts.
        </p>
      </div>
      {conversations.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {conversations.map((conversation) => {
            const isSelected =
              conversation.conversation.id === selectedConversationId;

            return (
              <li key={conversation.conversation.id}>
                <Link
                  href={`/mission-control/conversations/${conversation.conversation.id}?tenantId=${conversation.conversation.tenant_id}`}
                  className={`block rounded-lg border px-3 py-3 transition ${
                    isSelected
                      ? "border-amber-400 bg-amber-400/10"
                      : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 hover:bg-zinc-950"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-zinc-100">
                        {shortConversationId(conversation.conversation.id)}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] text-zinc-300">
                        {conversation.conversation.status}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] text-zinc-300">
                        {formatRouteLabel(conversation.routeCategory)}
                      </span>
                      {conversation.outboundAction != null ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] ${
                            conversation.outboundAction === "block"
                              ? "border-rose-500/60 text-rose-200"
                              : conversation.outboundAction === "queue"
                                ? "border-amber-500/60 text-amber-200"
                                : "border-sky-500/50 text-sky-200"
                          }`}
                        >
                          {formatOutboundActionLabel(conversation.outboundAction)}
                        </span>
                      ) : null}
                      {conversation.policyDecision != null ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] ${
                            conversation.policyDecision === "block_send"
                              ? "border-rose-500/60 text-rose-200"
                              : conversation.policyDecision === "needs_review"
                                ? "border-amber-500/60 text-amber-200"
                                : "border-emerald-500/40 text-emerald-200"
                          }`}
                        >
                          {formatPolicyDecisionLabel(conversation.policyDecision)}
                        </span>
                      ) : conversation.requiresHumanReview ? (
                        <span className="rounded-full border border-amber-500/60 px-2 py-0.5 text-[11px] uppercase tracking-[0.22em] text-amber-200">
                          Human review
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono text-xs text-zinc-500">
                      {formatTimestamp(conversation.lastActivityAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {conversation.lastPreview ??
                      "No messages recorded for this conversation yet."}
                  </p>
                  {conversation.policyReasonCodes.length > 0 ? (
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Policy reasons:{" "}
                      {formatPolicyReasonCodes(conversation.policyReasonCodes)}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
