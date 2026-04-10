alter table public.messages
  add column policy_decision text,
  add column policy_reasons jsonb not null default '[]'::jsonb,
  add column policy_evaluated_at timestamptz;

alter table public.messages
  add constraint messages_policy_decision_check
  check (
    policy_decision is null
    or policy_decision in ('safe_to_send', 'needs_review', 'block_send')
  );
