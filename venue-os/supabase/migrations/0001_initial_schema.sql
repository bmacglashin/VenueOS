create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.venue_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ghl_location_id text,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.venue_tenants(id) on delete cascade,
  ghl_contact_id text,
  ghl_conversation_id text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null,
  content text not null,
  direction text not null,
  ghl_message_id text,
  source text not null,
  status text not null default 'recorded',
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.venue_tenants(id) on delete cascade,
  source_type text not null,
  file_name text,
  content text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.venue_tenants(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'recorded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index venue_tenants_slug_key
  on public.venue_tenants (slug);

create unique index venue_tenants_ghl_location_id_key
  on public.venue_tenants (ghl_location_id)
  where ghl_location_id is not null;

create index conversations_tenant_id_idx
  on public.conversations (tenant_id);

create index conversations_ghl_contact_id_idx
  on public.conversations (ghl_contact_id);

create unique index conversations_tenant_id_ghl_conversation_id_key
  on public.conversations (tenant_id, ghl_conversation_id)
  where ghl_conversation_id is not null;

create index messages_conversation_id_idx
  on public.messages (conversation_id);

create unique index messages_ghl_message_id_key
  on public.messages (ghl_message_id)
  where ghl_message_id is not null;

create index knowledge_sources_tenant_id_idx
  on public.knowledge_sources (tenant_id);

create index audit_logs_tenant_id_idx
  on public.audit_logs (tenant_id);

create trigger set_venue_tenants_updated_at
before update on public.venue_tenants
for each row
execute function public.set_updated_at();

create trigger set_conversations_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

create trigger set_messages_updated_at
before update on public.messages
for each row
execute function public.set_updated_at();

create trigger set_knowledge_sources_updated_at
before update on public.knowledge_sources
for each row
execute function public.set_updated_at();

create trigger set_audit_logs_updated_at
before update on public.audit_logs
for each row
execute function public.set_updated_at();
