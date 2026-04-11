import type { Database, Json } from "@/src/lib/db/supabase";
import {
  addOperatorNoteAction,
  approveDraftAndSendAction,
  editDraftAndSendAction,
  regenerateDraftAction,
} from "@/src/app/mission-control/conversations/[id]/actions";
import {
  getDraftVersionSnapshot,
  OPERATOR_EDIT_SOURCE,
} from "@/src/services/draft-history";

type Message = Database["public"]["Tables"]["messages"]["Row"];

interface DraftReviewPanelProps {
  conversationId: string;
  latestAiDraftMessage: Message | null;
  draftVersions: readonly Message[];
  draftRouteCategory: string | null;
  draftPolicyDecision: string | null;
  draftOutboundAction: string | null;
  draftPolicyReasonCodes: readonly string[];
  draftRequiresHumanReview: boolean;
  showOperatorActions?: boolean;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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

function readString(value: Json | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return TIMESTAMP_FORMATTER.format(timestamp);
}

function formatRouteLabel(value: string | null): string {
  if (value == null) {
    return "No routing metadata";
  }

  return value.replaceAll("_", " ");
}

function formatPolicyDecisionLabel(value: string | null): string {
  if (value == null) {
    return "Policy pending";
  }

  return value.replaceAll("_", " ");
}

function formatPolicyReasonCodes(value: readonly string[]): string {
  return value.map((reason) => reason.replaceAll("_", " ")).join(", ");
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
      return value.replaceAll("_", " ");
  }
}

function formatStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDraftVersionLabel(message: Message): string {
  const snapshot = getDraftVersionSnapshot(message);

  if (snapshot != null) {
    return `v${snapshot.version}`;
  }

  return "Legacy";
}

function formatDraftKindLabel(message: Message): string {
  const snapshot = getDraftVersionSnapshot(message);

  switch (snapshot?.kind) {
    case "regenerated_ai_draft":
      return "Regenerated";
    case "operator_edit":
      return "Operator edit";
    case "ai_draft":
      return "AI draft";
    default:
      return message.source === OPERATOR_EDIT_SOURCE ? "Operator edit" : "AI draft";
  }
}

function summarizeContent(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157)}...`;
}

function readEditedFromMessageId(message: Message): string | null {
  const metadata = readJsonObject(message.metadata);
  const operatorReview = readJsonObject(metadata?.operatorReview);
  return readString(operatorReview?.editedFromMessageId);
}

export function DraftReviewPanel({
  conversationId,
  latestAiDraftMessage,
  draftVersions,
  draftRouteCategory,
  draftPolicyDecision,
  draftOutboundAction,
  draftPolicyReasonCodes,
  draftRequiresHumanReview,
  showOperatorActions = true,
}: DraftReviewPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Draft review</h2>
        <p className="text-sm text-zinc-400">
          Operator actions write through shared services so notes, versions, audit
          history, and transport results stay attached to the real conversation.
        </p>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
          <span className="rounded-full border border-zinc-700 px-2 py-1">
            {latestAiDraftMessage?.status ?? "no_draft"}
          </span>
          <span className="rounded-full border border-zinc-700 px-2 py-1">
            {formatRouteLabel(draftRouteCategory)}
          </span>
          <span className="rounded-full border border-zinc-700 px-2 py-1">
            {latestAiDraftMessage == null
              ? "No version"
              : formatDraftVersionLabel(latestAiDraftMessage)}
          </span>
          <span
            className={`rounded-full border px-2 py-1 ${
              draftPolicyDecision === "block_send"
                ? "border-rose-500/60 text-rose-200"
                : draftPolicyDecision === "needs_review" || draftRequiresHumanReview
                  ? "border-amber-500/60 text-amber-200"
                  : "border-emerald-500/40 text-emerald-200"
            }`}
          >
            {formatPolicyDecisionLabel(draftPolicyDecision)}
          </span>
          <span
            className={`rounded-full border px-2 py-1 ${
              draftOutboundAction === "block"
                ? "border-rose-500/60 text-rose-200"
                : draftOutboundAction === "queue"
                  ? "border-amber-500/60 text-amber-200"
                  : "border-sky-500/50 text-sky-200"
            }`}
          >
            {formatOutboundActionLabel(draftOutboundAction)}
          </span>
        </div>
        {draftPolicyReasonCodes.length > 0 ? (
          <p className="text-xs leading-6 text-zinc-400">
            Reasons: {formatPolicyReasonCodes(draftPolicyReasonCodes)}
          </p>
        ) : null}
        <pre className="min-h-32 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-6 text-zinc-100">
          {latestAiDraftMessage?.content ??
            "No draft is stored for this conversation yet."}
        </pre>
      </div>
      {showOperatorActions && latestAiDraftMessage != null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <form action={approveDraftAndSendAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input
              type="hidden"
              name="draftMessageId"
              value={latestAiDraftMessage.id}
            />
            <button
              type="submit"
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white"
            >
              Approve and send
            </button>
          </form>
          <form action={regenerateDraftAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input
              type="hidden"
              name="draftMessageId"
              value={latestAiDraftMessage.id}
            />
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-950"
            >
              Regenerate draft
            </button>
          </form>
        </div>
      ) : null}
      {showOperatorActions ? (
        <>
          <div className="mt-4 space-y-2">
            <label
              htmlFor="operator-edit"
              className="text-sm font-semibold text-zinc-100"
            >
              Edit draft then send
            </label>
            <form action={editDraftAndSendAction} className="space-y-3">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input
                type="hidden"
                name="draftMessageId"
                value={latestAiDraftMessage?.id ?? ""}
              />
              <textarea
                id="operator-edit"
                name="content"
                defaultValue={latestAiDraftMessage?.content ?? ""}
                placeholder="Revise the draft before sending."
                className="min-h-40 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-500"
              />
              <button
                type="submit"
                className="w-full rounded-md border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-300 hover:bg-amber-400/15"
              >
                Edit then send
              </button>
            </form>
          </div>
          <div className="mt-4 space-y-2">
            <label
              htmlFor="manual-note"
              className="text-sm font-semibold text-zinc-100"
            >
              Manual note
            </label>
            <form action={addOperatorNoteAction} className="space-y-3">
              <input type="hidden" name="conversationId" value={conversationId} />
              <textarea
                id="manual-note"
                name="note"
                placeholder="Example: Waiting on sales to confirm approved pricing before sending."
                className="min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-500"
              />
              <button
                type="submit"
                className="w-full rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-950"
              >
                Save note
              </button>
            </form>
          </div>
        </>
      ) : null}
      <div className="mt-6 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-100">Version history</h3>
          <p className="text-xs leading-5 text-zinc-500">
            New edits and regenerations create fresh versions so the original draft
            remains visible in history.
          </p>
        </div>
        {draftVersions.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-3 text-sm text-zinc-400">
            No draft versions are stored for this conversation yet.
          </p>
        ) : (
          <div className="space-y-3">
            {[...draftVersions]
              .sort((left, right) => right.created_at.localeCompare(left.created_at))
              .map((message) => (
                <article
                  key={message.id}
                  className="rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 uppercase tracking-[0.22em] text-zinc-200">
                        {formatDraftVersionLabel(message)}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 uppercase tracking-[0.22em] text-zinc-300">
                        {formatDraftKindLabel(message)}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 uppercase tracking-[0.22em] text-zinc-300">
                        {formatStatusLabel(message.status)}
                      </span>
                    </div>
                    <span className="font-mono text-zinc-500">
                      {formatTimestamp(message.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {summarizeContent(message.content)}
                  </p>
                  {readEditedFromMessageId(message) != null ? (
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Edited from message{" "}
                      <span className="font-mono text-zinc-400">
                        {readEditedFromMessageId(message)?.slice(0, 8)}
                      </span>
                      .
                    </p>
                  ) : null}
                </article>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
