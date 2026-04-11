alter table public.knowledge_sources
  add column source_name text,
  add column source_ref text,
  add column checksum text,
  add column revision text,
  add column ingested_at timestamptz;

update public.knowledge_sources
set
  source_name = coalesce(file_name, 'legacy-source'),
  source_ref = file_name,
  checksum = encode(digest(content, 'sha256'), 'hex'),
  revision = 'legacy',
  ingested_at = created_at
where source_name is null
   or checksum is null
   or revision is null
   or ingested_at is null;

alter table public.knowledge_sources
  alter column source_name set not null,
  alter column checksum set not null,
  alter column revision set not null,
  alter column ingested_at set not null,
  alter column source_name set default 'legacy-source',
  alter column checksum set default '',
  alter column revision set default 'legacy',
  alter column ingested_at set default now();

create unique index knowledge_sources_tenant_source_checksum_key
  on public.knowledge_sources (tenant_id, source_type, source_name, checksum);

create index knowledge_sources_tenant_source_status_idx
  on public.knowledge_sources (tenant_id, source_type, source_name, status, ingested_at desc);
