-- Dashboard v6.5: Safety Margin is a diagnostic buffer, not a warehouse-cut cap.
-- Warehouse cut target is derived from overall Risk % -> configurable cut policy %
-- -> recommended cut amount from adjusted received.

create table if not exists public.risk_cut_policy_bands (
  id smallint primary key check (id between 1 and 20),
  label text not null check (char_length(trim(label)) between 1 and 80),
  min_risk_pct numeric(9,3) not null unique check (min_risk_pct >= 0),
  cut_pct numeric(7,3) not null check (cut_pct >= 0 and cut_pct <= 100),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Editable company defaults. The active band is the enabled row with the highest
-- min_risk_pct <= current Risk %. These are seed values, not hard-coded formulas.
insert into public.risk_cut_policy_bands(id,label,min_risk_pct,cut_pct,enabled) values
  (1,'ปลอดภัย',0,0,true),
  (2,'เฝ้าระวัง',30,10,true),
  (3,'เสี่ยง',50,25,true),
  (4,'เสี่ยงสูง',70,50,true),
  (5,'สูงมาก',85,75,true),
  (6,'จุดคุ้มทุน/เกิน',100,100,true)
on conflict (id) do nothing;

create index if not exists risk_cut_policy_active_idx
  on public.risk_cut_policy_bands(enabled,min_risk_pct desc);

alter table public.risk_cut_policy_bands enable row level security;
revoke all on public.risk_cut_policy_bands from anon,authenticated;

-- Snapshot the policy used by each confirmed transfer batch for audit/history.
alter table public.settlement_transfer_batches
  add column if not exists safety_margin numeric(18,2),
  add column if not exists risk_pct numeric(12,3),
  add column if not exists risk_policy_band_id smallint,
  add column if not exists risk_level_label text,
  add column if not exists recommended_cut_pct numeric(7,3),
  add column if not exists recommended_cut_total numeric(18,2),
  add column if not exists recommended_cut_remaining_before numeric(18,2);

-- Allow Settings audit to record risk-cut policy changes.
do $$
begin
  if exists(
    select 1 from pg_constraint
    where conname='settings_change_events_entity_type_check'
      and conrelid='public.settings_change_events'::regclass
  ) then
    alter table public.settings_change_events
      drop constraint settings_change_events_entity_type_check;
  end if;
  alter table public.settings_change_events
    add constraint settings_change_events_entity_type_check
    check(entity_type in (
      'SUMMARY_GROUP','LINE_GROUP','ALLOCATION_RULE','CATEGORY_ALIAS','POINT_PROFILE','RISK_CUT_POLICY'
    ));
exception when duplicate_object then null;
end $$;

-- Preserve the v6 public columns for compatibility, then append the v6.5 policy fields.
-- net_safe_capacity remains a legacy alias of Safety Margin.
-- remaining_safe_capacity/over_safe_amount remain legacy fields and are NOT used to
-- authorize v6.5 transfers.
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
), resolved as (
  select b.*,p.id as risk_policy_band_id,p.label as risk_level_label,
    coalesce(p.cut_pct,0)::numeric(7,3) as recommended_cut_pct
  from base b
  left join lateral (
    select rp.id,rp.label,rp.cut_pct
    from public.risk_cut_policy_bands rp
    where rp.enabled=true and rp.min_risk_pct<=b.risk_pct
    order by rp.min_risk_pct desc,rp.id desc
    limit 1
  ) p on true
), final as (
  select r.*,
    floor(r.adjusted_received * r.recommended_cut_pct / 100.0)::numeric(18,2) as recommended_cut_total
  from resolved r
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
  greatest(0,round(f.safety_margin-f.confirmed_cut_total,2))::numeric(18,2) as remaining_safe_capacity,
  greatest(0,round(f.confirmed_cut_total-f.safety_margin,2))::numeric(18,2) as over_safe_amount,
  f.risk_pct,
  f.safety_margin,
  case when f.adjusted_received>0 then round(f.safety_margin/f.adjusted_received*100,2) else 0::numeric end as safety_margin_pct,
  f.risk_policy_band_id,
  coalesce(f.risk_level_label,'ไม่มีนโยบาย')::text as risk_level_label,
  f.recommended_cut_pct,
  f.recommended_cut_total,
  greatest(0,round(f.recommended_cut_total-f.confirmed_cut_total,2))::numeric(18,2) as remaining_recommended_cut,
  greatest(0,round(f.confirmed_cut_total-f.recommended_cut_total,2))::numeric(18,2) as over_recommended_cut
from final f;

-- New v6.5 confirmation RPC. It validates the current Risk policy target under the same
-- settlement+summary advisory lock used by order-item writes, so a stale preview cannot confirm.
create or replace function public.confirm_risk_transfer_batch_policy_safe(
  p_request_id uuid,
  p_settlement_session_id uuid,
  p_summary_group_id text,
  p_expected_risk_mode text,
  p_expected_adjusted_received numeric,
  p_expected_risk_point_total numeric,
  p_expected_safety_margin numeric,
  p_expected_risk_pct numeric,
  p_expected_risk_policy_band_id smallint,
  p_expected_recommended_cut_pct numeric,
  p_expected_recommended_cut_total numeric,
  p_expected_confirmed_cut_total numeric,
  p_expected_remaining_recommended_cut numeric,
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
  v_item jsonb;
  v_category text;
  v_code text;
  v_qty bigint;
  v_code_state record;
  v_total numeric:=0;
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
      'confirmed_at',v_existing.confirmed_at
    );
  end if;

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
    or v_state.risk_policy_band_id is distinct from p_expected_risk_policy_band_id
    or round(v_state.recommended_cut_pct,3)<>round(p_expected_recommended_cut_pct,3)
    or round(v_state.recommended_cut_total,2)<>round(p_expected_recommended_cut_total,2)
    or round(v_state.confirmed_cut_total,2)<>round(p_expected_confirmed_cut_total,2)
    or round(v_state.remaining_recommended_cut,2)<>round(p_expected_remaining_recommended_cut,2)
  then
    raise exception 'RISK_STATE_STALE';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    begin
      v_qty:=(v_item->>'quantity')::bigint;
    exception when others then
      raise exception 'INVALID_TRANSFER_QUANTITY';
    end;

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
    if v_qty>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
    v_total:=v_total+v_qty;
  end loop;

  if v_total<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;
  if round(v_total,2)>round(v_state.remaining_recommended_cut,2) then
    raise exception 'TRANSFER_EXCEEDS_RECOMMENDED_CUT';
  end if;

  select coalesce(max(batch_number),0)+1 into v_batch_number
  from public.settlement_transfer_batches
  where settlement_session_id=p_settlement_session_id
    and summary_group_id=p_summary_group_id;

  insert into public.settlement_transfer_batches(
    request_id,settlement_session_id,business_date,summary_group_id,batch_number,destination,risk_mode,
    adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_before,cut_total,confirmed_by,
    safety_margin,risk_pct,risk_policy_band_id,risk_level_label,recommended_cut_pct,recommended_cut_total,
    recommended_cut_remaining_before
  ) values(
    p_request_id,p_settlement_session_id,v_session.business_date,p_summary_group_id,v_batch_number,
    trim(p_destination),v_state.risk_mode,v_state.adjusted_received,v_state.risk_point_total,
    v_state.safety_margin,v_state.confirmed_cut_total,v_total,p_confirmed_by,
    v_state.safety_margin,v_state.risk_pct,v_state.risk_policy_band_id,v_state.risk_level_label,
    v_state.recommended_cut_pct,v_state.recommended_cut_total,v_state.remaining_recommended_cut
  ) returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    v_qty:=(v_item->>'quantity')::bigint;
    insert into public.settlement_transfer_batch_items(batch_id,category,code,quantity)
    values(v_batch_id,v_category,v_code,v_qty);
  end loop;

  return jsonb_build_object(
    'idempotent',false,
    'batch_id',v_batch_id,
    'batch_number',v_batch_number,
    'cut_total',v_total,
    'destination',trim(p_destination),
    'recommended_cut_total',v_state.recommended_cut_total,
    'remaining_recommended_cut',greatest(0,v_state.remaining_recommended_cut-v_total),
    'confirmed_at',now()
  );
end;
$$;

revoke all on function public.confirm_risk_transfer_batch_policy_safe(
  uuid,uuid,text,text,numeric,numeric,numeric,numeric,smallint,numeric,numeric,numeric,numeric,text,jsonb,text
) from public,anon,authenticated;
grant execute on function public.confirm_risk_transfer_batch_policy_safe(
  uuid,uuid,text,text,numeric,numeric,numeric,numeric,smallint,numeric,numeric,numeric,numeric,text,jsonb,text
) to service_role;
