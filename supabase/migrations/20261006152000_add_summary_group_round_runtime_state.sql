-- R1 Retention V1 — Summary Group Round Runtime State Foundation
--
-- Purpose:
-- - Keep one minimal runtime cursor per Summary Group.
-- - Preserve enough state to identify the latest Round across settlement sessions.
-- - Preserve round-number state after older Round rows are eventually purged.
--
-- This migration is intentionally additive.
-- It DOES NOT:
-- - delete or purge any operational/business data
-- - replace OPEN_GROUP / CLOSE_GROUP lifecycle RPCs
-- - change existing daily-round numbering behavior
-- - create parser/post-close archives
-- - open or close any Round

begin;


-- ============================================================
-- 1. One runtime cursor per Summary Group that has opened a Round
-- ============================================================

create table if not exists
  public.summary_group_round_runtime_state (
    summary_group_id text primary key
      references public.summary_groups(id)
      on delete cascade,

    latest_round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete restrict,

    latest_settlement_session_id uuid not null
      references public.settlement_sessions(id)
      on delete restrict,

    latest_round_no integer not null
      check (latest_round_no > 0),

    latest_business_date date not null,

    latest_daily_round_no integer not null
      check (latest_daily_round_no > 0),

    latest_opened_at timestamptz not null,

    generation bigint not null
      check (generation > 0),

    updated_at timestamptz not null
      default clock_timestamp()
  );


comment on table
  public.summary_group_round_runtime_state
is
  'Minimal non-historical runtime cursor for the latest Summary Group Round across settlement sessions. '
  'This table is system state, not retained business history.';


comment on column
  public.summary_group_round_runtime_state.generation
is
  'Monotonic Summary Group Round generation. It survives future historical Round purge and must increase only when a newer Round is inserted.';


alter table
  public.summary_group_round_runtime_state
enable row level security;


revoke all
on table
  public.summary_group_round_runtime_state
from
  public,
  anon,
  authenticated,
  service_role;


grant select
on table
  public.summary_group_round_runtime_state
to service_role;


-- ============================================================
-- 2. Backfill exactly one cursor from the latest existing Round
--
-- Latest is global per Summary Group, deliberately NOT scoped by
-- settlement_session_id. This is the cross-session foundation.
-- ============================================================

with ranked as (
  select
    r.id as latest_round_id,
    r.settlement_session_id
      as latest_settlement_session_id,
    r.summary_group_id,
    r.round_no
      as latest_round_no,
    r.business_date
      as latest_business_date,
    r.daily_round_no
      as latest_daily_round_no,
    r.opened_at
      as latest_opened_at,

    row_number() over (
      partition by
        r.summary_group_id
      order by
        r.opened_at desc,
        r.created_at desc,
        r.id desc
    ) as recency_rank,

    count(*) over (
      partition by
        r.summary_group_id
    )::bigint as generation

  from
    public.settlement_summary_group_rounds r
)

insert into
  public.summary_group_round_runtime_state (
    summary_group_id,
    latest_round_id,
    latest_settlement_session_id,
    latest_round_no,
    latest_business_date,
    latest_daily_round_no,
    latest_opened_at,
    generation,
    updated_at
  )

select
  ranked.summary_group_id,
  ranked.latest_round_id,
  ranked.latest_settlement_session_id,
  ranked.latest_round_no,
  ranked.latest_business_date,
  ranked.latest_daily_round_no,
  ranked.latest_opened_at,
  ranked.generation,
  clock_timestamp()

from
  ranked

where
  ranked.recency_rank = 1

on conflict (
  summary_group_id
)
do update set
  latest_round_id =
    excluded.latest_round_id,

  latest_settlement_session_id =
    excluded.latest_settlement_session_id,

  latest_round_no =
    excluded.latest_round_no,

  latest_business_date =
    excluded.latest_business_date,

  latest_daily_round_no =
    excluded.latest_daily_round_no,

  latest_opened_at =
    excluded.latest_opened_at,

  generation =
    excluded.generation,

  updated_at =
    excluded.updated_at;


-- ============================================================
-- 3. Mirror future Round creation into the runtime cursor
--
-- Existing Round insert behavior remains authoritative:
-- - business_date / daily_round_no are assigned by the existing
--   BEFORE INSERT daily identity trigger.
-- - immutable LINE Group lineage remains captured by its existing
--   AFTER INSERT trigger.
--
-- This trigger only records the resulting Round identity.
-- ============================================================

create or replace function
  public.sync_summary_group_round_runtime_state()

returns trigger

language plpgsql

security definer

set search_path = public

as $$
begin
  if
    new.business_date is null
    or new.daily_round_no is null
  then
    raise exception
      'ROUND_RUNTIME_STATE_IDENTITY_REQUIRED';
  end if;


  insert into
    public.summary_group_round_runtime_state as state (
      summary_group_id,
      latest_round_id,
      latest_settlement_session_id,
      latest_round_no,
      latest_business_date,
      latest_daily_round_no,
      latest_opened_at,
      generation,
      updated_at
    )

  values (
    new.summary_group_id,
    new.id,
    new.settlement_session_id,
    new.round_no,
    new.business_date,
    new.daily_round_no,
    new.opened_at,
    1,
    clock_timestamp()
  )

  on conflict (
    summary_group_id
  )

  do update set
    latest_round_id =
      excluded.latest_round_id,

    latest_settlement_session_id =
      excluded.latest_settlement_session_id,

    latest_round_no =
      excluded.latest_round_no,

    latest_business_date =
      excluded.latest_business_date,

    latest_daily_round_no =
      excluded.latest_daily_round_no,

    latest_opened_at =
      excluded.latest_opened_at,

    generation =
      state.generation + 1,

    updated_at =
      excluded.updated_at

  where
    excluded.latest_opened_at >=
      state.latest_opened_at;


  return new;
end;
$$;


revoke all
on function
  public.sync_summary_group_round_runtime_state()
from
  public,
  anon,
  authenticated,
  service_role;


drop trigger if exists
  settlement_summary_group_round_runtime_state_trg
on public.settlement_summary_group_rounds;


create trigger
  settlement_summary_group_round_runtime_state_trg

after insert

on public.settlement_summary_group_rounds

for each row

execute function
  public.sync_summary_group_round_runtime_state();


comment on function
  public.sync_summary_group_round_runtime_state()
is
  'R1 additive runtime cursor mirror. Records only the latest Summary Group Round identity and monotonic generation; performs no purge and changes no intake behavior.';


commit;
