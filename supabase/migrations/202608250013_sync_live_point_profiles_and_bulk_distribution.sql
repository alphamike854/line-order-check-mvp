-- Dashboard v6.7
-- 1) Company Point multiplier edits apply immediately to the current OPEN settlement,
--    while CLOSED settlements keep their historical snapshot.
-- 2) One user confirmation can commit many bounded warehouse rounds atomically.

create or replace function public.sync_open_settlement_point_profile_from_company()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_session_id uuid;
  v_group_id text;
begin
  select id into v_session_id
  from public.settlement_sessions
  where status='OPEN'
  order by opened_at desc
  limit 1;

  if v_session_id is not null then
    -- Serialize multiplier changes with order-item writes and transfer confirmation
    -- for every Summary Group in the OPEN settlement.
    for v_group_id in
      select distinct summary_group_id
      from public.settlement_line_group_config
      where settlement_session_id=v_session_id
        and coalesce(summary_group_id,'')<>''
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(concat_ws('|',v_session_id::text,v_group_id),0)
      );
    end loop;

    insert into public.settlement_point_profiles(
      settlement_session_id,category,special_multiplier,max_special_codes
    ) values(
      v_session_id,new.category,new.special_multiplier,new.max_special_codes
    )
    on conflict(settlement_session_id,category) do update set
      special_multiplier=excluded.special_multiplier,
      max_special_codes=excluded.max_special_codes;
  end if;

  return new;
end;
$$;

drop trigger if exists point_category_profiles_sync_open_settlement_trg on public.point_category_profiles;
create trigger point_category_profiles_sync_open_settlement_trg
after insert or update on public.point_category_profiles
for each row execute function public.sync_open_settlement_point_profile_from_company();

-- Repair the current OPEN settlement immediately (for example, if A was already
-- changed from x14 to x7 before this migration was applied).
insert into public.settlement_point_profiles(
  settlement_session_id,category,special_multiplier,max_special_codes
)
select s.id,p.category,p.special_multiplier,p.max_special_codes
from public.settlement_sessions s
cross join public.point_category_profiles p
where s.status='OPEN'
on conflict(settlement_session_id,category) do update set
  special_multiplier=excluded.special_multiplier,
  max_special_codes=excluded.max_special_codes;

create table if not exists public.settlement_distribution_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  business_date date not null,
  summary_group_id text not null references public.summary_groups(id),
  planned_quantity bigint not null check(planned_quantity > 0),
  confirmed_quantity bigint not null default 0 check(confirmed_quantity >= 0),
  planned_rounds integer not null check(planned_rounds > 0),
  confirmed_rounds integer not null default 0 check(confirmed_rounds >= 0),
  risk_point_before numeric(18,2) not null,
  risk_budget numeric(18,2) not null,
  excess_point_before numeric(18,2) not null,
  projected_point_after numeric(18,2),
  projected_excess_after numeric(18,2),
  confirmed_by text,
  confirmed_at timestamptz not null default now()
);

alter table public.settlement_transfer_batches
  add column if not exists distribution_run_id uuid references public.settlement_distribution_runs(id) on delete set null;

create index if not exists settlement_distribution_runs_lookup_idx
  on public.settlement_distribution_runs(settlement_session_id,summary_group_id,confirmed_at desc);
create index if not exists settlement_transfer_batches_run_idx
  on public.settlement_transfer_batches(distribution_run_id,batch_number);

create or replace function public.confirm_risk_distribution_run_budget_safe(
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
  v_expected_retained bigint;
  v_expected_multiplier numeric;
  v_batch_id uuid;
  v_batch_number integer;
  v_run_id uuid;
  v_planned_quantity bigint:=0;
  v_confirmed_quantity bigint:=0;
  v_planned_rounds integer:=0;
  v_confirmed_rounds integer:=0;
  v_code_agg record;
begin
  if p_request_id is null then raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED'; end if;
  if p_rounds is null or jsonb_typeof(p_rounds)<>'array' or jsonb_array_length(p_rounds)=0 then
    raise exception 'DISTRIBUTION_ROUNDS_REQUIRED';
  end if;

  select * into v_session
  from public.settlement_sessions
  where id=p_settlement_session_id
  for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id),0)
  );

  select * into v_existing
  from public.settlement_distribution_runs
  where request_id=p_request_id;
  if found then
    return jsonb_build_object(
      'idempotent',true,
      'run_id',v_existing.id,
      'planned_quantity',v_existing.planned_quantity,
      'confirmed_quantity',v_existing.confirmed_quantity,
      'planned_rounds',v_existing.planned_rounds,
      'confirmed_rounds',v_existing.confirmed_rounds,
      'projected_point_reserve',v_existing.projected_point_after,
      'projected_excess_point_risk',v_existing.projected_excess_after,
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
    or round(v_state.point_loss_tolerance,2)<>round(p_expected_point_loss_tolerance,2)
    or round(v_state.risk_budget,2)<>round(p_expected_risk_budget,2)
    or round(v_state.excess_point_risk,2)<>round(p_expected_excess_point_risk,2)
    or round(v_state.confirmed_cut_total,2)<>round(p_expected_confirmed_cut_total,2)
  then
    raise exception 'RISK_STATE_STALE';
  end if;

  if coalesce(v_state.excess_point_risk,0)<=0 then
    raise exception 'NO_RISK_DISTRIBUTION_REQUIRED';
  end if;

  -- Validate every approved code against the exact retained quantity and multiplier
  -- from the signed server plan, then ensure the whole approved amount is available.
  for v_code_agg in
    select
      upper(trim(i.value->>'category')) as category,
      trim(i.value->>'code') as code,
      sum((i.value->>'quantity')::bigint)::bigint as quantity,
      max((i.value->>'expected_retained_quantity')::bigint)::bigint as expected_retained,
      max((i.value->>'expected_effective_multiplier')::numeric) as expected_multiplier
    from jsonb_array_elements(p_rounds) r(value)
    cross join lateral jsonb_array_elements(r.value->'items') i(value)
    group by upper(trim(i.value->>'category')),trim(i.value->>'code')
  loop
    if v_code_agg.category not in ('A','B','E','F','G')
      or coalesce(v_code_agg.code,'')=''
      or v_code_agg.quantity<=0
    then raise exception 'INVALID_TRANSFER_ITEM'; end if;

    select * into v_code_state
    from public.session_code_risk_state
    where settlement_session_id=p_settlement_session_id
      and summary_group_id=p_summary_group_id
      and category=v_code_agg.category
      and code=v_code_agg.code;
    if not found then raise exception 'TRANSFER_CODE_NOT_FOUND'; end if;
    if v_code_state.retained_quantity<>v_code_agg.expected_retained then raise exception 'RISK_STATE_STALE'; end if;
    if round(v_code_state.effective_multiplier,3)<>round(v_code_agg.expected_multiplier,3) then raise exception 'RISK_STATE_STALE'; end if;
    if v_code_agg.quantity>v_code_state.available_to_cut then raise exception 'TRANSFER_EXCEEDS_CODE_AVAILABLE'; end if;
  end loop;

  v_planned_rounds:=jsonb_array_length(p_rounds);
  select coalesce(sum((i.value->>'quantity')::bigint),0)::bigint
  into v_planned_quantity
  from jsonb_array_elements(p_rounds) r(value)
  cross join lateral jsonb_array_elements(r.value->'items') i(value);

  if v_planned_quantity<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;

  insert into public.settlement_distribution_runs(
    request_id,settlement_session_id,business_date,summary_group_id,
    planned_quantity,planned_rounds,risk_point_before,risk_budget,excess_point_before,confirmed_by
  ) values(
    p_request_id,p_settlement_session_id,v_session.business_date,p_summary_group_id,
    v_planned_quantity,v_planned_rounds,v_state.risk_point_total,v_state.risk_budget,v_state.excess_point_risk,p_confirmed_by
  ) returning id into v_run_id;

  for v_round in select value from jsonb_array_elements(p_rounds)
  loop
    -- If the already-approved atomic plan reaches the Risk Budget early due to
    -- rounding, stop instead of sending unnecessary extra quantity.
    select * into v_before
    from public.session_overall_risk_state
    where settlement_session_id=p_settlement_session_id
      and summary_group_id=p_summary_group_id;
    if coalesce(v_before.excess_point_risk,0)<=0 then exit; end if;

    v_destination:=trim(v_round->>'destination');
    begin v_expected_limit:=(v_round->>'destination_limit')::bigint;
    exception when others then raise exception 'INVALID_WAREHOUSE_BATCH_LIMIT'; end;
    if coalesce(v_destination,'')='' or v_expected_limit<=0 then raise exception 'INVALID_WAREHOUSE_BATCH_LIMIT'; end if;

    select max_batch_quantity into v_current_limit
    from public.warehouse_transfer_limits
    where destination=v_destination and enabled=true;
    if v_current_limit is null then raise exception 'DESTINATION_LIMIT_NOT_CONFIGURED'; end if;
    if v_current_limit<>v_expected_limit then raise exception 'RISK_STATE_STALE'; end if;

    select coalesce(sum((i.value->>'quantity')::bigint),0)::bigint
    into v_round_total
    from jsonb_array_elements(v_round->'items') i(value);
    if v_round_total<=0 then raise exception 'TRANSFER_ITEMS_REQUIRED'; end if;
    if v_round_total>v_current_limit then raise exception 'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT'; end if;

    select coalesce(max(batch_number),0)+1 into v_batch_number
    from public.settlement_transfer_batches
    where settlement_session_id=p_settlement_session_id
      and summary_group_id=p_summary_group_id;

    insert into public.settlement_transfer_batches(
      request_id,settlement_session_id,business_date,summary_group_id,batch_number,destination,risk_mode,
      adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_before,cut_total,confirmed_by,
      point_loss_tolerance,risk_budget,excess_point_risk_before,warehouse_batch_limit,distribution_run_id
    ) values(
      gen_random_uuid(),p_settlement_session_id,v_session.business_date,p_summary_group_id,v_batch_number,v_destination,v_before.risk_mode,
      v_before.adjusted_received,v_before.risk_point_total,v_before.net_safe_capacity,v_before.confirmed_cut_total,v_round_total,p_confirmed_by,
      v_before.point_loss_tolerance,v_before.risk_budget,v_before.excess_point_risk,v_current_limit,v_run_id
    ) returning id into v_batch_id;

    for v_item in select value from jsonb_array_elements(v_round->'items')
    loop
      v_category:=upper(trim(v_item->>'category'));
      v_code:=trim(v_item->>'code');
      begin v_qty:=(v_item->>'quantity')::bigint;
      exception when others then raise exception 'INVALID_TRANSFER_QUANTITY'; end;
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

      insert into public.settlement_transfer_batch_items(
        batch_id,category,code,quantity,retained_before,effective_multiplier,recommended_transfer_before
      ) values(
        v_batch_id,v_category,v_code,v_qty,v_code_state.retained_quantity,v_code_state.effective_multiplier,v_qty
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

    v_confirmed_quantity:=v_confirmed_quantity+v_round_total;
    v_confirmed_rounds:=v_confirmed_rounds+1;
  end loop;

  select * into v_after
  from public.session_overall_risk_state
  where settlement_session_id=p_settlement_session_id
    and summary_group_id=p_summary_group_id;

  update public.settlement_distribution_runs
  set confirmed_quantity=v_confirmed_quantity,
      confirmed_rounds=v_confirmed_rounds,
      projected_point_after=v_after.risk_point_total,
      projected_excess_after=v_after.excess_point_risk
  where id=v_run_id;

  return jsonb_build_object(
    'idempotent',false,
    'run_id',v_run_id,
    'planned_quantity',v_planned_quantity,
    'confirmed_quantity',v_confirmed_quantity,
    'planned_rounds',v_planned_rounds,
    'confirmed_rounds',v_confirmed_rounds,
    'projected_point_reserve',v_after.risk_point_total,
    'projected_excess_point_risk',v_after.excess_point_risk,
    'confirmed_at',now()
  );
end;
$$;

alter table public.settlement_distribution_runs enable row level security;
revoke all on public.settlement_distribution_runs from anon,authenticated;
revoke all on function public.confirm_risk_distribution_run_budget_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.confirm_risk_distribution_run_budget_safe(uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text) to service_role;
