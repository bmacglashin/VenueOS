import type { ReactNode } from "react";
import Link from "next/link";

interface MissionControlShellProps {
  title: string;
  description: string;
  selectedTenantName?: string | null;
  children: ReactNode;
}

export function MissionControlShell({
  title,
  description,
  selectedTenantName,
  children,
}: MissionControlShellProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-amber-300">
              Venue OS internal tool
            </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="max-w-3xl text-sm text-zinc-400">{description}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <nav className="flex flex-wrap gap-2 text-sm">
              <Link
                href="/mission-control"
                className="rounded-md border border-zinc-800 px-3 py-2 text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                Queue
              </Link>
              <Link
                href="/mission-control/sandbox"
                className="rounded-md border border-zinc-800 px-3 py-2 text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                Sandbox
              </Link>
            </nav>
            <p className="text-xs text-zinc-500">
              {selectedTenantName != null
                ? `Tenant: ${selectedTenantName}`
                : "Tenant: none selected"}{" "}
              · Outbound sending is intentionally disabled.
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        {children}
      </main>
    </div>
  );
}
