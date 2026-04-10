import type { Database } from "@/src/lib/db/supabase";

type Message = Database["public"]["Tables"]["messages"]["Row"];

interface MessageTranscriptProps {
  messages: readonly Message[];
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

function getMessageLabel(message: Message): string {
  if (message.direction === "outbound" && message.status === "draft") {
    return "AI draft";
  }

  if (message.direction === "outbound") {
    return "Outbound";
  }

  return "Inbound";
}

export function MessageTranscript({ messages }: MessageTranscriptProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Transcript</h2>
        <p className="text-sm text-zinc-400">
          Stored conversation messages in arrival order.
        </p>
      </div>
      {messages.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950/70 px-3 py-4 text-sm text-zinc-400">
          No messages have been recorded yet.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`rounded-lg border p-4 ${
                message.direction === "inbound"
                  ? "border-sky-500/30 bg-sky-500/10"
                  : "border-zinc-700 bg-zinc-950/80"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-current/30 px-2 py-0.5 uppercase tracking-[0.24em]">
                    {getMessageLabel(message)}
                  </span>
                  <span className="font-mono">{message.role}</span>
                  <span className="font-mono">{message.source}</span>
                  <span className="font-mono">{message.status}</span>
                </div>
                <span className="font-mono">{formatTimestamp(message.created_at)}</span>
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-100">
                {message.content}
              </pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
