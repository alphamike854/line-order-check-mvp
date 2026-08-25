-- Dashboard v6.6: dynamic warehouse-risk budget and bounded distribution batches.
-- Business rule:
--   Risk Budget = Adjusted Received + accepted Point loss tolerance.
--   Operational Point Reserve uses quantity still retained by our warehouse
--   (Received - confirmed transfer out), not raw Received.
--   If Reserve > Risk Budget, distribute only enough quantity to bring worst-case
--   retained exposure back within the accepted budget. Each destination has a
--   maximum quantity per transfer round; after every confirmation the risk state
--   is recalculated before another round can be confirmed.

create table if not exists public.summary_group_risk_settings (
  summary_group_id text primary key references public.summary_groups(id) on delete cascade,
  point_loss_tolerance numeric(18,2) not null default 10 check (point_loss_tolerance >= 0),
  updated_at timestamptz not null default now()
);

insert into public.summary_group_risk_settings(summary_group_id,point_loss_tolerance)
select id,10 from public.summary_groups
on conflict(summary_group_id) do nothing;

create table if not exists public.warehouse_transfer_limits (
  destination text primary key check (char_length(trim(destination)) between 1 and 150),
  max_batch_quantity bigint not null check (max_batch_quantity > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.summary_group_risk_settings enable row level security;
alter table public.warehouse_transfer_limits enable row level security;
revoke all on public.summary_group_risk_settings from anon,authenticated;
revoke all on public.warehouse_transfer_limits from anon,authenticated;

-- Preserve the operational snapshot used for each confirmed transfer round.
alter table public.settlement_transfer_batches
  add column if not exists point_loss_tolerance numeric(18,2),
  add column if not exists risk_budget numeric(18,2),
  add column if not exists excess_point_risk_before numeric(18,2),
  add column if not exists warehouse_batch_limit bigint,
  add column if not exists projected_point_reserve numeric(18,2),
  add column if not exists projected_excess_point_risk numeric(18,2);

alter table public.settlement_transfer_batch_items
  add column if not exists retained_before bigint,
  add column if not exists effective_multiplier numeric(12,3),
  add column if not exists recommended_transfer_before bigint;

-- Keep raw Point exposure for accounting/final Point reporting, but rank operational
-- reserve candidates by retained exposure after confirmed warehouse transfers.
create or replace view public.session_code_risk_state as
with code_base as (
  select
    oi.settlement_session_id,
    oi.business_date,
    cfg.summary_group_id,
    oi.category,
    oi.code,
    sum(oi.quantity)::bigint as order_total,
    sum(oi.quantity::numeric * (1 - cfg.reduction_pct / 100.0)) as adjusted_total
  from public.order_items oi
  join public.settlement_line_group_config cfg
    on cfg.settlement_session_id=oi.settlement_session_id
   and cfg.line_group_id=oi.line_group_id
  where oi.settlement_session_id is not null
  group by oi.settlement_session_id,oi.business_date,cfg.summary_group_id,oi.category,oi.code
), code_cuts as (
  select
    b.settlement_session_id,b.summary_group_id,i.category,i.code,
    sum(i.quantity)::bigint as confirmed_cut
  from public.settlement_transfer_batches b
  join public.settlement_transfer_batch_items i on i.batch_id=b.id
  group by b.settlement_session_id,b.summary_group_id,i.category,i.code
), enriched as (
  select
    cb.*,
    pp.special_multiplier,
    pp.max_special_codes,
    coalesce(pm.point_factor_pct,100)::numeric(7,3) as promotion_factor_pct,
    round(pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,3) as effective_multiplier,
    round(cb.order_total::numeric * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as point_exposure,
    (sp.code is not null) as actual_special_point,
    coalesce(cc.confirmed_cut,0)::bigint as confirmed_cut,
    greatest(0,cb.order_total-coalesce(cc.confirmed_cut,0))::bigint as retained_quantity,
    round(greatest(0,cb.order_total-coalesce(cc.confirmed_cut,0))::numeric
      * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as retained_point_exposure
  from code_base cb
  join public.settlement_point_profiles pp
    on pp.settlement_session_id=cb.settlement_session_id and pp.category=cb.category
  left join public.settlement_point_promotions pm
    on pm.settlement_session_id=cb.settlement_session_id and pm.category=cb.category and pm.code=cb.code
  left join public.settlement_actual_special_point_codes sp
    on sp.settlement_session_id=cb.settlement_session_id and sp.category=cb.category and sp.code=cb.code
  left join code_cuts cc
    on cc.settlement_session_id=cb.settlement_session_id
   and cc.summary_group_id=cb.summary_group_id
   and cc.category=cb.category
   and cc.code=cb.code
), ranked as (
  select
    e.*,
    row_number() over(
      partition by e.settlement_session_id,e.summary_group_id,e.category
      order by e.retained_point_exposure desc,e.retained_quantity desc,e.code asc
    ) as reserve_rank
  from enriched e
)
select
  r.settlement_session_id,
  r.business_date,
  r.summary_group_id,
  r.category,
  r.code,
  r.order_total,
  r.adjusted_total,
  r.special_multiplier,
  r.max_special_codes,
  r.promotion_factor_pct,
  r.effective_multiplier,
  r.point_exposure,
  r.actual_special_point,
  r.reserve_rank,
  (r.reserve_rank <= r.max_special_codes and r.retained_quantity > 0) as reserve_candidate,
  case when r.actual_special_point then r.point_exposure else 0::numeric end as actual_point,
  r.confirmed_cut,
  r.retained_quantity as available_to_cut,
  r.retained_quantity,
  r.retained_point_exposure
from ranked r;

create or replace view public.session_category_risk_state as
with actual_counts as (
  select settlement_session_id,category,count(*)::integer as actual_selected_count
  from public.settlement_actual_special_point_codes
  group by settlement_session_id,category
)
select
  c.settlement_session_id,
  c.business_date,
  c.summary_group_id,
  c.category,
  max(c.special_multiplier) as special_multiplier,
  max(c.max_special_codes) as max_special_codes,
  coalesce(max(ac.actual_selected_count),0)::integer as actual_selected_count,
  sum(c.order_total)::bigint as order_total,
  round(sum(c.adjusted_total),2) as adjusted_total,
  round(sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end),2) as point_reserve,
  round(sum(c.actual_point),2) as actual_point,
  round(sum(c.adjusted_total)-sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end),2) as reserve_safe_capacity,
  case when sum(c.adjusted_total)>0
    then round(sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end)/sum(c.adjusted_total)*100,2)
    when sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end)>0 then 100::numeric
    else 0::numeric end as reserve_risk_pct
from public.session_code_risk_state c
left join actual_counts ac on ac.settlement_session_id=c.settlement_session_id and ac.category=c.category
group by c.settlement_session_id,c.business_date,c.summary_group_id,c.category;

-- Preserve every existing v6/v6.5 column in the same order/type, then append the
-- v6.6 Risk Budget fields. The v6.5 Risk->Cut% columns remain only for migration
-- compatibility and are neutralized; they no longer authorize transfers.
create or replace view public.session_overall_risk_state as
with groups as (
  select distinct cfg.settlement_session_id,s.business_date,cfg.summary_group_id
  from public.settlement_line_group_config cfg
  join public.settlement_sessions s on s.id=cfg.settlement_session_id
), cat as (
  select settlement_session_id,business_date,summary_group_id,
    sum(order_total)::bigint as gross_received,
    round(sum(adjusted_total),2) as adjusted_received,
    round(sum(point_reserve),2) as point_reserve_total,
    round(sum(actual_point),2) as actual_point_total
  from public.session_category_risk_state
  group by settlement_session_id,business_date,summary_group_id
), cuts as (
  select settlement_session_id,summary_group_id,round(sum(cut_total),2) as confirmed_cut_total
  from public.settlement_transfer_batches
  group by settlement_session_id,summary_group_id
), base as (
  select
    g.settlement_session_id,
    g.business_date,
    g.summary_group_id,
    coalesce(cat.gross_received,0)::bigint as gross_received,
    coalesce(cat.adjusted_received,0)::numeric(18,2) as adjusted_received,
    coalesce(cat.point_reserve_total,0)::numeric(18,2) as point_reserve_total,
    coalesce(cat.actual_point_total,0)::numeric(18,2) as actual_point_total,
    coalesce(st.actual_codes_ready,false) as actual_codes_ready,
    'RESERVE'::text as risk_mode,
    coalesce(cat.point_reserve_total,0)::numeric(18,2) as risk_point_total,
    round(coalesce(cat.adjusted_received,0)-coalesce(cat.point_reserve_total,0),2)::numeric(18,2) as safety_margin,
    coalesce(cuts.confirmed_cut_total,0)::numeric(18,2) as confirmed_cut_total,
    coalesce(rs.point_loss_tolerance,10)::numeric(18,2) as point_loss_tolerance,
    case when coalesce(cat.adjusted_received,0)>0
      then round(coalesce(cat.point_reserve_total,0)/cat.adjusted_received*100,2)
      when coalesce(cat.point_reserve_total,0)>0 then 100::numeric
      else 0::numeric end as risk_pct
  from groups g
  left join cat
    on cat.settlement_session_id=g.settlement_session_id
   and cat.summary_group_id=g.summary_group_id
  left join public.session_actual_point_status st
    on st.settlement_session_id=g.settlement_session_id
  left join cuts
    on cuts.settlement_session_id=g.settlement_session_id
   and cuts.summary_group_id=g.summary_group_id
  left join public.summary_group_risk_settings rs
    on rs.summary_group_id=g.summary_group_id
), final as (
  select b.*,
    round(b.adjusted_received+b.point_loss_tolerance,2)::numeric(18,2) as risk_budget,
    greatest(0,round(b.risk_point_total-(b.adjusted_received+b.point_loss_tolerance),2))::numeric(18,2) as excess_point_risk
  from base b
)
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
  round(f.risk_budget-f.risk_point_total,2)::numeric(18,2) as risk_budget_margin,
  f.excess_point_risk
from final f;

-- Settings audit types for the new operational controls.
do $$
begin
  if exists(
    select 1 from pg_constraint
    where conname='settings_change_events_entity_type_check'
      and conrelid='public.settings_change_events'::regclass
  ) then
    alter table public.settings_change_events drop constraint settings_change_events_entity_type_check;
  end if;
  alter table public.settings_change_events
    add constraint settings_change_events_entity_type_check
    check(entity_type in (
      'SUMMARY_GROUP','LINE_GROUP','ALLOCATION_RULE','CATEGORY_ALIAS','POINT_PROFILE',
      'RISK_CUT_POLICY','RISK_BUDGET','WAREHOUSE_LIMIT'
    ));
exception when duplicate_object then null;
end $$;

create or replace function public.confirm_risk_transfer_batch_budget_safe(
  p_request_id uuid,
  p_settlement_session_id uuid,
  p_summary_group_id text,
  p_expected_risk_mode text,
  p_expected_adjusted_received numeric,
  p_expected_risk_point_total numeric,
  p_expected_safety_margin numeric,
  p_expected_risk_pct numeric,
  p_expected_point_loss_tolerance numeric,
  p_expected_risk_budget numeric,
  p_expected_excess_point_risk numeric,
  p_expected_confirmed_cut_total numeric,
  p_expected_destination_limit bigint,
  p_destination text,
  p_items jsonb,
  p_confirmed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.settlement_transfer_batches%rowtype;
  v_session public.settlement_sessions%rowtype;
  v_state record;
  v_after record;
  v_limit bigint;
  v_item jsonb;
  v_category text;
  v_code text;
  v_qty bigint;
  v_expected_retained bigint;
  v_expected_recommended bigint;
  v_expected_multiplier numeric;
  v_code_state record;
  v_total bigint:=0;
  v_batch_id uuid;
  v_batch_number integer;
begin
  if p_request_id is null then raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED'; end if;

  select * into v_session
  from public.settlement_sessions
  where id=p_settlement_session_id
  for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;
  if coalesce(trim(p_destination),'')='' then raise exception 'DESTINATION_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'TRANSFER_ITEMS_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id),0)
  );

  select * into v_existing
  from public.settlement_transfer_batches
  where request_id=p_request_id;
  if found then
    return jsonb_build_object(
      'idempotent',true,
      'batch_id',v_existing.id,
      'batch_number',v_existing.batch_number,
      'cut_total',v_existing.cut_total,
      'confirmed_at',v_existing.confirmed_at,
      'projected_point_reserve',v_existing.projected_point_reserve,
      'projected_excess_point_risk',v_existing.projected_excess_point_risk
    );
  end if;

  select max_batch_quantity into v_limit
  from public.warehouse_transfer_limits
  where destination=trim(p_destination) and enabled=true;
  if v_limit is null then raise exception 'DESTINATION_LIMIT_NOT_CONFIGURED'; end if;
  if v_limit<>p_expected_destination_limit then raise exception 'RISK_STATE_STALE'; end if;

  select * into v_state
  from public.session_overall_risk_state
  where settlement_session_id=p_settlement_session_id
    and summary_group_id=p_summary_group_id;
  if not found then raise exception 'RISK_STATE_NOT_FOUND'; end if;

  if v_state.risk_mode<>p_expected_risk_mode
    or round(v_state.adjusted_received,2)<>round(p_expected_adjusted_received,2)
    or round(v_state.risk_point_total,2)<>round(p_expected_risk_point_total,2)
    or round(v_state.safety_margin,2)<>round(p_expected_safety_margin,2)
    or round(v_state.risk_pct,2)<>round(p_expected_risk_pct,2)
    or round(v_state.point_loss_tolerance,2)<>round(p_expected_point_loss_tolerance,2)
    or round(v_state.risk_budget,2)<>round(p_expected_risk_budget,2)
    or round(v_state.excess_point_risk,2)<>round(p_expected_excess_point_risk,2)
    or round(v_state.confirmed_cut_total,2)<>round(p_expected_confirmed_cut_total,2)
  then
    raise exception 'RISK_STATE_STALE';
  end if;

  if coalesce(v_state.excess_point_risk,0)<=0 then raise exception 'NO_RISK_DISTRIBUTION_REQUIRED'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    begin v_qty:=(v_item->>'quantity')::bigint; exception when others then raise exception 'INVALID_TRANSFER_QUANTITY'; end;
    begin v_expected_retained:=(v_item->>'expected_retained_quantity')::bigint; exception when others then v_expected_retained:=null; end;
    begin v_expected_multiplier:=(v_item->>'expected_effective_multiplier')::numeric; exception when others then v_expected_multiplier:=null; end;
    begin v_expected_recommended:=(v_item->>'expected_recommended_transfer')::bigint; exception when others then v_expected_recommended:=null; end;

    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_qty<=0 then
      raise exception 'INVALID_TRANSFER_ITEM';
    end if;

    select * into v_code_state
    from public.session_code_risk_state
    where settlement_session_id=p_settlement_session_id
      and summary_group_id=p_summary_group_id
      and category=v_category
      and code=v_code;
    if not found then raise exception 'TRANSFER_CODE_NOT_FOUND'; end if;
    if not coalesce(v_code_state.reserve_candidate,false) then raise exception 'TRANSFER_CODE_NOT_CURRENT_RISK_CANDIDATE'; end if;
    if v_qty>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
    if v_expected_retained is null or v_code_state.retained_quantity<>v_expected_retained then raise exception 'RISK_STATE_STALE'; end if;
    if v_expected_multiplier is null or round(v_code_state.effective_multiplier,3)<>round(v_expected_multiplier,3) then raise exception 'RISK_STATE_STALE'; end if;
    if v_expected_recommended is null or v_expected_recommended<=0 or v_qty>v_expected_recommended then raise exception 'TRANSFER_EXCEEDS_CODE_RECOMMENDATION'; end if;

    v_total:=v_total+v_qty;
  end loop;

  if v_total<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;
  if v_total>v_limit then raise exception 'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT'; end if;

  select coalesce(max(batch_number),0)+1 into v_batch_number
  from public.settlement_transfer_batches
  where settlement_session_id=p_settlement_session_id
    and summary_group_id=p_summary_group_id;

  insert into public.settlement_transfer_batches(
    request_id,settlement_session_id,business_date,summary_group_id,batch_number,destination,risk_mode,
    adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_before,cut_total,confirmed_by,
    point_loss_tolerance,risk_budget,excess_point_risk_before,warehouse_batch_limit
  ) values(
    p_request_id,p_settlement_session_id,v_session.business_date,p_summary_group_id,v_batch_number,trim(p_destination),v_state.risk_mode,
    v_state.adjusted_received,v_state.risk_point_total,v_state.net_safe_capacity,v_state.confirmed_cut_total,v_total,p_confirmed_by,
    v_state.point_loss_tolerance,v_state.risk_budget,v_state.excess_point_risk,v_limit
  ) returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    v_qty:=(v_item->>'quantity')::bigint;
    v_expected_retained:=(v_item->>'expected_retained_quantity')::bigint;
    v_expected_multiplier:=(v_item->>'expected_effective_multiplier')::numeric;
    v_expected_recommended:=(v_item->>'expected_recommended_transfer')::bigint;
    insert into public.settlement_transfer_batch_items(
      batch_id,category,code,quantity,retained_before,effective_multiplier,recommended_transfer_before
    ) values(
      v_batch_id,v_category,v_code,v_qty,v_expected_retained,v_expected_multiplier,v_expected_recommended
    );
  end loop;

  select * into v_after
  from public.session_overall_risk_state
  where settlement_session_id=p_settlement_session_id
    and summary_group_id=p_summary_group_id;

  update public.settlement_transfer_batches
  set projected_point_reserve=v_after.risk_point_total,
      projected_excess_point_risk=v_after.excess_point_risk
  where id=v_batch_id;

  return jsonb_build_object(
    'idempotent',false,
    'batch_id',v_batch_id,
    'batch_number',v_batch_number,
    'cut_total',v_total,
    'destination',trim(p_destination),
    'warehouse_batch_limit',v_limit,
    'projected_point_reserve',v_after.risk_point_total,
    'projected_excess_point_risk',v_after.excess_point_risk,
    'confirmed_at',now()
  );
end;
$$;

revoke all on public.session_code_risk_state from anon,authenticated;
revoke all on public.session_category_risk_state from anon,authenticated;
revoke all on public.session_overall_risk_state from anon,authenticated;
revoke all on function public.confirm_risk_transfer_batch_budget_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.confirm_risk_transfer_batch_budget_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,bigint,text,jsonb,text) to service_role;
