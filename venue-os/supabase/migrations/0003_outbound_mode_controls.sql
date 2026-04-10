alter table public.venue_tenants
  add column outbound_mode_override text;

alter table public.venue_tenants
  add constraint venue_tenants_outbound_mode_override_check
  check (
    outbound_mode_override is null
    or outbound_mode_override in ('enabled', 'review_only', 'disabled')
  );
