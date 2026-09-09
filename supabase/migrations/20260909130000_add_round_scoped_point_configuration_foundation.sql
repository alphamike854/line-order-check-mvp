-- Round-scoped Point configuration foundation v1
--
-- Business model:
--   Actual/Special Point:
--     Round x Summary Group x Category x Code
--
--   Point Promotion:
--     Round x Summary Group x Category x Code
--     target scope ALL or SELECTED LINE Groups
--
-- Parallel-source foundation only.
-- Existing settlement-scoped sources, APIs and risk/report views remain
-- authoritative until a later explicit cutover phase.
--
-- Historical safety:
-- Existing settlement-scoped configuration has no reliable historical
-- Round provenance because it was intentionally preserved across Round
-- resets. Therefore migration copies each current config row ONLY to the
-- latest Round of the same Settlement + Summary Group. It never invents
-- configuration for older Rounds.

begin;

create table if not exists
  public.settlement_round_point_promotions (
    id uuid primary key default gen_random_uuid(),

    round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    category text not null
      check (category in ('A','B','E','F','G','H','L')),

    code text not null,

    point_factor_pct numeric(7,3) not null
      check (
        point_factor_pct >= 0
        and point_factor_pct <= 100
      ),

    target_scope text not null
      default 'ALL'
      check (target_scope in ('ALL','SELECTED')),

    updated_at timestamptz not null
      default now(),

    updated_by text,

    unique (
      round_id,
      category,
      code
    ),

    check (
      (
        category in ('H','L')
        and code ~ '^\d$'
      )
      or (
        category in ('A','B')
        and code ~ '^\d{2}$'
      )
      or (
        category in ('E','F','G')
        and code ~ '^\d{3}$'
      )
    )
  );

create table if not exists
  public.settlement_round_point_promotion_line_groups (
    promotion_id uuid not null
      references public.settlement_round_point_promotions(id)
      on delete cascade,

    line_group_id text not null,

    created_at timestamptz not null
      default now(),

    created_by text,

    primary key (
      promotion_id,
      line_group_id
    )
  );

create index if not exists
  settlement_round_point_promotions_round_idx
on public.settlement_round_point_promotions (
  round_id,
  category,
  code
);

create index if not exists
  settlement_round_point_promotion_line_groups_lookup_idx
on public.settlement_round_point_promotion_line_groups (
  line_group_id,
  promotion_id
);

create table if not exists
  public.settlement_round_point_promotion_events (
    id bigint generated always as identity primary key,

    round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    category text not null
      check (category in ('A','B','E','F','G','H','L')),

    code text not null,

    action text not null
      check (action in ('ADD','UPDATE','DELETE')),

    previous_point_factor_pct numeric(7,3)
      check (
        previous_point_factor_pct is null
        or (
          previous_point_factor_pct >= 0
          and previous_point_factor_pct <= 100
        )
      ),

    new_point_factor_pct numeric(7,3)
      check (
        new_point_factor_pct is null
        or (
          new_point_factor_pct >= 0
          and new_point_factor_pct <= 100
        )
      ),

    previous_target_scope text
      check (
        previous_target_scope is null
        or previous_target_scope in ('ALL','SELECTED')
      ),

    new_target_scope text
      check (
        new_target_scope is null
        or new_target_scope in ('ALL','SELECTED')
      ),

    previous_line_group_ids jsonb,

    new_line_group_ids jsonb,

    changed_at timestamptz not null
      default now(),

    changed_by text,

    check (
      previous_line_group_ids is null
      or jsonb_typeof(previous_line_group_ids) = 'array'
    ),

    check (
      new_line_group_ids is null
      or jsonb_typeof(new_line_group_ids) = 'array'
    )
  );

create index if not exists
  settlement_round_point_promotion_events_lookup_idx
on public.settlement_round_point_promotion_events (
  round_id,
  changed_at desc
);

create table if not exists
  public.settlement_round_actual_special_point_codes (
    round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    category text not null
      check (category in ('A','B','E','F','G','H','L')),

    code text not null,

    created_at timestamptz not null
      default now(),

    updated_at timestamptz not null
      default now(),

    updated_by text,

    primary key (
      round_id,
      category,
      code
    ),

    check (
      (
        category in ('H','L')
        and code ~ '^\d$'
      )
      or (
        category in ('A','B')
        and code ~ '^\d{2}$'
      )
      or (
        category in ('E','F','G')
        and code ~ '^\d{3}$'
      )
    )
  );

create table if not exists
  public.settlement_round_actual_special_point_events (
    id bigint generated always as identity primary key,

    round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    action text not null
      check (action = 'REPLACE'),

    previous_codes jsonb not null
      check (jsonb_typeof(previous_codes) = 'array'),

    new_codes jsonb not null
      check (jsonb_typeof(new_codes) = 'array'),

    changed_at timestamptz not null
      default now(),

    changed_by text
  );

create index if not exists
  settlement_round_actual_special_point_events_lookup_idx
on public.settlement_round_actual_special_point_events (
  round_id,
  changed_at desc
);

-- Fail closed before compatibility backfill.
-- Every current settlement-scoped config row must resolve to at least one
-- real Summary Group Round. Never silently drop an unmapped config row.

do $$
begin
  if exists (
    select 1
    from public.settlement_point_promotions pm
    where not exists (
      select 1
      from public.settlement_summary_group_rounds r
      where
        r.settlement_session_id = pm.settlement_session_id
        and r.summary_group_id = pm.summary_group_id
    )
  ) then
    raise exception
      'ROUND_CONFIG_PROMOTION_UNMAPPED';
  end if;

  if exists (
    select 1
    from public.settlement_summary_group_actual_special_point_codes sp
    where not exists (
      select 1
      from public.settlement_summary_group_rounds r
      where
        r.settlement_session_id = sp.settlement_session_id
        and r.summary_group_id = sp.summary_group_id
    )
  ) then
    raise exception
      'ROUND_CONFIG_ACTUAL_POINT_UNMAPPED';
  end if;
end;
$$;

-- Legacy Promotion was Summary-Group scoped and therefore applied to every
-- LINE Group inside that Summary Group. Preserve that exact meaning as ALL.
-- Copy only to the latest Round; older Round config history is unknowable.

insert into
  public.settlement_round_point_promotions (
    round_id,
    category,
    code,
    point_factor_pct,
    target_scope,
    updated_at,
    updated_by
  )
select
  latest_round.id,
  pm.category,
  pm.code,
  pm.point_factor_pct,
  'ALL',
  coalesce(pm.updated_at, now()),
  pm.updated_by
from public.settlement_point_promotions pm
join lateral (
  select r.id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id = pm.settlement_session_id
    and r.summary_group_id = pm.summary_group_id
  order by r.round_no desc
  limit 1
) latest_round on true
on conflict (
  round_id,
  category,
  code
)
do nothing;

-- Current Actual/Special Point is also Settlement + Summary Group scoped.
-- Copy only to the latest Round.

insert into
  public.settlement_round_actual_special_point_codes (
    round_id,
    category,
    code,
    created_at,
    updated_at,
    updated_by
  )
select
  latest_round.id,
  sp.category,
  sp.code,
  coalesce(sp.created_at, now()),
  now(),
  'MIGRATION'
from public.settlement_summary_group_actual_special_point_codes sp
join lateral (
  select r.id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id = sp.settlement_session_id
    and r.summary_group_id = sp.summary_group_id
  order by r.round_no desc
  limit 1
) latest_round on true
on conflict (
  round_id,
  category,
  code
)
do nothing;

alter table
  public.settlement_round_point_promotions
enable row level security;

alter table
  public.settlement_round_point_promotion_line_groups
enable row level security;

alter table
  public.settlement_round_point_promotion_events
enable row level security;

alter table
  public.settlement_round_actual_special_point_codes
enable row level security;

alter table
  public.settlement_round_actual_special_point_events
enable row level security;

revoke all
on public.settlement_round_point_promotions
from public, anon, authenticated;

revoke all
on public.settlement_round_point_promotion_line_groups
from public, anon, authenticated;

revoke all
on public.settlement_round_point_promotion_events
from public, anon, authenticated;

revoke all
on public.settlement_round_actual_special_point_codes
from public, anon, authenticated;

revoke all
on public.settlement_round_actual_special_point_events
from public, anon, authenticated;

grant select, insert, update, delete
on public.settlement_round_point_promotions
to service_role;

grant select, insert, update, delete
on public.settlement_round_point_promotion_line_groups
to service_role;

grant select, insert
on public.settlement_round_point_promotion_events
to service_role;

grant select, insert, update, delete
on public.settlement_round_actual_special_point_codes
to service_role;

grant select, insert
on public.settlement_round_actual_special_point_events
to service_role;

grant usage, select
on sequence public.settlement_round_point_promotion_events_id_seq
to service_role;

grant usage, select
on sequence public.settlement_round_actual_special_point_events_id_seq
to service_role;

comment on table
  public.settlement_round_point_promotions
is
  'Round-scoped Point Promotion. ALL applies to every LINE Group '
  'in the Round Summary Group; SELECTED uses the target table.';

comment on table
  public.settlement_round_actual_special_point_codes
is
  'Round-scoped Actual/Special Point codes for one Summary Group Round. '
  'Later audited RPCs may change them before or after Round close.';

commit;
