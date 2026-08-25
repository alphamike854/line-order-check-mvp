-- Dashboard v6.2: guarantee Point Profile snapshots for every settlement.
--
-- Why this exists:
-- Some databases can have the v6 tables/views while open_settlement_session()
-- is still the older v5 definition. In that state, daily reports work but Risk/Summary
-- is empty because settlement_point_profiles has no rows for the open settlement.
--
-- This migration makes the database itself enforce the snapshot invariant:
--   every new settlement gets A/B/E/F/G profile rows.
-- It also restores the v6 open_settlement_session() contract where promotions are
-- expressed as point_factor_pct.

-- 1) Repair all existing settlements that are missing one or more profile rows.
insert into public.settlement_point_profiles (
  settlement_session_id,
  category,
  special_multiplier,
  max_special_codes
)
select
  s.id,
  p.category,
  p.special_multiplier,
  p.max_special_codes
from public.settlement_sessions s
cross join public.point_category_profiles p
on conflict (settlement_session_id, category) do nothing;

-- 2) Database-level invariant: any settlement created by any code path receives
--    a Point Profile snapshot automatically.
create or replace function public.snapshot_settlement_point_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.settlement_point_profiles (
    settlement_session_id,
    category,
    special_multiplier,
    max_special_codes
  )
  select
    new.id,
    p.category,
    p.special_multiplier,
    p.max_special_codes
  from public.point_category_profiles p
  on conflict (settlement_session_id, category) do nothing;

  return new;
end;
$$;

drop trigger if exists settlement_sessions_snapshot_point_profiles
  on public.settlement_sessions;

create trigger settlement_sessions_snapshot_point_profiles
after insert on public.settlement_sessions
for each row
execute function public.snapshot_settlement_point_profiles();

-- 3) Restore/harden the v6 settlement-opening RPC.
--    The explicit profile insert is intentionally kept as a second safety layer;
--    ON CONFLICT makes it compatible with the trigger above.
create or replace function public.open_settlement_session(
  p_business_date date,
  p_promotions jsonb default '[]'::jsonb,
  p_opened_by text default 'DASHBOARD'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_category text;
  v_code text;
  v_factor numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE', 0));

  if exists (
    select 1
    from public.settlement_sessions
    where status = 'OPEN'
  ) then
    raise exception 'SETTLEMENT_ALREADY_OPEN';
  end if;

  if p_promotions is null or jsonb_typeof(p_promotions) <> 'array' then
    raise exception 'INVALID_PROMOTIONS';
  end if;

  insert into public.settlement_sessions (
    business_date,
    status,
    opened_by
  )
  values (
    p_business_date,
    'OPEN',
    p_opened_by
  )
  returning id into v_id;

  insert into public.settlement_line_group_config (
    settlement_session_id,
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct
  )
  select
    v_id,
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct
  from public.line_groups
  where enabled = true;

  -- Legacy threshold snapshots remain for historical compatibility only.
  insert into public.settlement_allocation_rules (
    settlement_session_id,
    summary_group_id,
    category,
    threshold,
    destination
  )
  select
    v_id,
    summary_group_id,
    category,
    threshold,
    destination
  from public.allocation_rules
  where enabled = true;

  -- Second safety layer in addition to the INSERT trigger.
  insert into public.settlement_point_profiles (
    settlement_session_id,
    category,
    special_multiplier,
    max_special_codes
  )
  select
    v_id,
    category,
    special_multiplier,
    max_special_codes
  from public.point_category_profiles
  on conflict (settlement_session_id, category) do nothing;

  for v_item in
    select value
    from jsonb_array_elements(p_promotions)
  loop
    v_category := upper(trim(v_item->>'category'));
    v_code := trim(v_item->>'code');

    begin
      v_factor := (v_item->>'point_factor_pct')::numeric;
    exception when others then
      raise exception 'INVALID_PROMOTION_FACTOR';
    end;

    if v_category not in ('A','B','E','F','G')
       or coalesce(v_code,'') = ''
       or v_factor < 0
       or v_factor > 100 then
      raise exception 'INVALID_PROMOTION_RULE';
    end if;

    if (v_category in ('A','B') and v_code !~ '^\d{2}$')
       or (v_category in ('E','F','G') and v_code !~ '^\d{3}$') then
      raise exception 'INVALID_PROMOTION_CODE';
    end if;

    insert into public.settlement_point_promotions (
      settlement_session_id,
      category,
      code,
      point_factor_pct
    )
    values (
      v_id,
      v_category,
      v_code,
      v_factor
    )
    on conflict (settlement_session_id, category, code)
    do update set point_factor_pct = excluded.point_factor_pct;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.snapshot_settlement_point_profiles() from public, anon, authenticated;
revoke all on function public.open_settlement_session(date,jsonb,text) from public, anon, authenticated;
grant execute on function public.open_settlement_session(date,jsonb,text) to service_role;
