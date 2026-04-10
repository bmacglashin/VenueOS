interface JsonPanelProps {
  title: string;
  description: string;
  value: unknown;
}

function formatJsonValue(value: unknown): string {
  if (value == null) {
    return "No data recorded.";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function JsonPanel({ title, description, value }: JsonPanelProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-400">{description}</p>
      </div>
      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950/80 p-3 text-xs leading-6 text-zinc-200">
        {formatJsonValue(value)}
      </pre>
    </section>
  );
}
