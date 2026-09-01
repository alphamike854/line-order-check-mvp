-- R2A v9.21
-- Summary Group Round Foundation
--
-- This migration is intentionally additive.
-- Existing settlement_sessions remains the compatibility container.
-- Existing OPEN_GROUP / CLOSE_GROUP behavior is not cut over yet.
-- No operational data is purged in this phase.

create table if not exists
  public.settlement_summary_group_rounds (
    id uuid primary key
      default gen_random_uuid(),

    settlement_session_id uuid not null
      references public.settlement_sessions(id)
      on delete cascade,

    summary_group_id text not null
      references public.summary_groups(id),

    round_no integer not null
      default 1
      check (round_no > 0),

    status text not null
      check (
        status in (
          'OPEN',
          'CLOSED'
        )
      ),

    opened_at timestamptz not null
      default now(),

    opened_by text,

    closed_at timestamptz,
    closed_by text,

    created_at timestamptz not null
      default now(),

    updated_at timestamptz not null
      default now(),

    unique (
      settlement_session_id,
      summary_group_id,
      round_no
    )
  );


-- There may be many historical CLOSED rounds,
-- but only one OPEN round of a Summary Group
-- may exist at a time across compatibility sessions.
create unique index if not exists
  settlement_summary_group_rounds_one_open_uidx
on public.settlement_summary_group_rounds (
  summary_group_id
)
where status = 'OPEN';


create index if not exists
  settlement_summary_group_rounds_session_idx
on public.settlement_summary_group_rounds (
  settlement_session_id,
  summary_group_id,
  round_no desc
);


-- Backfill current/historical settlement state as round 1.
--
-- Existing semantics:
--   CLOSED parent settlement          -> CLOSED round
--   OPEN parent + closed group        -> CLOSED round
--   OPEN parent + no control override -> OPEN round
--
-- Absence of settlement_summary_group_controls row currently
-- means accepting/open, so preserve that contract exactly.
insert into
  public.settlement_summary_group_rounds (
    settlement_session_id,
    summary_group_id,
    round_no,
    status,
    opened_at,
    opened_by,
    closed_at,
    closed_by
  )
select
  s.id,
  cfg.summary_group_id,
  1,

  case
    when s.status = 'CLOSED'
      then 'CLOSED'

    when coalesce(
      ctrl.accepting_orders,
      true
    ) = false
      then 'CLOSED'

    else 'OPEN'
  end,

  coalesce(
    s.opened_at,
    now()
  ),

  s.opened_by,

  case
    when s.status = 'CLOSED'
      then s.closed_at

    when coalesce(
      ctrl.accepting_orders,
      true
    ) = false
      then coalesce(
        ctrl.closed_at,
        ctrl.changed_at
      )

    else null
  end,

  case
    when s.status = 'CLOSED'
      then s.closed_by

    when coalesce(
      ctrl.accepting_orders,
      true
    ) = false
      then ctrl.changed_by

    else null
  end

from public.settlement_sessions s

join (
  select distinct
    settlement_session_id,
    summary_group_id

  from public.settlement_line_group_config

  where enabled = true
) cfg
  on cfg.settlement_session_id = s.id

left join
  public.settlement_summary_group_controls ctrl
  on ctrl.settlement_session_id =
       s.id
  and ctrl.summary_group_id =
       cfg.summary_group_id

on conflict (
  settlement_session_id,
  summary_group_id,
  round_no
)
do nothing;


alter table
  public.settlement_summary_group_rounds
enable row level security;


revoke all
on public.settlement_summary_group_rounds
from public, anon, authenticated;


grant
  select,
  insert,
  update,
  delete
on public.settlement_summary_group_rounds
to service_role;


comment on table
  public.settlement_summary_group_rounds
is
  'Independent lifecycle rounds for each Summary Group. '
  'Foundation only in R2A; operational ownership cutover occurs later.';
