import Link from "next/link";

import type { Database } from "@/src/lib/db/supabase";
import { submitMissionControlSandboxMessage } from "@/src/app/mission-control/sandbox/actions";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];

interface SandboxFormProps {
  tenants: readonly Tenant[];
  selectedTenant: Tenant | null;
  conversationId?: string | null;
  willCreateTenantOnFirstRun: boolean;
}

export function SandboxForm({
  tenants,
  selectedTenant,
  conversationId,
  willCreateTenantOnFirstRun,
}: SandboxFormProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Sandbox chat tester</h2>
        <p className="text-sm text-zinc-400">
          Runs a test inbound message through the same orchestration service
          used by the internal webhook loop.
        </p>
      </div>
      <form action={submitMissionControlSandboxMessage} className="mt-4 space-y-4">
        {conversationId != null ? (
          <>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input
              type="hidden"
              name="tenantId"
              value={selectedTenant?.id ?? ""}
            />
            <div className="rounded-md border border-zinc-700 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-200">
              Continuing sandbox thread{" "}
              <span className="font-mono text-zinc-100">
                {conversationId.slice(0, 8)}
              </span>{" "}
              for {selectedTenant?.name ?? "the selected tenant"}.
            </div>
            <Link
              href={
                selectedTenant == null
                  ? "/mission-control/sandbox"
                  : `/mission-control/sandbox?tenantId=${selectedTenant.id}`
              }
              className="inline-flex rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-950"
            >
              Start a new sandbox thread
            </Link>
          </>
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="sandbox-tenant"
              className="text-sm font-semibold text-zinc-100"
            >
              Tenant
            </label>
            <select
              id="sandbox-tenant"
              name="tenantId"
              defaultValue={selectedTenant?.id ?? ""}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            >
              {tenants.length === 0 ? (
                <option value="">Auto-create Mission Control Sandbox</option>
              ) : (
                tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))
              )}
            </select>
            {willCreateTenantOnFirstRun ? (
              <p className="text-xs text-zinc-500">
                No tenants are stored yet. The first sandbox submission will
                create an internal-only sandbox tenant automatically.
              </p>
            ) : null}
          </div>
        )}
        <div className="space-y-2">
          <label
            htmlFor="sandbox-message"
            className="text-sm font-semibold text-zinc-100"
          >
            Test message
          </label>
          <textarea
            id="sandbox-message"
            name="message"
            required
            placeholder="Example: We need a private dining room for 18 guests next Friday."
            className="min-h-36 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white"
        >
          Run through orchestration
        </button>
      </form>
      <p className="mt-3 text-xs text-zinc-500">
        The sandbox writes inbound and draft records only. No outbound send path
        is wired from this surface in Shift 10.
      </p>
    </section>
  );
}
