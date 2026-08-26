-- v7.7: H/L one-digit categories and independent risk pools.
-- H0-H9 = วิ่งบน, max 3 special Point codes.
-- L0-L9 = วิ่งล่าง, max 2 special Point codes.
-- H and L are deliberately excluded from the MAIN A/B/E/F/G risk budget.
-- Their Point multipliers start at 0 (not configured) so the system never invents
-- a company multiplier. Configure each multiplier in Settings before using H/L risk cuts.

create table if not exists public.category_definitions (
  category text primary key,
  display_name text not null,
  code_length smallint not null check (code_length between 1 and 3),
  risk_pool text not null check (risk_pool in ('MAIN','H','L')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.category_definitions(category,display_name,code_length,risk_pool,enabled) values
  ('A','A',2,'MAIN',true),
  ('B','B',2,'MAIN',true),
  ('E','E',3,'MAIN',true),
  ('F','F',3,'MAIN',true),
  ('G','G',3,'MAIN',true),
  ('H','วิ่งบน',1,'H',true),
  ('L','วิ่งล่าง',1,'L',true)
on conflict(category) do update set
  display_name=excluded.display_name,
  code_length=excluded.code_length,
  risk_pool=excluded.risk_pool,
  enabled=excluded.enabled,
  updated_at=now();

alter table public.category_definitions enable row level security;
revoke all on public.category_definitions from anon,authenticated;

-- Expand persisted category constraints.
alter table public.order_items drop constraint if exists order_items_category_check;
alter table public.order_items add constraint order_items_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.allocation_rules drop constraint if exists allocation_rules_category_check;
alter table public.allocation_rules add constraint allocation_rules_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.allocation_confirmations drop constraint if exists allocation_confirmations_category_check;
alter table public.allocation_confirmations add constraint allocation_confirmations_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.allocation_confirmation_events drop constraint if exists allocation_confirmation_events_category_check;
alter table public.allocation_confirmation_events add constraint allocation_confirmation_events_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_allocation_rules drop constraint if exists settlement_allocation_rules_category_check;
alter table public.settlement_allocation_rules add constraint settlement_allocation_rules_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_promotion_rules drop constraint if exists settlement_promotion_rules_category_check;
alter table public.settlement_promotion_rules add constraint settlement_promotion_rules_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_special_point_rules drop constraint if exists settlement_special_point_rules_category_check;
alter table public.settlement_special_point_rules add constraint settlement_special_point_rules_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_allocation_confirmations drop constraint if exists settlement_allocation_confirmations_category_check;
alter table public.settlement_allocation_confirmations add constraint settlement_allocation_confirmations_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_point_promotions drop constraint if exists settlement_point_promotions_category_check;
alter table public.settlement_point_promotions add constraint settlement_point_promotions_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_actual_special_point_codes drop constraint if exists settlement_actual_special_point_codes_category_check;
alter table public.settlement_actual_special_point_codes add constraint settlement_actual_special_point_codes_category_check check(category in ('A','B','E','F','G','H','L'));

alter table public.settlement_transfer_batch_items drop constraint if exists settlement_transfer_batch_items_category_check;
alter table public.settlement_transfer_batch_items add constraint settlement_transfer_batch_items_category_check check(category in ('A','B','E','F','G','H','L'));

-- Alias targets are parser commands/categories, not all persisted categories.
alter table public.category_aliases drop constraint if exists category_aliases_canonical_category_check;
alter table public.category_aliases add constraint category_aliases_canonical_category_check
  check(canonical_category in ('A','B','AB','C','ABC','D','E','F','G','H','L','DOUBLE','PERMUTE_ALL'));

insert into public.category_aliases(alias,canonical_category,enabled) values
  ('วิ่งบน','H',true),
  ('วิ่ง บ','H',true),
  ('วิ่งล่าง','L',true),
  ('วิ่ง ล','L',true)
on conflict(alias) do nothing;

-- H/L need a configurable multiplier. Zero explicitly means "not configured yet".
-- Expand BOTH company and settlement snapshot constraints before inserting H/L.
-- The v6.7 company-profile trigger immediately syncs new company rows into the
-- current OPEN settlement, so settlement_point_profiles must accept H/L + zero first.
alter table public.settlement_point_profiles drop constraint if exists settlement_point_profiles_category_check;
alter table public.settlement_point_profiles add constraint settlement_point_profiles_category_check check(category in ('A','B','E','F','G','H','L'));
alter table public.settlement_point_profiles drop constraint if exists settlement_point_profiles_special_multiplier_check;
alter table public.settlement_point_profiles add constraint settlement_point_profiles_special_multiplier_check check(special_multiplier >= 0);

alter table public.point_category_profiles drop constraint if exists point_category_profiles_category_check;
alter table public.point_category_profiles add constraint point_category_profiles_category_check check(category in ('A','B','E','F','G','H','L'));
alter table public.point_category_profiles drop constraint if exists point_category_profiles_special_multiplier_check;
alter table public.point_category_profiles add constraint point_category_profiles_special_multiplier_check check(special_multiplier >= 0);

insert into public.point_category_profiles(category,special_multiplier,max_special_codes) values
  ('H',0,3),('L',0,2)
on conflict(category) do nothing;

alter table public.point_category_profiles drop constraint if exists point_category_profiles_hl_slots_check;
alter table public.point_category_profiles add constraint point_category_profiles_hl_slots_check check(
  (category='H' and max_special_codes=3)
  or (category='L' and max_special_codes=2)
  or category not in ('H','L')
);
alter table public.settlement_point_profiles drop constraint if exists settlement_point_profiles_hl_slots_check;
alter table public.settlement_point_profiles add constraint settlement_point_profiles_hl_slots_check check(
  (category='H' and max_special_codes=3)
  or (category='L' and max_special_codes=2)
  or category not in ('H','L')
);

insert into public.settlement_point_profiles(settlement_session_id,category,special_multiplier,max_special_codes)
select s.id,p.category,p.special_multiplier,p.max_special_codes
from public.settlement_sessions s
cross join public.point_category_profiles p
where s.status='OPEN'
  and p.category in ('H','L')
on conflict(settlement_session_id,category) do nothing;

-- Risk tolerance is independent by pool. MAIN inherits the existing setting;
-- H/L default to zero until the operator chooses a separate tolerance.
create table if not exists public.summary_group_risk_pool_settings (
  summary_group_id text not null references public.summary_groups(id) on delete cascade,
  risk_pool text not null check(risk_pool in ('MAIN','H','L')),
  point_loss_tolerance numeric(18,2) not null default 0 check(point_loss_tolerance >= 0),
  updated_at timestamptz not null default now(),
  primary key(summary_group_id,risk_pool)
);

insert into public.summary_group_risk_pool_settings(summary_group_id,risk_pool,point_loss_tolerance)
select sg.id,'MAIN',coalesce(rs.point_loss_tolerance,10)
from public.summary_groups sg
left join public.summary_group_risk_settings rs on rs.summary_group_id=sg.id
on conflict(summary_group_id,risk_pool) do nothing;

insert into public.summary_group_risk_pool_settings(summary_group_id,risk_pool,point_loss_tolerance)
select sg.id,p.pool,0
from public.summary_groups sg
cross join (values('H'),('L')) as p(pool)
on conflict(summary_group_id,risk_pool) do nothing;

alter table public.summary_group_risk_pool_settings enable row level security;
revoke all on public.summary_group_risk_pool_settings from anon,authenticated;

-- Preserve which independent risk pool authorized each distribution run/batch.
alter table public.settlement_distribution_runs
  add column if not exists risk_pool text not null default 'MAIN';
alter table public.settlement_distribution_runs drop constraint if exists settlement_distribution_runs_risk_pool_check;
alter table public.settlement_distribution_runs add constraint settlement_distribution_runs_risk_pool_check check(risk_pool in ('MAIN','H','L'));

alter table public.settlement_transfer_batches
  add column if not exists risk_pool text not null default 'MAIN';
alter table public.settlement_transfer_batches drop constraint if exists settlement_transfer_batches_risk_pool_check;
alter table public.settlement_transfer_batches add constraint settlement_transfer_batches_risk_pool_check check(risk_pool in ('MAIN','H','L'));

create index if not exists settlement_distribution_runs_pool_idx
  on public.settlement_distribution_runs(settlement_session_id,summary_group_id,risk_pool,confirmed_at desc);
create index if not exists settlement_transfer_batches_pool_idx
  on public.settlement_transfer_batches(settlement_session_id,summary_group_id,risk_pool,confirmed_at desc);

-- Point readiness now applies only to categories that actually received orders.
-- H requires exactly 3 actual codes and L exactly 2 when that category is used.
create or replace view public.session_actual_point_status as
with counts as (
  select
    p.settlement_session_id,
    p.category,
    p.max_special_codes,
    exists(
      select 1 from public.order_items oi
      where oi.settlement_session_id=p.settlement_session_id
        and oi.category=p.category
    ) as has_orders,
    count(a.code)::integer as selected_count
  from public.settlement_point_profiles p
  left join public.settlement_actual_special_point_codes a
    on a.settlement_session_id=p.settlement_session_id and a.category=p.category
  group by p.settlement_session_id,p.category,p.max_special_codes
)
select
  settlement_session_id,
  bool_and(case
    when not has_orders then true
    when category in ('A','B','E') then selected_count=1
    when category in ('G','H','L') then selected_count=max_special_codes
    when category='F' then selected_count between 0 and max_special_codes
    else false end) as actual_codes_ready,
  jsonb_object_agg(category,jsonb_build_object('selected',selected_count,'max',max_special_codes,'active',has_orders)) as category_counts
from counts
group by settlement_session_id;

-- Independent operational risk pools. H/L never inflate MAIN adjusted received or
-- MAIN Risk Budget. Confirmed cuts are also accounted for inside their own pool.
create or replace view public.session_risk_pool_state as
with groups as (
  select distinct cfg.settlement_session_id,s.business_date,cfg.summary_group_id
  from public.settlement_line_group_config cfg
  join public.settlement_sessions s on s.id=cfg.settlement_session_id
), pools as (
  select unnest(array['MAIN'::text,'H'::text,'L'::text]) as risk_pool
), cat as (
  select
    c.settlement_session_id,c.business_date,c.summary_group_id,d.risk_pool,
    sum(c.order_total)::bigint as gross_received,
    round(sum(c.adjusted_total),2)::numeric(18,2) as adjusted_received,
    round(sum(c.point_reserve),2)::numeric(18,2) as point_reserve_total,
    round(sum(c.actual_point),2)::numeric(18,2) as actual_point_total,
    bool_and(case when c.order_total>0 then c.special_multiplier>0 else true end) as multiplier_configured
  from public.session_category_risk_state c
  join public.category_definitions d on d.category=c.category and d.enabled=true
  group by c.settlement_session_id,c.business_date,c.summary_group_id,d.risk_pool
), cuts as (
  select settlement_session_id,summary_group_id,risk_pool,round(sum(cut_total),2)::numeric(18,2) as confirmed_cut_total
  from public.settlement_transfer_batches
  group by settlement_session_id,summary_group_id,risk_pool
), base as (
  select
    g.settlement_session_id,g.business_date,g.summary_group_id,p.risk_pool,
    coalesce(c.gross_received,0)::bigint as gross_received,
    coalesce(c.adjusted_received,0)::numeric(18,2) as adjusted_received,
    coalesce(c.point_reserve_total,0)::numeric(18,2) as point_reserve_total,
    coalesce(c.actual_point_total,0)::numeric(18,2) as actual_point_total,
    coalesce(c.multiplier_configured,true) as multiplier_configured,
    coalesce(st.actual_codes_ready,false) as actual_codes_ready,
    'RESERVE'::text as risk_mode,
    coalesce(c.point_reserve_total,0)::numeric(18,2) as risk_point_total,
    round(coalesce(c.adjusted_received,0)-coalesce(c.point_reserve_total,0),2)::numeric(18,2) as safety_margin,
    coalesce(x.confirmed_cut_total,0)::numeric(18,2) as confirmed_cut_total,
    coalesce(rs.point_loss_tolerance,case when p.risk_pool='MAIN' then 10 else 0 end)::numeric(18,2) as point_loss_tolerance,
    case when coalesce(c.adjusted_received,0)>0
      then round(coalesce(c.point_reserve_total,0)/c.adjusted_received*100,2)
      when coalesce(c.point_reserve_total,0)>0 then 100::numeric
      else 0::numeric end as risk_pct
  from groups g
  cross join pools p
  left join cat c
    on c.settlement_session_id=g.settlement_session_id
   and c.summary_group_id=g.summary_group_id
   and c.risk_pool=p.risk_pool
  left join cuts x
    on x.settlement_session_id=g.settlement_session_id
   and x.summary_group_id=g.summary_group_id
   and x.risk_pool=p.risk_pool
  left join public.session_actual_point_status st on st.settlement_session_id=g.settlement_session_id
  left join public.summary_group_risk_pool_settings rs
    on rs.summary_group_id=g.summary_group_id and rs.risk_pool=p.risk_pool
), final as (
  select b.*,
    round(b.adjusted_received+b.point_loss_tolerance,2)::numeric(18,2) as risk_budget,
    case when b.multiplier_configured
      then greatest(0,round(b.risk_point_total-(b.adjusted_received+b.point_loss_tolerance),2))::numeric(18,2)
      else 0::numeric(18,2) end as excess_point_risk
  from base b
)
select
  f.*,
  round(f.risk_budget-f.risk_point_total,2)::numeric(18,2) as risk_budget_margin
from final f;

-- Keep the legacy MAIN view contract unchanged for current dashboard/RPC callers.
create or replace view public.session_overall_risk_state as
select
  f.settlement_session_id,
  f.business_date,
  f.summary_group_id,
  f.gross_received,
  f.adjusted_received,
  f.point_reserve_total,
  f.actual_point_total,
  f.actual_codes_ready,
  f.risk_mode,
  f.risk_point_total,
  round(f.safety_margin,2) as net_safe_capacity,
  f.confirmed_cut_total,
  greatest(0,round(f.safety_margin,2))::numeric(18,2) as remaining_safe_capacity,
  greatest(0,round(-f.safety_margin,2))::numeric(18,2) as over_safe_amount,
  f.risk_pct,
  f.safety_margin,
  case when f.adjusted_received>0 then round(f.safety_margin/f.adjusted_received*100,2) else 0::numeric end as safety_margin_pct,
  null::smallint as risk_policy_band_id,
  'ใช้ Risk Budget'::text as risk_level_label,
  0::numeric(7,3) as recommended_cut_pct,
  0::numeric(18,2) as recommended_cut_total,
  0::numeric(18,2) as remaining_recommended_cut,
  0::numeric(18,2) as over_recommended_cut,
  f.point_loss_tolerance,
  f.risk_budget,
  f.risk_budget_margin,
  f.excess_point_risk
from public.session_risk_pool_state f
where f.risk_pool='MAIN';

revoke all on public.session_risk_pool_state from anon,authenticated;

-- Opening supports H/L Promotion codes as one-digit codes.
create or replace function public.open_settlement_session(
  p_business_date date,
  p_promotions jsonb default '[]'::jsonb,
  p_opened_by text default 'DASHBOARD'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_category text;
  v_code text;
  v_factor numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0));
  if exists(select 1 from public.settlement_sessions where status='OPEN') then raise exception 'SETTLEMENT_ALREADY_OPEN'; end if;
  if p_promotions is null or jsonb_typeof(p_promotions)<>'array' then raise exception 'INVALID_PROMOTIONS'; end if;

  insert into public.settlement_sessions(business_date,status,opened_by)
  values(p_business_date,'OPEN',p_opened_by) returning id into v_id;

  insert into public.settlement_line_group_config(settlement_session_id,line_group_id,line_group_name,summary_group_id,reduction_pct)
  select v_id,line_group_id,line_group_name,summary_group_id,reduction_pct from public.line_groups where enabled=true;

  insert into public.settlement_allocation_rules(settlement_session_id,summary_group_id,category,threshold,destination)
  select v_id,summary_group_id,category,threshold,destination from public.allocation_rules where enabled=true;

  insert into public.settlement_point_profiles(settlement_session_id,category,special_multiplier,max_special_codes)
  select v_id,category,special_multiplier,max_special_codes from public.point_category_profiles
  on conflict(settlement_session_id,category) do nothing;

  for v_item in select value from jsonb_array_elements(p_promotions)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    begin v_factor:=(v_item->>'point_factor_pct')::numeric;
    exception when others then raise exception 'INVALID_PROMOTION_FACTOR'; end;

    if v_category not in ('A','B','E','F','G','H','L') or coalesce(v_code,'')='' or v_factor<0 or v_factor>100 then
      raise exception 'INVALID_PROMOTION_RULE';
    end if;
    if (v_category in ('H','L') and v_code !~ '^\d$')
      or (v_category in ('A','B') and v_code !~ '^\d{2}$')
      or (v_category in ('E','F','G') and v_code !~ '^\d{3}$') then
      raise exception 'INVALID_PROMOTION_CODE';
    end if;

    insert into public.settlement_point_promotions(settlement_session_id,category,code,point_factor_pct)
    values(v_id,v_category,v_code,v_factor)
    on conflict(settlement_session_id,category,code) do update set point_factor_pct=excluded.point_factor_pct;
  end loop;
  return v_id;
end;
$$;

-- Actual Point codes on closed/open settlements support H/L code lengths and limits.
create or replace function public.replace_settlement_actual_special_codes(p_session_id uuid,p_codes jsonb)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_item jsonb;
  v_category text;
  v_code text;
  v_limit integer;
  v_count integer:=0;
begin
  select * into v_session from public.settlement_sessions where id=p_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status not in ('OPEN','CLOSED') then raise exception 'SETTLEMENT_NOT_EDITABLE'; end if;
  if p_codes is null or jsonb_typeof(p_codes)<>'array' then raise exception 'INVALID_POINT_CODES'; end if;

  delete from public.settlement_actual_special_point_codes where settlement_session_id=p_session_id;
  for v_item in select value from jsonb_array_elements(p_codes)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    select max_special_codes into v_limit from public.settlement_point_profiles
      where settlement_session_id=p_session_id and category=v_category;
    if v_limit is null or coalesce(v_code,'')='' then raise exception 'INVALID_POINT_CODE'; end if;
    if (v_category in ('H','L') and v_code !~ '^\d$')
      or (v_category in ('A','B') and v_code !~ '^\d{2}$')
      or (v_category in ('E','F','G') and v_code !~ '^\d{3}$') then
      raise exception 'INVALID_POINT_CODE';
    end if;
    if (select count(*) from public.settlement_actual_special_point_codes
        where settlement_session_id=p_session_id and category=v_category)>=v_limit then
      raise exception 'SPECIAL_POINT_LIMIT_%',v_category;
    end if;
    insert into public.settlement_actual_special_point_codes(settlement_session_id,category,code)
    values(p_session_id,v_category,v_code);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- H/L independent atomic distribution. MAIN continues to use the proven v6.7 RPC.
create or replace function public.confirm_separate_risk_distribution_run(
  p_request_id uuid,
  p_settlement_session_id uuid,
  p_summary_group_id text,
  p_risk_pool text,
  p_expected_risk_mode text,
  p_expected_adjusted_received numeric,
  p_expected_risk_point_total numeric,
  p_expected_safety_margin numeric,
  p_expected_risk_pct numeric,
  p_expected_point_loss_tolerance numeric,
  p_expected_risk_budget numeric,
  p_expected_excess_point_risk numeric,
  p_expected_confirmed_cut_total numeric,
  p_rounds jsonb,
  p_confirmed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.settlement_distribution_runs%rowtype;
  v_session public.settlement_sessions%rowtype;
  v_state record;
  v_before record;
  v_after record;
  v_code_state record;
  v_round jsonb;
  v_item jsonb;
  v_destination text;
  v_expected_limit bigint;
  v_current_limit bigint;
  v_round_total bigint;
  v_qty bigint;
  v_category text;
  v_code text;
  v_batch_id uuid;
  v_batch_number integer;
  v_run_id uuid;
  v_planned_quantity bigint:=0;
  v_confirmed_quantity bigint:=0;
  v_planned_rounds integer:=0;
  v_confirmed_rounds integer:=0;
  v_code_agg record;
  v_pool text;
begin
  v_pool:=upper(trim(p_risk_pool));
  if v_pool not in ('H','L') then raise exception 'INVALID_RISK_POOL'; end if;
  if p_request_id is null then raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED'; end if;
  if p_rounds is null or jsonb_typeof(p_rounds)<>'array' or jsonb_array_length(p_rounds)=0 then raise exception 'DISTRIBUTION_ROUNDS_REQUIRED'; end if;

  select * into v_session from public.settlement_sessions where id=p_settlement_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  -- Use the legacy settlement+group lock first so H/L confirmation cannot race
  -- incoming order items or live Point-multiplier sync. A second pool lock keeps
  -- H and L confirmations deterministic if pool-aware callers are added later.
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id),0));
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id,v_pool),0));

  select * into v_existing from public.settlement_distribution_runs where request_id=p_request_id;
  if found then
    return jsonb_build_object('idempotent',true,'run_id',v_existing.id,'planned_quantity',v_existing.planned_quantity,
      'confirmed_quantity',v_existing.confirmed_quantity,'planned_rounds',v_existing.planned_rounds,
      'confirmed_rounds',v_existing.confirmed_rounds,'projected_point_reserve',v_existing.projected_point_after,
      'projected_excess_point_risk',v_existing.projected_excess_after,'confirmed_at',v_existing.confirmed_at);
  end if;

  select * into v_state from public.session_risk_pool_state
  where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and risk_pool=v_pool;
  if not found then raise exception 'RISK_STATE_NOT_FOUND'; end if;
  if not v_state.multiplier_configured then raise exception 'POINT_MULTIPLIER_NOT_CONFIGURED'; end if;

  if v_state.risk_mode<>p_expected_risk_mode
    or round(v_state.adjusted_received,2)<>round(p_expected_adjusted_received,2)
    or round(v_state.risk_point_total,2)<>round(p_expected_risk_point_total,2)
    or round(v_state.safety_margin,2)<>round(p_expected_safety_margin,2)
    or round(v_state.risk_pct,2)<>round(p_expected_risk_pct,2)
    or round(v_state.point_loss_tolerance,2)<>round(p_expected_point_loss_tolerance,2)
    or round(v_state.risk_budget,2)<>round(p_expected_risk_budget,2)
    or round(v_state.excess_point_risk,2)<>round(p_expected_excess_point_risk,2)
    or round(v_state.confirmed_cut_total,2)<>round(p_expected_confirmed_cut_total,2)
  then raise exception 'RISK_STATE_STALE'; end if;
  if coalesce(v_state.excess_point_risk,0)<=0 then raise exception 'NO_RISK_DISTRIBUTION_REQUIRED'; end if;

  for v_code_agg in
    select upper(trim(i.value->>'category')) as category,trim(i.value->>'code') as code,
      sum((i.value->>'quantity')::bigint)::bigint as quantity,
      max((i.value->>'expected_retained_quantity')::bigint)::bigint as expected_retained,
      max((i.value->>'expected_effective_multiplier')::numeric) as expected_multiplier
    from jsonb_array_elements(p_rounds) r(value)
    cross join lateral jsonb_array_elements(r.value->'items') i(value)
    group by upper(trim(i.value->>'category')),trim(i.value->>'code')
  loop
    if v_code_agg.category<>v_pool or coalesce(v_code_agg.code,'')='' or v_code_agg.code !~ '^\d$' or v_code_agg.quantity<=0 then
      raise exception 'INVALID_TRANSFER_ITEM';
    end if;
    select * into v_code_state from public.session_code_risk_state
      where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id
        and category=v_code_agg.category and code=v_code_agg.code;
    if not found then raise exception 'TRANSFER_CODE_NOT_FOUND'; end if;
    if v_code_state.retained_quantity<>v_code_agg.expected_retained then raise exception 'RISK_STATE_STALE'; end if;
    if round(v_code_state.effective_multiplier,3)<>round(v_code_agg.expected_multiplier,3) then raise exception 'RISK_STATE_STALE'; end if;
    if v_code_agg.quantity>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
  end loop;

  v_planned_rounds:=jsonb_array_length(p_rounds);
  select coalesce(sum((i.value->>'quantity')::bigint),0)::bigint into v_planned_quantity
  from jsonb_array_elements(p_rounds) r(value)
  cross join lateral jsonb_array_elements(r.value->'items') i(value);
  if v_planned_quantity<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;

  insert into public.settlement_distribution_runs(
    request_id,settlement_session_id,business_date,summary_group_id,risk_pool,
    planned_quantity,planned_rounds,risk_point_before,risk_budget,excess_point_before,confirmed_by
  ) values(
    p_request_id,p_settlement_session_id,v_session.business_date,p_summary_group_id,v_pool,
    v_planned_quantity,v_planned_rounds,v_state.risk_point_total,v_state.risk_budget,v_state.excess_point_risk,p_confirmed_by
  ) returning id into v_run_id;

  for v_round in select value from jsonb_array_elements(p_rounds)
  loop
    select * into v_before from public.session_risk_pool_state
      where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and risk_pool=v_pool;
    if coalesce(v_before.excess_point_risk,0)<=0 then exit; end if;

    v_destination:=trim(v_round->>'destination');
    begin v_expected_limit:=(v_round->>'destination_limit')::bigint;
    exception when others then raise exception 'INVALID_WAREHOUSE_BATCH_LIMIT'; end;
    select max_batch_quantity into v_current_limit from public.warehouse_transfer_limits where destination=v_destination and enabled=true;
    if v_current_limit is null then raise exception 'DESTINATION_LIMIT_NOT_CONFIGURED'; end if;
    if v_current_limit<>v_expected_limit then raise exception 'RISK_STATE_STALE'; end if;

    select coalesce(sum((i.value->>'quantity')::bigint),0)::bigint into v_round_total
    from jsonb_array_elements(v_round->'items') i(value);
    if v_round_total<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;
    if v_round_total>v_current_limit then raise exception 'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT'; end if;

    select coalesce(max(batch_number),0)+1 into v_batch_number from public.settlement_transfer_batches
      where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id;

    insert into public.settlement_transfer_batches(
      request_id,settlement_session_id,business_date,summary_group_id,risk_pool,batch_number,destination,risk_mode,
      adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_before,cut_total,confirmed_by,
      point_loss_tolerance,risk_budget,excess_point_risk_before,warehouse_batch_limit,distribution_run_id
    ) values(
      gen_random_uuid(),p_settlement_session_id,v_session.business_date,p_summary_group_id,v_pool,v_batch_number,v_destination,v_before.risk_mode,
      v_before.adjusted_received,v_before.risk_point_total,v_before.safety_margin,v_before.confirmed_cut_total,v_round_total,p_confirmed_by,
      v_before.point_loss_tolerance,v_before.risk_budget,v_before.excess_point_risk,v_current_limit,v_run_id
    ) returning id into v_batch_id;

    for v_item in select value from jsonb_array_elements(v_round->'items')
    loop
      v_category:=upper(trim(v_item->>'category')); v_code:=trim(v_item->>'code');
      begin v_qty:=(v_item->>'quantity')::bigint; exception when others then raise exception 'INVALID_TRANSFER_QUANTITY'; end;
      if v_category<>v_pool or v_code !~ '^\d$' or v_qty<=0 then raise exception 'INVALID_TRANSFER_ITEM'; end if;
      select * into v_code_state from public.session_code_risk_state
        where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and category=v_category and code=v_code;
      if not found then raise exception 'TRANSFER_CODE_NOT_FOUND'; end if;
      if v_qty>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
      insert into public.settlement_transfer_batch_items(batch_id,category,code,quantity,retained_before,effective_multiplier,recommended_transfer_before)
      values(v_batch_id,v_category,v_code,v_qty,v_code_state.retained_quantity,v_code_state.effective_multiplier,v_qty);
    end loop;

    select * into v_after from public.session_risk_pool_state
      where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and risk_pool=v_pool;
    update public.settlement_transfer_batches
      set projected_point_reserve=v_after.risk_point_total,projected_excess_point_risk=v_after.excess_point_risk
      where id=v_batch_id;
    v_confirmed_quantity:=v_confirmed_quantity+v_round_total;
    v_confirmed_rounds:=v_confirmed_rounds+1;
  end loop;

  select * into v_after from public.session_risk_pool_state
    where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and risk_pool=v_pool;
  update public.settlement_distribution_runs set confirmed_quantity=v_confirmed_quantity,confirmed_rounds=v_confirmed_rounds,
    projected_point_after=v_after.risk_point_total,projected_excess_after=v_after.excess_point_risk where id=v_run_id;

  return jsonb_build_object('idempotent',false,'run_id',v_run_id,'risk_pool',v_pool,
    'planned_quantity',v_planned_quantity,'confirmed_quantity',v_confirmed_quantity,'planned_rounds',v_planned_rounds,
    'confirmed_rounds',v_confirmed_rounds,'projected_point_reserve',v_after.risk_point_total,
    'projected_excess_point_risk',v_after.excess_point_risk,'confirmed_at',now());
end;
$$;

revoke all on function public.open_settlement_session(date,jsonb,text) from public,anon,authenticated;
grant execute on function public.open_settlement_session(date,jsonb,text) to service_role;
revoke all on function public.replace_settlement_actual_special_codes(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_settlement_actual_special_codes(uuid,jsonb) to service_role;
revoke all on function public.confirm_separate_risk_distribution_run(uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.confirm_separate_risk_distribution_run(uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text) to service_role;
