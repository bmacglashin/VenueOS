import type { Database } from "@/src/lib/db/supabase";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];

interface TenantSelectFormProps {
  action: string;
  tenants: readonly Tenant[];
  selectedTenantId?: string | null;
  buttonLabel: string;
  emptyStateText: string;
}

export function TenantSelectForm({
  action,
  tenants,
  selectedTenantId,
  buttonLabel,
  emptyStateText,
}: TenantSelectFormProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Tenant scope</h2>
        <p className="text-sm text-zinc-400">
          Mission Control reads real tenant data from Postgres.
        </p>
      </div>
      <form action={action} method="get" className="mt-4 space-y-3">
        <select
          name="tenantId"
          defaultValue={selectedTenantId ?? tenants[0]?.id ?? ""}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
          disabled={tenants.length === 0}
        >
          {tenants.length === 0 ? (
            <option value="">{emptyStateText}</option>
          ) : (
            tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))
          )}
        </select>
        <button
          type="submit"
          disabled={tenants.length === 0}
          className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {buttonLabel}
        </button>
      </form>
    </section>
  );
}
