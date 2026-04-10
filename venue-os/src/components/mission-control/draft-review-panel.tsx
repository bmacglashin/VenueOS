import type { Database } from "@/src/lib/db/supabase";

type Message = Database["public"]["Tables"]["messages"]["Row"];

interface DraftReviewPanelProps {
  latestAiDraftMessage: Message | null;
  draftRouteCategory: string | null;
  draftPolicyDecision: string | null;
  draftPolicyReasonCodes: readonly string[];
  draftRequiresHumanReview: boolean;
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

export function DraftReviewPanel({
  latestAiDraftMessage,
  draftRouteCategory,
  draftPolicyDecision,
  draftPolicyReasonCodes,
  draftRequiresHumanReview,
}: DraftReviewPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">AI draft panel</h2>
        <p className="text-sm text-zinc-400">
          Review-only surface. Editing the override text does not persist or
          send yet.
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
        </div>
        {draftPolicyReasonCodes.length > 0 ? (
          <p className="text-xs leading-6 text-zinc-400">
            Reasons: {formatPolicyReasonCodes(draftPolicyReasonCodes)}
          </p>
        ) : null}
        <pre className="min-h-32 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-6 text-zinc-100">
          {latestAiDraftMessage?.content ??
            "No AI draft is stored for this conversation yet."}
        </pre>
      </div>
      <div className="mt-4 space-y-2">
        <label
          htmlFor="manual-override"
          className="text-sm font-semibold text-zinc-100"
        >
          Manual override textarea
        </label>
        <textarea
          id="manual-override"
          defaultValue={latestAiDraftMessage?.content ?? ""}
          placeholder="Type an operator override here. This field is intentionally local-only for Shift 10."
          className="min-h-40 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-500"
        />
        <p className="text-xs text-zinc-500">
          Internal only. This textarea is for QA and demos; outbound send wiring
          is intentionally deferred.
        </p>
      </div>
    </section>
  );
}
