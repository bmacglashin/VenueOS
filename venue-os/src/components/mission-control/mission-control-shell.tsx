import type { ReactNode } from "react";
import Link from "next/link";

import type { ResolvedOutboundMode } from "@/src/services/outbound-control";

interface MissionControlShellProps {
  title: string;
  description: string;
  selectedTenantName?: string | null;
  resolvedOutboundMode?: ResolvedOutboundMode | null;
  children: ReactNode;
}

function formatOutboundModeLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function getOutboundModeClasses(mode: string): string {
  switch (mode) {
    case "disabled":
      return "border-rose-500/60 bg-rose-500/10 text-rose-100";
    case "review_only":
      return "border-amber-500/60 bg-amber-500/10 text-amber-100";
    case "enabled":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-100";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-100";
  }
}

export function MissionControlShell({
  title,
  description,
  selectedTenantName,
  resolvedOutboundMode,
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
              <Link
                href="/mission-control/website-inquiries"
                className="rounded-md border border-zinc-800 px-3 py-2 text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                Website inquiries
              </Link>
            </nav>
            <p className="text-xs text-zinc-500">
              {selectedTenantName != null
                ? `Tenant: ${selectedTenantName}`
                : "Tenant: none selected"}
              {resolvedOutboundMode != null
                ? ` | Outbound mode: ${formatOutboundModeLabel(resolvedOutboundMode.mode)}`
                : ""}
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        {resolvedOutboundMode != null ? (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Outbound mode
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${getOutboundModeClasses(
                      resolvedOutboundMode.mode
                    )}`}
                  >
                    {formatOutboundModeLabel(resolvedOutboundMode.mode)}
                  </span>
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
                    {resolvedOutboundMode.source === "tenant_override"
                      ? "tenant override"
                      : "global setting"}
                  </span>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-zinc-400">
                {resolvedOutboundMode.detail}
              </p>
            </div>
          </section>
        ) : null}
        {children}
      </main>
    </div>
  );
}
