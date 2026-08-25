-- Dashboard v6: risk reserve, category/overall safe capacity, point promotions,
-- final special-point codes, and atomic risk-based transfer batches.

create table if not exists public.point_category_profiles (
  category text primary key check (category in ('A','B','E','F','G')),
  special_multiplier numeric(12,3) not null check (special_multiplier > 0),
  max_special_codes integer not null check (max_special_codes > 0),
  updated_at timestamptz not null default now()
);

insert into public.point_category_profiles(category,special_multiplier,max_special_codes) values
  ('A',14,1),('B',14,1),('E',100,1),('F',20,6),('G',20,4)
on conflict(category) do nothing;

create table if not exists public.settlement_point_profiles (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  category text not null check (category in ('A','B','E','F','G')),
  special_multiplier numeric(12,3) not null check (special_multiplier > 0),
  max_special_codes integer not null check (max_special_codes > 0),
  primary key(settlement_session_id,category)
);

insert into public.settlement_point_profiles(settlement_session_id,category,special_multiplier,max_special_codes)
select s.id,p.category,p.special_multiplier,p.max_special_codes
from public.settlement_sessions s cross join public.point_category_profiles p
on conflict(settlement_session_id,category) do nothing;

create table if not exists public.settlement_point_promotions (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  point_factor_pct numeric(7,3) not null default 100 check (point_factor_pct >= 0 and point_factor_pct <= 100),
  created_at timestamptz not null default now(),
  primary key(settlement_session_id,category,code)
);

create table if not exists public.settlement_actual_special_point_codes (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  created_at timestamptz not null default now(),
  primary key(settlement_session_id,category,code)
);

-- Preserve any v5 special-code selections if that migration was already tested.
insert into public.settlement_actual_special_point_codes(settlement_session_id,category,code)
select settlement_session_id,category,code from public.settlement_special_point_rules
on conflict(settlement_session_id,category,code) do nothing;

create table if not exists public.settlement_transfer_batches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  business_date date not null,
  summary_group_id text not null references public.summary_groups(id),
  batch_number integer not null check (batch_number > 0),
  destination text not null,
  risk_mode text not null check (risk_mode in ('RESERVE','ACTUAL')),
  adjusted_received numeric(18,2) not null,
  risk_point_total numeric(18,2) not null,
  net_safe_capacity numeric(18,2) not null,
  confirmed_cut_before numeric(18,2) not null,
  cut_total numeric(18,2) not null check (cut_total > 0),
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  unique(settlement_session_id,summary_group_id,batch_number)
);

create table if not exists public.settlement_transfer_batch_items (
  batch_id uuid not null references public.settlement_transfer_batches(id) on delete cascade,
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  quantity bigint not null check (quantity > 0),
  primary key(batch_id,category,code)
);

create index if not exists settlement_transfer_batches_lookup_idx
  on public.settlement_transfer_batches(settlement_session_id,summary_group_id,confirmed_at desc);
create index if not exists settlement_transfer_items_code_idx
  on public.settlement_transfer_batch_items(category,code,batch_id);

-- Serialize settlement OPEN/CLOSE with message assignment. A message that races the
-- boundary is assigned to whichever settlement is OPEN when the database lock is held;
-- if none is OPEN, it remains unassigned and the webhook routes it to REVIEW.
create or replace function public.assign_message_to_open_settlement()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_session_id uuid;
  v_business_date date;
  v_summary_group_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0));
  select id,business_date into v_session_id,v_business_date
  from public.settlement_sessions where status='OPEN' limit 1;
  if v_session_id is null then
    new.settlement_session_id:=null;
    return new;
  end if;
  new.settlement_session_id:=v_session_id;
  new.business_date:=v_business_date;
  select summary_group_id into v_summary_group_id
  from public.settlement_line_group_config
  where settlement_session_id=v_session_id and line_group_id=new.line_group_id;
  new.summary_group_id:=v_summary_group_id;
  return new;
end;
$$;

drop trigger if exists messages_open_settlement_assignment_trg on public.messages;
create trigger messages_open_settlement_assignment_trg
before insert on public.messages
for each row execute function public.assign_message_to_open_settlement();

-- Serialize order-item writes and reduction changes with risk-based transfer confirmation.
-- The confirm RPC takes the same settlement+summary advisory lock before reading Safe Capacity,
-- so an order cannot arrive between the final risk check and the committed warehouse cut.
create or replace function public.lock_order_item_risk_state()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_session_id uuid;
  v_summary_group_id text;
begin
  if tg_op='DELETE' then
    v_session_id:=old.settlement_session_id;
    v_summary_group_id:=old.summary_group_id;
  else
    v_session_id:=new.settlement_session_id;
    v_summary_group_id:=new.summary_group_id;
  end if;
  if v_session_id is not null and coalesce(v_summary_group_id,'')<>'' then
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',v_session_id::text,v_summary_group_id),0));
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists order_items_risk_state_lock_trg on public.order_items;
create trigger order_items_risk_state_lock_trg
before insert or delete on public.order_items
for each row execute function public.lock_order_item_risk_state();

create or replace function public.lock_line_group_reduction_risk_state()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_status text;
begin
  if new.reduction_pct is distinct from old.reduction_pct
     or new.summary_group_id is distinct from old.summary_group_id then
    select status into v_status from public.settlement_sessions
      where id=new.settlement_session_id for update;
    if v_status is distinct from 'OPEN' then raise exception 'CLOSED_SETTLEMENT_IMMUTABLE'; end if;
    if old.settlement_session_id is not null and coalesce(old.summary_group_id,'')<>'' then
      perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',old.settlement_session_id::text,old.summary_group_id),0));
    end if;
    if (new.settlement_session_id is distinct from old.settlement_session_id
        or new.summary_group_id is distinct from old.summary_group_id)
       and new.settlement_session_id is not null and coalesce(new.summary_group_id,'')<>'' then
      perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',new.settlement_session_id::text,new.summary_group_id),0));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists settlement_line_group_reduction_risk_lock_trg on public.settlement_line_group_config;
create trigger settlement_line_group_reduction_risk_lock_trg
before update of reduction_pct,summary_group_id on public.settlement_line_group_config
for each row execute function public.lock_line_group_reduction_risk_state();

-- Current code state: raw quantity remains the source of truth for Point exposure.
-- Reduction is applied per LINE group before being aggregated into adjusted quantity.
create or replace view public.session_code_risk_state as
with code_base as (
  select
    oi.settlement_session_id,
    oi.business_date,
    oi.summary_group_id,
    oi.category,
    oi.code,
    sum(oi.quantity)::bigint as order_total,
    sum(oi.quantity::numeric * (1 - cfg.reduction_pct / 100.0)) as adjusted_total
  from public.order_items oi
  join public.settlement_line_group_config cfg
    on cfg.settlement_session_id=oi.settlement_session_id
   and cfg.line_group_id=oi.line_group_id
  where oi.settlement_session_id is not null
  group by oi.settlement_session_id,oi.business_date,oi.summary_group_id,oi.category,oi.code
), enriched as (
  select
    cb.*,
    pp.special_multiplier,
    pp.max_special_codes,
    coalesce(pm.point_factor_pct,100)::numeric(7,3) as promotion_factor_pct,
    round(pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,3) as effective_multiplier,
    round(cb.order_total::numeric * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as point_exposure,
    (sp.code is not null) as actual_special_point
  from code_base cb
  join public.settlement_point_profiles pp
    on pp.settlement_session_id=cb.settlement_session_id and pp.category=cb.category
  left join public.settlement_point_promotions pm
    on pm.settlement_session_id=cb.settlement_session_id and pm.category=cb.category and pm.code=cb.code
  left join public.settlement_actual_special_point_codes sp
    on sp.settlement_session_id=cb.settlement_session_id and sp.category=cb.category and sp.code=cb.code
), ranked as (
  select
    e.*,
    row_number() over(
      partition by e.settlement_session_id,e.summary_group_id,e.category
      order by e.point_exposure desc,e.order_total desc,e.code asc
    ) as reserve_rank
  from enriched e
), code_cuts as (
  select
    b.settlement_session_id,b.summary_group_id,i.category,i.code,
    sum(i.quantity)::bigint as confirmed_cut
  from public.settlement_transfer_batches b
  join public.settlement_transfer_batch_items i on i.batch_id=b.id
  group by b.settlement_session_id,b.summary_group_id,i.category,i.code
)
select
  r.*,
  (r.reserve_rank <= r.max_special_codes) as reserve_candidate,
  case when r.actual_special_point then r.point_exposure else 0::numeric end as actual_point,
  coalesce(cc.confirmed_cut,0)::bigint as confirmed_cut,
  greatest(0,r.order_total-coalesce(cc.confirmed_cut,0))::bigint as available_to_cut
from ranked r
left join code_cuts cc
  on cc.settlement_session_id=r.settlement_session_id
 and cc.summary_group_id=r.summary_group_id
 and cc.category=r.category
 and cc.code=r.code;

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
  round(sum(case when c.reserve_candidate then c.point_exposure else 0 end),2) as point_reserve,
  round(sum(c.actual_point),2) as actual_point,
  round(sum(c.adjusted_total)-sum(case when c.reserve_candidate then c.point_exposure else 0 end),2) as reserve_safe_capacity,
  case when sum(c.adjusted_total)>0
    then round(sum(case when c.reserve_candidate then c.point_exposure else 0 end)/sum(c.adjusted_total)*100,2)
    when sum(case when c.reserve_candidate then c.point_exposure else 0 end)>0 then 100::numeric
    else 0::numeric end as reserve_risk_pct
from public.session_code_risk_state c
left join actual_counts ac on ac.settlement_session_id=c.settlement_session_id and ac.category=c.category
group by c.settlement_session_id,c.business_date,c.summary_group_id,c.category;

create or replace view public.session_actual_point_status as
with counts as (
  select p.settlement_session_id,p.category,p.max_special_codes,
    count(a.code)::integer as selected_count
  from public.settlement_point_profiles p
  left join public.settlement_actual_special_point_codes a
    on a.settlement_session_id=p.settlement_session_id and a.category=p.category
  group by p.settlement_session_id,p.category,p.max_special_codes
)
select
  settlement_session_id,
  bool_and(case
    when category in ('A','B','E') then selected_count=1
    when category='G' then selected_count=4
    when category='F' then selected_count between 0 and max_special_codes
    else false end) as actual_codes_ready,
  jsonb_object_agg(category,jsonb_build_object('selected',selected_count,'max',max_special_codes)) as category_counts
from counts
group by settlement_session_id;

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
)
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
  round(coalesce(cat.adjusted_received,0) - coalesce(cat.point_reserve_total,0),2) as net_safe_capacity,
  coalesce(cuts.confirmed_cut_total,0)::numeric(18,2) as confirmed_cut_total,
  greatest(0,round(
    coalesce(cat.adjusted_received,0)
    - coalesce(cat.point_reserve_total,0)
    - coalesce(cuts.confirmed_cut_total,0),2
  ))::numeric(18,2) as remaining_safe_capacity,
  greatest(0,round(
    coalesce(cuts.confirmed_cut_total,0)
    - (coalesce(cat.adjusted_received,0) - coalesce(cat.point_reserve_total,0)),2
  ))::numeric(18,2) as over_safe_amount,
  case when coalesce(cat.adjusted_received,0)>0
    then round(coalesce(cat.point_reserve_total,0)/cat.adjusted_received*100,2)
    when coalesce(cat.point_reserve_total,0)>0 then 100::numeric
    else 0::numeric end as risk_pct
from groups g
left join cat on cat.settlement_session_id=g.settlement_session_id and cat.summary_group_id=g.summary_group_id
left join public.session_actual_point_status st on st.settlement_session_id=g.settlement_session_id
left join cuts on cuts.settlement_session_id=g.settlement_session_id and cuts.summary_group_id=g.summary_group_id;

-- Opening a new total set snapshots company Point multipliers. Promotions mean a
-- percentage of the category's special Point multiplier, e.g. 50% of E x100 = x50.
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

  -- Keep legacy threshold snapshots for historical compatibility only.
  insert into public.settlement_allocation_rules(settlement_session_id,summary_group_id,category,threshold,destination)
  select v_id,summary_group_id,category,threshold,destination from public.allocation_rules where enabled=true;

  insert into public.settlement_point_profiles(settlement_session_id,category,special_multiplier,max_special_codes)
  select v_id,category,special_multiplier,max_special_codes from public.point_category_profiles;

  for v_item in select value from jsonb_array_elements(p_promotions)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    begin v_factor:=(v_item->>'point_factor_pct')::numeric; exception when others then raise exception 'INVALID_PROMOTION_FACTOR'; end;
    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_factor<0 or v_factor>100 then raise exception 'INVALID_PROMOTION_RULE'; end if;
    if (v_category in ('A','B') and v_code !~ '^\d{2}$') or (v_category in ('E','F','G') and v_code !~ '^\d{3}$') then raise exception 'INVALID_PROMOTION_CODE'; end if;
    insert into public.settlement_point_promotions(settlement_session_id,category,code,point_factor_pct)
    values(v_id,v_category,v_code,v_factor)
    on conflict(settlement_session_id,category,code) do update set point_factor_pct=excluded.point_factor_pct;
  end loop;
  return v_id;
end;
$$;

create or replace function public.replace_settlement_actual_special_codes(
  p_session_id uuid,
  p_codes jsonb
)
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
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;
  if p_codes is null or jsonb_typeof(p_codes)<>'array' then raise exception 'INVALID_POINT_CODES'; end if;

  delete from public.settlement_actual_special_point_codes where settlement_session_id=p_session_id;
  for v_item in select value from jsonb_array_elements(p_codes)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    select max_special_codes into v_limit from public.settlement_point_profiles where settlement_session_id=p_session_id and category=v_category;
    if v_limit is null or coalesce(v_code,'')='' then raise exception 'INVALID_POINT_CODE'; end if;
    if (v_category in ('A','B') and v_code !~ '^\d{2}$') or (v_category in ('E','F','G') and v_code !~ '^\d{3}$') then raise exception 'INVALID_POINT_CODE'; end if;
    if (select count(*) from public.settlement_actual_special_point_codes where settlement_session_id=p_session_id and category=v_category) >= v_limit then
      raise exception 'SPECIAL_POINT_LIMIT_%',v_category;
    end if;
    insert into public.settlement_actual_special_point_codes(settlement_session_id,category,code)
    values(p_session_id,v_category,v_code);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.close_settlement_session(
  p_session_id uuid,
  p_closed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_ready boolean;
  v_counts jsonb;
  v_open_reviews integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0));
  select * into v_session from public.settlement_sessions where id=p_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;
  select count(*)::integer into v_open_reviews
  from public.review_items r
  join public.messages m on m.id=r.message_record_id
  where m.settlement_session_id=p_session_id and r.status='OPEN';
  if coalesce(v_open_reviews,0)>0 then raise exception 'SETTLEMENT_HAS_OPEN_REVIEW'; end if;
  select actual_codes_ready,category_counts into v_ready,v_counts from public.session_actual_point_status where settlement_session_id=p_session_id;
  if not coalesce(v_ready,false) then raise exception 'SPECIAL_POINT_CODES_INCOMPLETE'; end if;
  update public.settlement_sessions set status='CLOSED',closed_at=now(),closed_by=p_closed_by where id=p_session_id;
  return jsonb_build_object('id',p_session_id,'business_date',v_session.business_date,'status','CLOSED','closed_at',now(),'special_point_counts',v_counts);
end;
$$;

create or replace function public.confirm_risk_transfer_batch_safe(
  p_request_id uuid,
  p_settlement_session_id uuid,
  p_summary_group_id text,
  p_expected_risk_mode text,
  p_expected_adjusted_received numeric,
  p_expected_risk_point_total numeric,
  p_expected_net_safe_capacity numeric,
  p_expected_confirmed_cut_total numeric,
  p_expected_remaining_safe_capacity numeric,
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
  select * into v_session from public.settlement_sessions where id=p_settlement_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;
  if coalesce(trim(p_destination),'')='' then raise exception 'DESTINATION_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id),0));

  select * into v_existing from public.settlement_transfer_batches where request_id=p_request_id;
  if found then
    return jsonb_build_object('idempotent',true,'batch_id',v_existing.id,'batch_number',v_existing.batch_number,'cut_total',v_existing.cut_total,'confirmed_at',v_existing.confirmed_at);
  end if;

  select * into v_state from public.session_overall_risk_state
  where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id;
  if not found then raise exception 'RISK_STATE_NOT_FOUND'; end if;

  if v_state.risk_mode<>p_expected_risk_mode
    or round(v_state.adjusted_received,2)<>round(p_expected_adjusted_received,2)
    or round(v_state.risk_point_total,2)<>round(p_expected_risk_point_total,2)
    or round(v_state.net_safe_capacity,2)<>round(p_expected_net_safe_capacity,2)
    or round(v_state.confirmed_cut_total,2)<>round(p_expected_confirmed_cut_total,2)
    or round(v_state.remaining_safe_capacity,2)<>round(p_expected_remaining_safe_capacity,2)
  then raise exception 'RISK_STATE_STALE'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');
    begin v_qty:=(v_item->>'quantity')::bigint; exception when others then raise exception 'INVALID_TRANSFER_QUANTITY'; end;
    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_qty<=0 then raise exception 'INVALID_TRANSFER_ITEM'; end if;
    select * into v_code_state from public.session_code_risk_state
      where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id and category=v_category and code=v_code;
    if not found then raise exception 'TRANSFER_CODE_NOT_FOUND'; end if;
    if v_qty>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
    v_total:=v_total+v_qty;
  end loop;

  if v_total<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;
  if round(v_total,2)>round(v_state.remaining_safe_capacity,2) then raise exception 'TRANSFER_EXCEEDS_SAFE_CAPACITY'; end if;

  select coalesce(max(batch_number),0)+1 into v_batch_number from public.settlement_transfer_batches
    where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id;

  insert into public.settlement_transfer_batches(
    request_id,settlement_session_id,business_date,summary_group_id,batch_number,destination,risk_mode,
    adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_before,cut_total,confirmed_by
  ) values(
    p_request_id,p_settlement_session_id,v_session.business_date,p_summary_group_id,v_batch_number,trim(p_destination),v_state.risk_mode,
    v_state.adjusted_received,v_state.risk_point_total,v_state.net_safe_capacity,v_state.confirmed_cut_total,v_total,p_confirmed_by
  ) returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category')); v_code:=trim(v_item->>'code'); v_qty:=(v_item->>'quantity')::bigint;
    insert into public.settlement_transfer_batch_items(batch_id,category,code,quantity)
    values(v_batch_id,v_category,v_code,v_qty);
  end loop;

  return jsonb_build_object('idempotent',false,'batch_id',v_batch_id,'batch_number',v_batch_number,'cut_total',v_total,'destination',trim(p_destination),'confirmed_at',now());
end;
$$;

-- Settings audit accepts Point profile changes. Reduction still requires no reason field.
do $$
begin
  if exists(select 1 from pg_constraint where conname='settings_change_events_entity_type_check' and conrelid='public.settings_change_events'::regclass) then
    alter table public.settings_change_events drop constraint settings_change_events_entity_type_check;
  end if;
  alter table public.settings_change_events add constraint settings_change_events_entity_type_check
    check(entity_type in ('SUMMARY_GROUP','LINE_GROUP','ALLOCATION_RULE','CATEGORY_ALIAS','POINT_PROFILE'));
exception when duplicate_object then null;
end $$;

alter table public.point_category_profiles enable row level security;
alter table public.settlement_point_profiles enable row level security;
alter table public.settlement_point_promotions enable row level security;
alter table public.settlement_actual_special_point_codes enable row level security;
alter table public.settlement_transfer_batches enable row level security;
alter table public.settlement_transfer_batch_items enable row level security;

revoke all on public.point_category_profiles from anon,authenticated;
revoke all on public.settlement_point_profiles from anon,authenticated;
revoke all on public.settlement_point_promotions from anon,authenticated;
revoke all on public.settlement_actual_special_point_codes from anon,authenticated;
revoke all on public.settlement_transfer_batches from anon,authenticated;
revoke all on public.settlement_transfer_batch_items from anon,authenticated;
revoke all on public.session_code_risk_state from anon,authenticated;
revoke all on public.session_category_risk_state from anon,authenticated;
revoke all on public.session_actual_point_status from anon,authenticated;
revoke all on public.session_overall_risk_state from anon,authenticated;

revoke all on function public.open_settlement_session(date,jsonb,text) from public,anon,authenticated;
grant execute on function public.open_settlement_session(date,jsonb,text) to service_role;
revoke all on function public.replace_settlement_actual_special_codes(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_settlement_actual_special_codes(uuid,jsonb) to service_role;
revoke all on function public.close_settlement_session(uuid,text) from public,anon,authenticated;
grant execute on function public.close_settlement_session(uuid,text) to service_role;
revoke all on function public.confirm_risk_transfer_batch_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.confirm_risk_transfer_batch_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,text,jsonb,text) to service_role;
