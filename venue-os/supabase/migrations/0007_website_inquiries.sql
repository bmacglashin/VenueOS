create table public.website_inquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.venue_tenants(id) on delete cascade,
  contact_name text not null,
  email text not null,
  phone text,
  event_date date not null,
  guest_count integer not null,
  message text not null,
  source text not null,
  status text not null default 'received',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_inquiries_guest_count_check
    check (guest_count > 0),
  constraint website_inquiries_status_check
    check (status in ('received', 'reviewed', 'archived'))
);

create index website_inquiries_tenant_created_at_idx
  on public.website_inquiries (tenant_id, created_at desc);

create index website_inquiries_status_created_at_idx
  on public.website_inquiries (status, created_at desc);

create index website_inquiries_event_date_idx
  on public.website_inquiries (event_date);

create index website_inquiries_source_idx
  on public.website_inquiries (source);

create trigger set_website_inquiries_updated_at
before update on public.website_inquiries
for each row
execute function public.set_updated_at();
