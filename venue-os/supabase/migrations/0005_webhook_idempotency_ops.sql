create table public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  idempotency_key text not null,
  tenant_id uuid references public.venue_tenants(id) on delete set null,
  status text not null default 'processing',
  upstream_event_id text,
  upstream_message_id text,
  request_id text not null,
  trace_id text not null,
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processed_webhook_events_status_check
    check (status in ('processing', 'processed'))
);

create unique index processed_webhook_events_source_idempotency_key_key
  on public.processed_webhook_events (source, idempotency_key);

create index processed_webhook_events_tenant_id_idx
  on public.processed_webhook_events (tenant_id);

create index processed_webhook_events_status_idx
  on public.processed_webhook_events (status);

create trigger set_processed_webhook_events_updated_at
before update on public.processed_webhook_events
for each row
execute function public.set_updated_at();
