-- Allow an OPEN settlement to stop/resume accepting new messages
-- from a LINE group without changing historical group mapping.
alter table public.settlement_line_group_config
  add column if not exists enabled boolean not null default true;
