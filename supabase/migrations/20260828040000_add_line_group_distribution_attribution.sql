-- v8.9.4 Phase 2A
-- Add LINE Group attribution fields for the future category-retention
-- distribution path.
--
-- Existing rows remain valid and unchanged. New columns are nullable so
-- historical Summary Group transfers do not need guessed attribution.
--
-- This migration does NOT change any confirmation RPC.

alter table public.settlement_distribution_runs
  add column if not exists line_group_id text,
  add column if not exists risk_model text;

alter table public.settlement_transfer_batches
  add column if not exists line_group_id text,
  add column if not exists risk_model text;

alter table public.settlement_transfer_batch_items
  add column if not exists line_group_id text,
  add column if not exists retention_limit bigint;

alter table public.settlement_transfer_batch_items
  drop constraint if exists settlement_transfer_batch_items_retention_limit_check;

alter table public.settlement_transfer_batch_items
  add constraint settlement_transfer_batch_items_retention_limit_check
  check (
    retention_limit is null
    or retention_limit >= 0
  );

create index if not exists settlement_distribution_runs_line_group_idx
  on public.settlement_distribution_runs(
    settlement_session_id,
    line_group_id,
    confirmed_at desc
  )
  where line_group_id is not null;

create index if not exists settlement_transfer_batches_line_group_idx
  on public.settlement_transfer_batches(
    settlement_session_id,
    line_group_id,
    confirmed_at desc
  )
  where line_group_id is not null;

create index if not exists settlement_transfer_items_line_group_idx
  on public.settlement_transfer_batch_items(
    line_group_id,
    category,
    code,
    batch_id
  )
  where line_group_id is not null;

comment on column public.settlement_distribution_runs.line_group_id is
  'LINE Group risk owner. NULL identifies legacy Summary Group distribution runs.';

comment on column public.settlement_distribution_runs.risk_model is
  'Risk model used by the run. CATEGORY_RETENTION is the LINE Group model.';

comment on column public.settlement_transfer_batches.line_group_id is
  'LINE Group risk owner. NULL identifies legacy Summary Group transfer batches.';

comment on column public.settlement_transfer_batches.risk_model is
  'Risk model authorizing the transfer batch.';

comment on column public.settlement_transfer_batch_items.line_group_id is
  'Exact LINE Group source of this transferred category/code quantity.';

comment on column public.settlement_transfer_batch_items.retention_limit is
  'Signed category-retention limit that authorized this transfer.';
