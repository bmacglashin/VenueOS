alter table public.audit_logs
  add column request_id text,
  add column trace_id text,
  add column error_type text;

update public.audit_logs
set
  request_id = coalesce(request_id, gen_random_uuid()::text),
  trace_id = coalesce(trace_id, gen_random_uuid()::text)
where request_id is null
   or trace_id is null;

alter table public.audit_logs
  alter column request_id set not null,
  alter column trace_id set not null;

alter table public.audit_logs
  add constraint audit_logs_error_type_check
  check (
    error_type is null
    or error_type in (
      'validation_error',
      'config_error',
      'db_error',
      'external_api_error',
      'timeout_error',
      'idempotency_drop',
      'unknown_error'
    )
  );

create index audit_logs_request_id_idx
  on public.audit_logs (request_id);

create index audit_logs_trace_id_idx
  on public.audit_logs (trace_id);
