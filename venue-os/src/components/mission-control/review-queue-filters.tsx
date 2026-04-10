import Link from "next/link";

import type { Database } from "@/src/lib/db/supabase";
import type {
  ReviewQueueConfidenceBandOption,
  ReviewQueueFilterOption,
} from "@/src/services/review-queue";

type Tenant = Database["public"]["Tables"]["venue_tenants"]["Row"];

interface ReviewQueueFiltersProps {
  action: string;
  tenants: readonly Tenant[];
  routes: readonly ReviewQueueFilterOption[];
  statuses: readonly ReviewQueueFilterOption[];
  confidenceBands: readonly ReviewQueueConfidenceBandOption[];
  selectedTenantId?: string;
  selectedRoute?: string;
  selectedStatus?: string;
  selectedConfidenceBand?: string;
}

function optionSuffix(count: number): string {
  return count > 0 ? ` (${count})` : "";
}

export function ReviewQueueFilters({
  action,
  tenants,
  routes,
  statuses,
  confidenceBands,
  selectedTenantId,
  selectedRoute,
  selectedStatus,
  selectedConfidenceBand,
}: ReviewQueueFiltersProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Queue filters</h2>
        <p className="text-sm text-zinc-400">
          Narrow the live review queue by tenant, routing, conversation status,
          and confidence band.
        </p>
      </div>
      <form action={action} method="get" className="mt-4 space-y-3">
        <div className="space-y-2">
          <label
            htmlFor="queue-tenant"
            className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500"
          >
            Tenant
          </label>
          <select
            id="queue-tenant"
            name="tenantId"
            defaultValue={selectedTenantId ?? ""}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
          >
            <option value="">All tenants</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label
            htmlFor="queue-route"
            className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500"
          >
            Route
          </label>
          <select
            id="queue-route"
            name="route"
            defaultValue={selectedRoute ?? ""}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
          >
            <option value="">All routes</option>
            {routes.map((route) => (
              <option key={route.value} value={route.value}>
                {route.label}
                {optionSuffix(route.count)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label
            htmlFor="queue-status"
            className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500"
          >
            Status
          </label>
          <select
            id="queue-status"
            name="status"
            defaultValue={selectedStatus ?? ""}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
                {optionSuffix(status.count)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label
            htmlFor="queue-confidence"
            className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500"
          >
            Confidence
          </label>
          <select
            id="queue-confidence"
            name="confidenceBand"
            defaultValue={selectedConfidenceBand ?? ""}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
          >
            <option value="">All bands</option>
            {confidenceBands.map((band) => (
              <option key={band.value} value={band.value}>
                {band.label}
                {optionSuffix(band.count)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="flex-1 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white"
          >
            Apply filters
          </button>
          <Link
            href={action}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Reset
          </Link>
        </div>
      </form>
    </section>
  );
}
