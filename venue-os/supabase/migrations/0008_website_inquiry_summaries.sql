alter table public.website_inquiries
  add column summary_status text not null default 'skipped',
  add column summary_short text,
  add column summary_key_facts jsonb not null default '[]'::jsonb,
  add column summary_confidence double precision,
  add column summary_metadata jsonb not null default '{}'::jsonb,
  add column summary_generated_at timestamptz;

alter table public.website_inquiries
  add constraint website_inquiries_summary_status_check
    check (summary_status in ('pending', 'completed', 'failed', 'skipped'));

create index website_inquiries_summary_status_created_at_idx
  on public.website_inquiries (summary_status, created_at desc);
