-- v9.20A1
-- Parallel Summary Group Actual Point foundation.
--
-- IMPORTANT:
-- - Legacy settlement_actual_special_point_codes remains unchanged.
-- - Existing API / Dashboard / Risk views keep working unchanged.
-- - Existing legacy Point selections are copied to every Summary Group
--   to preserve the old Settlement-wide behavior.
-- - Legacy Point writes are mirrored to the new table until v9.20A2
--   cuts all callers over to the Summary Group-aware contract.

begin;


-- =========================================================
-- 1. New Summary Group-scoped Actual Point source
-- =========================================================

create table if not exists
  public.settlement_summary_group_actual_special_point_codes (
    settlement_session_id uuid not null
      references public.settlement_sessions(id)
      on delete cascade,

    summary_group_id text not null
      references public.summary_groups(id),

    category text not null
      check (
        category in (
          'A','B','E','F','G','H','L'
        )
      ),

    code text not null,

    created_at timestamptz not null
      default now(),

    primary key (
      settlement_session_id,
      summary_group_id,
      category,
      code
    )
  );


alter table
  public.settlement_summary_group_actual_special_point_codes
enable row level security;


revoke all
on public.settlement_summary_group_actual_special_point_codes
from public,anon,authenticated;


grant select,insert,update,delete
on public.settlement_summary_group_actual_special_point_codes
to service_role;


-- =========================================================
-- 2. Fail closed before legacy compatibility backfill
-- =========================================================

do $$
begin
  if exists (
    select 1
    from public.settlement_actual_special_point_codes a
    where not exists (
      select 1
      from public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id =
          a.settlement_session_id
    )
  ) then
    raise exception
      'ACTUAL_POINT_LEGACY_SESSION_WITHOUT_SUMMARY_GROUP';
  end if;
end
$$;


-- =========================================================
-- 3. Compatibility backfill
--
-- Old meaning:
-- one Actual Point set applied to the entire Settlement.
--
-- Therefore copy every legacy code into every Summary Group
-- captured by that Settlement.
-- =========================================================

insert into
  public.settlement_summary_group_actual_special_point_codes (
    settlement_session_id,
    summary_group_id,
    category,
    code,
    created_at
  )
select distinct
  a.settlement_session_id,
  cfg.summary_group_id,
  a.category,
  a.code,
  a.created_at
from
  public.settlement_actual_special_point_codes a
join
  public.settlement_line_group_config cfg
    on cfg.settlement_session_id =
       a.settlement_session_id

on conflict (
  settlement_session_id,
  summary_group_id,
  category,
  code
)
do nothing;


-- =========================================================
-- 4. Legacy mirror
--
-- Until v9.20A2 changes the frontend/API:
-- INSERT legacy Point -> copy to every Summary Group.
-- DELETE legacy Point -> remove that code from every group.
--
-- This keeps the parallel table synchronized while existing
-- production callers still use the old RPC.
-- =========================================================

create or replace function
  public.sync_legacy_actual_point_to_summary_groups()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin

  if tg_op = 'INSERT' then

    insert into
      public.settlement_summary_group_actual_special_point_codes (
        settlement_session_id,
        summary_group_id,
        category,
        code,
        created_at
      )
    select distinct
      new.settlement_session_id,
      cfg.summary_group_id,
      new.category,
      new.code,
      new.created_at
    from
      public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id =
        new.settlement_session_id

    on conflict (
      settlement_session_id,
      summary_group_id,
      category,
      code
    )
    do nothing;

    return new;

  elsif tg_op = 'DELETE' then

    delete from
      public.settlement_summary_group_actual_special_point_codes
    where
      settlement_session_id =
        old.settlement_session_id
      and category =
        old.category
      and code =
        old.code;

    return old;

  end if;

  return null;
end;
$$;


drop trigger if exists
  settlement_actual_point_summary_group_sync_trg
on
  public.settlement_actual_special_point_codes;


create trigger
  settlement_actual_point_summary_group_sync_trg
after insert or delete
on
  public.settlement_actual_special_point_codes
for each row
execute function
  public.sync_legacy_actual_point_to_summary_groups();


revoke all
on function
  public.sync_legacy_actual_point_to_summary_groups()
from public,anon,authenticated;


-- =========================================================
-- 5. New Summary Group-aware replace RPC
--
-- Actual Point remains editable both before and after CLOSE.
-- A change affects one Summary Group only.
-- =========================================================

create or replace function
  public.replace_settlement_summary_group_actual_special_codes(
    p_session_id uuid,
    p_summary_group_id text,
    p_codes jsonb
  )
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_summary text;
  v_item jsonb;
  v_category text;
  v_code text;
  v_limit integer;
  v_count integer := 0;
begin

  v_summary :=
    nullif(trim(p_summary_group_id), '');

  if v_summary is null then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;


  -- Same global Settlement boundary used by existing
  -- Settlement / Promotion mutation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  select *
  into v_session
  from public.settlement_sessions
  where id = p_session_id
  for update;


  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;


  if v_session.status not in ('OPEN','CLOSED') then
    raise exception 'SETTLEMENT_NOT_EDITABLE';
  end if;


  if not exists (
    select 1
    from public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id =
        p_session_id
      and cfg.summary_group_id =
        v_summary
  ) then
    raise exception
      'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;


  if
    p_codes is null
    or jsonb_typeof(p_codes) <> 'array'
  then
    raise exception 'INVALID_POINT_CODES';
  end if;


  -- Summary Group mutation boundary.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_session_id::text,
        v_summary
      ),
      0
    )
  );


  delete from
    public.settlement_summary_group_actual_special_point_codes
  where
    settlement_session_id =
      p_session_id
    and summary_group_id =
      v_summary;


  for v_item in
    select value
    from jsonb_array_elements(p_codes)
  loop

    v_category :=
      upper(trim(v_item->>'category'));

    v_code :=
      trim(v_item->>'code');


    select max_special_codes
    into v_limit
    from public.settlement_point_profiles
    where
      settlement_session_id =
        p_session_id
      and category =
        v_category;


    if
      v_limit is null
      or coalesce(v_code, '') = ''
    then
      raise exception 'INVALID_POINT_CODE';
    end if;


    if
      (
        v_category in ('H','L')
        and v_code !~ '^\d$'
      )
      or (
        v_category in ('A','B')
        and v_code !~ '^\d{2}$'
      )
      or (
        v_category in ('E','F','G')
        and v_code !~ '^\d{3}$'
      )
    then
      raise exception 'INVALID_POINT_CODE';
    end if;


    if exists (
      select 1
      from
        public.settlement_summary_group_actual_special_point_codes
      where
        settlement_session_id =
          p_session_id
        and summary_group_id =
          v_summary
        and category =
          v_category
        and code =
          v_code
    ) then
      raise exception 'DUPLICATE_POINT_CODE';
    end if;


    if (
      select count(*)
      from
        public.settlement_summary_group_actual_special_point_codes
      where
        settlement_session_id =
          p_session_id
        and summary_group_id =
          v_summary
        and category =
          v_category
    ) >= v_limit
    then
      raise exception
        'SPECIAL_POINT_LIMIT_%',
        v_category;
    end if;


    insert into
      public.settlement_summary_group_actual_special_point_codes (
        settlement_session_id,
        summary_group_id,
        category,
        code
      )
    values (
      p_session_id,
      v_summary,
      v_category,
      v_code
    );


    v_count :=
      v_count + 1;

  end loop;


  return v_count;

end;
$$;


revoke all
on function
  public.replace_settlement_summary_group_actual_special_codes(
    uuid,
    text,
    jsonb
  )
from public,anon,authenticated;


grant execute
on function
  public.replace_settlement_summary_group_actual_special_codes(
    uuid,
    text,
    jsonb
  )
to service_role;


-- =========================================================
-- 6. Summary Group-aware readiness
--
-- This is PARALLEL only in A1.
-- session_actual_point_status remains untouched until A2.
-- =========================================================

create or replace view
  public.session_summary_group_actual_point_status
as

with groups as (

  select distinct
    cfg.settlement_session_id,
    cfg.summary_group_id

  from
    public.settlement_line_group_config cfg

),

counts as (

  select
    g.settlement_session_id,
    g.summary_group_id,
    p.category,
    p.max_special_codes,

    exists (
      select 1

      from
        public.order_items oi

      join
        public.settlement_line_group_config cfg
          on cfg.settlement_session_id =
             oi.settlement_session_id
         and cfg.line_group_id =
             oi.line_group_id

      where
        oi.settlement_session_id =
          g.settlement_session_id

        and cfg.summary_group_id =
          g.summary_group_id

        and oi.category =
          p.category
    ) as has_orders,

    count(a.code)::integer
      as selected_count

  from
    groups g

  join
    public.settlement_point_profiles p
      on p.settlement_session_id =
         g.settlement_session_id

  left join
    public.settlement_summary_group_actual_special_point_codes a
      on a.settlement_session_id =
         g.settlement_session_id
     and a.summary_group_id =
         g.summary_group_id
     and a.category =
         p.category

  group by
    g.settlement_session_id,
    g.summary_group_id,
    p.category,
    p.max_special_codes

)

select
  settlement_session_id,
  summary_group_id,

  bool_and(
    case

      when not has_orders
        then true

      when category in ('A','B','E')
        then selected_count = 1

      when category in ('G','H','L')
        then selected_count =
          max_special_codes

      when category = 'F'
        then selected_count
          between 0 and max_special_codes

      else false

    end
  ) as actual_codes_ready,

  jsonb_object_agg(
    category,
    jsonb_build_object(
      'selected',
      selected_count,
      'max',
      max_special_codes,
      'active',
      has_orders
    )
  ) as category_counts

from
  counts

group by
  settlement_session_id,
  summary_group_id;


revoke all
on public.session_summary_group_actual_point_status
from public,anon,authenticated;


grant select
on public.session_summary_group_actual_point_status
to service_role;


commit;
