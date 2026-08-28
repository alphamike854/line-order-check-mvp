-- v8.9.4 Phase 2C
-- Atomic CATEGORY_RETENTION confirmation scoped to one LINE Group.
--
-- Legacy Summary Group confirmation RPCs remain unchanged.
--
-- Identity:
--   settlement_session_id
--   + line_group_id
--   + category
--   + code
--
-- Safety:
--   - serialize with settlement OPEN/CLOSE + live remap
--   - preserve legacy settlement + Summary Group advisory lock
--   - add LINE Group advisory lock
--   - request_id idempotency with ownership collision protection
--   - lock settlement LINE Group snapshot
--   - verify signed band/budget/group state
--   - verify exact retained quantity, multiplier and retention limit
--   - selected code quantity must equal its current recommendation
--   - warehouse limits rechecked inside transaction
--   - all writes carry line_group_id
--   - post-confirm selected codes must have recommended_cut = 0

alter table public.settlement_distribution_runs
  add column if not exists gross_received bigint,
  add column if not exists calculation_band bigint,
  add column if not exists reduction_pct numeric(7,3),
  add column if not exists retained_total_before bigint,
  add column if not exists retained_total_after bigint,
  add column if not exists recommended_cut_before bigint,
  add column if not exists recommended_cut_after bigint;

alter table public.settlement_distribution_runs
  drop constraint if exists settlement_distribution_runs_line_group_snapshot_check;

alter table public.settlement_distribution_runs
  add constraint settlement_distribution_runs_line_group_snapshot_check
  check (
    (
      risk_model is null
      and line_group_id is null
    )
    or
    (
      risk_model = 'CATEGORY_RETENTION'
      and line_group_id is not null
      and gross_received is not null
      and gross_received >= 0
      and calculation_band is not null
      and calculation_band > 0
      and reduction_pct is not null
      and reduction_pct between 0 and 100
      and retained_total_before is not null
      and retained_total_before >= 0
      and recommended_cut_before is not null
      and recommended_cut_before >= 0
    )
  );


create or replace function public.confirm_line_group_distribution_run(
  p_request_id uuid,
  p_settlement_session_id uuid,
  p_line_group_id text,
  p_summary_group_id text,
  p_risk_pool text,
  p_expected_gross_received bigint,
  p_expected_calculation_band bigint,
  p_expected_reduction_pct numeric,
  p_expected_risk_budget numeric,
  p_rounds jsonb,
  p_confirmed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_cfg public.settlement_line_group_config%rowtype;
  v_existing public.settlement_distribution_runs%rowtype;

  v_state record;
  v_before record;
  v_after record;
  v_code_state record;
  v_code_agg record;

  v_round jsonb;
  v_item jsonb;

  v_pool text;
  v_line_group_id text;
  v_summary_group_id text;

  v_destination text;
  v_expected_limit bigint;
  v_current_limit bigint;
  v_round_total bigint;

  v_category text;
  v_code text;
  v_qty bigint;

  v_batch_number integer;
  v_batch_id uuid;
  v_run_id uuid;

  v_planned_quantity bigint := 0;
  v_confirmed_quantity bigint := 0;
  v_planned_rounds integer := 0;
  v_confirmed_rounds integer := 0;

  v_item_line_group text;
  v_item_retained bigint;
  v_item_multiplier numeric;
  v_item_retention_limit bigint;
begin
  v_pool := upper(trim(coalesce(p_risk_pool,'')));
  v_line_group_id := trim(coalesce(p_line_group_id,''));
  v_summary_group_id := trim(coalesce(p_summary_group_id,''));

  if p_request_id is null then
    raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED';
  end if;

  if p_settlement_session_id is null then
    raise exception 'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;

  if v_line_group_id = '' then
    raise exception 'INVALID_LINE_GROUP_ID';
  end if;

  if v_summary_group_id = '' then
    raise exception 'INVALID_SUMMARY_GROUP_ID';
  end if;

  if v_pool not in ('MAIN','H','L') then
    raise exception 'INVALID_RISK_POOL';
  end if;

  if p_rounds is null
    or jsonb_typeof(p_rounds) <> 'array'
    or jsonb_array_length(p_rounds) = 0
  then
    raise exception 'DISTRIBUTION_ROUNDS_REQUIRED';
  end if;

  if p_expected_gross_received is null
    or p_expected_gross_received < 0
    or p_expected_calculation_band is null
    or p_expected_calculation_band <= 0
    or p_expected_reduction_pct is null
    or p_expected_reduction_pct < 0
    or p_expected_reduction_pct > 100
    or p_expected_risk_budget is null
    or p_expected_risk_budget < 0
  then
    raise exception 'INVALID_RISK_SNAPSHOT';
  end if;


  -- Same global lock used by settlement lifecycle/live LINE Group remap.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  -- Keep settlement row lock compatible with existing persistence/confirm paths.
  select *
  into v_session
  from public.settlement_sessions
  where id = p_settlement_session_id
  for update;

  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_session.status <> 'OPEN' then
    raise exception 'SETTLEMENT_NOT_OPEN';
  end if;


  -- Preserve the legacy Summary Group serialization key so batch_number remains
  -- safe even while old and new confirmation paths coexist.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_settlement_session_id::text,
        v_summary_group_id
      ),
      0
    )
  );

  -- New LINE Group ownership lock.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_settlement_session_id::text,
        v_summary_group_id,
        v_line_group_id,
        'CATEGORY_RETENTION'
      ),
      0
    )
  );


  -- request_id is globally unique. Never return an unrelated run merely
  -- because a UUID collided or was reused by the wrong caller.
  select *
  into v_existing
  from public.settlement_distribution_runs
  where request_id = p_request_id;

  if found then
    if v_existing.settlement_session_id <> p_settlement_session_id
      or coalesce(v_existing.line_group_id,'') <> v_line_group_id
      or v_existing.summary_group_id <> v_summary_group_id
      or coalesce(v_existing.risk_model,'') <> 'CATEGORY_RETENTION'
      or coalesce(v_existing.risk_pool,'MAIN') <> v_pool
    then
      raise exception 'CONFIRMATION_REQUEST_ID_COLLISION';
    end if;

    return jsonb_build_object(
      'idempotent', true,
      'run_id', v_existing.id,
      'line_group_id', v_existing.line_group_id,
      'risk_pool', coalesce(v_existing.risk_pool,'MAIN'),
      'risk_model', v_existing.risk_model,
      'planned_quantity', v_existing.planned_quantity,
      'confirmed_quantity', v_existing.confirmed_quantity,
      'planned_rounds', v_existing.planned_rounds,
      'confirmed_rounds', v_existing.confirmed_rounds,
      'retained_total_after', v_existing.retained_total_after,
      'recommended_cut_after', v_existing.recommended_cut_after,
      'confirmed_at', v_existing.confirmed_at
    );
  end if;


  -- Lock the exact OPEN-settlement LINE Group snapshot.
  select *
  into v_cfg
  from public.settlement_line_group_config
  where settlement_session_id = p_settlement_session_id
    and line_group_id = v_line_group_id
  for update;

  if not found then
    raise exception 'LINE_GROUP_NOT_IN_SETTLEMENT';
  end if;

  if not coalesce(v_cfg.enabled,false) then
    raise exception 'LINE_GROUP_DISABLED';
  end if;

  if v_cfg.summary_group_id <> v_summary_group_id then
    raise exception 'RISK_STATE_STALE';
  end if;

  if round(v_cfg.reduction_pct,3)
      <> round(p_expected_reduction_pct,3)
  then
    raise exception 'RISK_STATE_STALE';
  end if;


  select *
  into v_state
  from public.session_line_group_risk_state
  where settlement_session_id = p_settlement_session_id
    and line_group_id = v_line_group_id;

  if not found then
    raise exception 'RISK_STATE_NOT_FOUND';
  end if;

  if v_state.summary_group_id <> v_summary_group_id
    or v_state.risk_model <> 'CATEGORY_RETENTION'
    or not coalesce(v_state.risk_calculation_ready,false)
    or coalesce(v_state.over_cut_code_count,0) > 0
  then
    raise exception 'RISK_STATE_STALE';
  end if;

  if v_state.business_date <> v_session.business_date
    or v_state.gross_received <> p_expected_gross_received
    or v_state.calculation_band <> p_expected_calculation_band
    or round(v_state.reduction_pct,3)
       <> round(p_expected_reduction_pct,3)
    or round(v_state.risk_budget,2)
       <> round(p_expected_risk_budget,2)
  then
    raise exception 'RISK_STATE_STALE';
  end if;

  if not coalesce(v_state.cut_required,false) then
    raise exception 'NO_RISK_DISTRIBUTION_REQUIRED';
  end if;


  -- Validate every selected code against one immutable pre-write snapshot.
  -- A code may be split across several warehouse rounds, therefore aggregate
  -- its quantity across all rounds before comparing with recommended_cut.
  for v_code_agg in
    select
      upper(trim(i.value->>'category')) as category,
      trim(i.value->>'code') as code,

      min(trim(i.value->>'line_group_id')) as min_line_group_id,
      max(trim(i.value->>'line_group_id')) as max_line_group_id,

      sum((i.value->>'quantity')::bigint)::bigint
        as quantity,

      min((i.value->>'expected_retained_quantity')::bigint)::bigint
        as min_expected_retained,

      max((i.value->>'expected_retained_quantity')::bigint)::bigint
        as max_expected_retained,

      min((i.value->>'expected_effective_multiplier')::numeric)
        as min_expected_multiplier,

      max((i.value->>'expected_effective_multiplier')::numeric)
        as max_expected_multiplier,

      min((i.value->>'retention_limit')::bigint)::bigint
        as min_retention_limit,

      max((i.value->>'retention_limit')::bigint)::bigint
        as max_retention_limit

    from jsonb_array_elements(p_rounds) r(value)
    cross join lateral jsonb_array_elements(r.value->'items') i(value)

    group by
      upper(trim(i.value->>'category')),
      trim(i.value->>'code')
  loop
    if coalesce(v_code_agg.category,'') = ''
      or coalesce(v_code_agg.code,'') = ''
      or v_code_agg.quantity <= 0
    then
      raise exception 'INVALID_TRANSFER_ITEM';
    end if;

    if v_pool = 'MAIN'
      and v_code_agg.category not in ('A','B','E','F','G')
    then
      raise exception 'INVALID_RISK_POOL_CATEGORY';
    end if;

    if v_pool in ('H','L')
      and v_code_agg.category <> v_pool
    then
      raise exception 'INVALID_RISK_POOL_CATEGORY';
    end if;

    if v_code_agg.min_line_group_id <> v_line_group_id
      or v_code_agg.max_line_group_id <> v_line_group_id
    then
      raise exception 'LINE_GROUP_MISMATCH';
    end if;

    if v_code_agg.min_expected_retained
        <> v_code_agg.max_expected_retained
      or round(v_code_agg.min_expected_multiplier,3)
        <> round(v_code_agg.max_expected_multiplier,3)
      or v_code_agg.min_retention_limit
        <> v_code_agg.max_retention_limit
    then
      raise exception 'INCONSISTENT_TRANSFER_SNAPSHOT';
    end if;


    select *
    into v_code_state
    from public.session_line_group_code_retention_state
    where settlement_session_id = p_settlement_session_id
      and line_group_id = v_line_group_id
      and category = v_code_agg.category
      and code = v_code_agg.code;

    if not found then
      raise exception 'TRANSFER_CODE_NOT_FOUND';
    end if;

    if v_code_state.summary_group_id <> v_summary_group_id
      or v_code_state.retention_status <> 'CUT_REQUIRED'
      or v_code_state.confirmed_cut_exceeds_order_total
    then
      raise exception 'RISK_STATE_STALE';
    end if;

    if v_code_state.retained_quantity
        <> v_code_agg.min_expected_retained
      or round(v_code_state.effective_multiplier,3)
        <> round(v_code_agg.min_expected_multiplier,3)
      or v_code_state.retention_limit
        <> v_code_agg.min_retention_limit
    then
      raise exception 'RISK_STATE_STALE';
    end if;

    -- Selected code confirmation is intentionally all-or-nothing.
    -- Users may select only some codes, but each selected code must receive
    -- its complete current recommendation.
    if v_code_agg.quantity
        <> v_code_state.recommended_cut
    then
      raise exception 'RETENTION_RECOMMENDATION_MISMATCH';
    end if;
  end loop;


  v_planned_rounds := jsonb_array_length(p_rounds);

  select
    coalesce(
      sum((i.value->>'quantity')::bigint),
      0
    )::bigint
  into v_planned_quantity
  from jsonb_array_elements(p_rounds) r(value)
  cross join lateral jsonb_array_elements(r.value->'items') i(value);

  if v_planned_quantity <= 0 then
    raise exception 'TRANSFER_ITEMS_REQUIRED';
  end if;


  v_before := v_state;

  insert into public.settlement_distribution_runs(
    request_id,
    settlement_session_id,
    business_date,
    summary_group_id,
    risk_pool,

    planned_quantity,
    planned_rounds,

    risk_point_before,
    risk_budget,
    excess_point_before,

    confirmed_by,

    line_group_id,
    risk_model,

    gross_received,
    calculation_band,
    reduction_pct,

    retained_total_before,
    recommended_cut_before
  )
  values(
    p_request_id,
    p_settlement_session_id,
    v_session.business_date,
    v_summary_group_id,
    v_pool,

    v_planned_quantity,
    v_planned_rounds,

    coalesce(v_before.point_reserve_total,0),
    v_before.risk_budget,
    coalesce(v_before.recommended_point_reduction,0),

    p_confirmed_by,

    v_line_group_id,
    'CATEGORY_RETENTION',

    v_before.gross_received,
    v_before.calculation_band,
    v_before.reduction_pct,

    v_before.retained_total,
    v_before.recommended_cut_total
  )
  returning id into v_run_id;


  for v_round in
    select value
    from jsonb_array_elements(p_rounds)
  loop
    v_destination := trim(
      coalesce(v_round->>'destination','')
    );

    begin
      v_expected_limit :=
        (v_round->>'destination_limit')::bigint;
    exception
      when others then
        raise exception 'INVALID_WAREHOUSE_BATCH_LIMIT';
    end;

    if v_destination = ''
      or v_expected_limit <= 0
    then
      raise exception 'INVALID_WAREHOUSE_BATCH_LIMIT';
    end if;


    select max_batch_quantity
    into v_current_limit
    from public.warehouse_transfer_limits
    where destination = v_destination
      and enabled = true;

    if v_current_limit is null then
      raise exception 'DESTINATION_LIMIT_NOT_CONFIGURED';
    end if;

    if v_current_limit <> v_expected_limit then
      raise exception 'RISK_STATE_STALE';
    end if;


    -- One batch cannot contain the same category/code twice because
    -- settlement_transfer_batch_items PK is (batch_id,category,code).
    if exists (
      select 1
      from jsonb_array_elements(v_round->'items') i(value)
      group by
        upper(trim(i.value->>'category')),
        trim(i.value->>'code')
      having count(*) > 1
    ) then
      raise exception 'DUPLICATE_TRANSFER_ITEM';
    end if;


    select
      coalesce(
        sum((i.value->>'quantity')::bigint),
        0
      )::bigint
    into v_round_total
    from jsonb_array_elements(v_round->'items') i(value);

    if v_round_total <= 0 then
      raise exception 'TRANSFER_ITEMS_REQUIRED';
    end if;

    if v_round_total > v_current_limit then
      raise exception 'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT';
    end if;


    select coalesce(max(batch_number),0) + 1
    into v_batch_number
    from public.settlement_transfer_batches
    where settlement_session_id = p_settlement_session_id
      and summary_group_id = v_summary_group_id;


    -- Read the current LINE Group state immediately before this batch so the
    -- audit columns describe the state before this exact warehouse round.
    select *
    into v_before
    from public.session_line_group_risk_state
    where settlement_session_id = p_settlement_session_id
      and line_group_id = v_line_group_id;

    if not found
      or coalesce(v_before.over_cut_code_count,0) > 0
    then
      raise exception 'RISK_STATE_STALE';
    end if;


    insert into public.settlement_transfer_batches(
      request_id,
      settlement_session_id,
      business_date,
      summary_group_id,
      risk_pool,
      batch_number,
      destination,
      risk_mode,

      adjusted_received,
      risk_point_total,
      net_safe_capacity,
      confirmed_cut_before,
      cut_total,
      confirmed_by,

      point_loss_tolerance,
      risk_budget,
      excess_point_risk_before,
      warehouse_batch_limit,
      distribution_run_id,

      line_group_id,
      risk_model
    )
    values(
      gen_random_uuid(),
      p_settlement_session_id,
      v_session.business_date,
      v_summary_group_id,
      v_pool,
      v_batch_number,
      v_destination,
      'RESERVE',

      v_before.gross_received,
      coalesce(v_before.point_reserve_total,0),
      0,
      v_before.confirmed_cut_total,
      v_round_total,
      p_confirmed_by,

      0,
      v_before.risk_budget,
      coalesce(v_before.recommended_point_reduction,0),
      v_current_limit,
      v_run_id,

      v_line_group_id,
      'CATEGORY_RETENTION'
    )
    returning id into v_batch_id;


    for v_item in
      select value
      from jsonb_array_elements(v_round->'items')
    loop
      v_item_line_group :=
        trim(coalesce(v_item->>'line_group_id',''));

      v_category :=
        upper(trim(coalesce(v_item->>'category','')));

      v_code :=
        trim(coalesce(v_item->>'code',''));

      begin
        v_qty :=
          (v_item->>'quantity')::bigint;

        v_item_retained :=
          (v_item->>'expected_retained_quantity')::bigint;

        v_item_multiplier :=
          (v_item->>'expected_effective_multiplier')::numeric;

        v_item_retention_limit :=
          (v_item->>'retention_limit')::bigint;
      exception
        when others then
          raise exception 'INVALID_TRANSFER_ITEM';
      end;


      if v_item_line_group <> v_line_group_id
        or v_qty <= 0
        or v_code = ''
      then
        raise exception 'INVALID_TRANSFER_ITEM';
      end if;

      if v_pool = 'MAIN'
        and v_category not in ('A','B','E','F','G')
      then
        raise exception 'INVALID_RISK_POOL_CATEGORY';
      end if;

      if v_pool in ('H','L')
        and v_category <> v_pool
      then
        raise exception 'INVALID_RISK_POOL_CATEGORY';
      end if;


      -- This state moves after each prior warehouse round. Use it for audit
      -- retained_before/recommended_transfer_before, but the all-round signed
      -- snapshot was already validated before the first write.
      select *
      into v_code_state
      from public.session_line_group_code_retention_state
      where settlement_session_id = p_settlement_session_id
        and line_group_id = v_line_group_id
        and category = v_category
        and code = v_code;

      if not found then
        raise exception 'TRANSFER_CODE_NOT_FOUND';
      end if;

      if v_code_state.confirmed_cut_exceeds_order_total
        or v_code_state.retention_limit <> v_item_retention_limit
        or round(v_code_state.effective_multiplier,3)
           <> round(v_item_multiplier,3)
        or v_qty > v_code_state.recommended_cut
      then
        raise exception 'RISK_STATE_STALE';
      end if;


      insert into public.settlement_transfer_batch_items(
        batch_id,
        category,
        code,
        quantity,

        retained_before,
        effective_multiplier,
        recommended_transfer_before,

        line_group_id,
        retention_limit
      )
      values(
        v_batch_id,
        v_category,
        v_code,
        v_qty,

        v_code_state.retained_quantity,
        v_code_state.effective_multiplier,
        v_code_state.recommended_cut,

        v_line_group_id,
        v_code_state.retention_limit
      );
    end loop;


    select *
    into v_after
    from public.session_line_group_risk_state
    where settlement_session_id = p_settlement_session_id
      and line_group_id = v_line_group_id;

    if not found
      or coalesce(v_after.over_cut_code_count,0) > 0
    then
      raise exception 'RISK_STATE_STALE';
    end if;

    update public.settlement_transfer_batches
    set
      projected_point_reserve =
        v_after.point_reserve_total,

      projected_excess_point_risk =
        v_after.recommended_point_reduction
    where id = v_batch_id;

    v_confirmed_quantity :=
      v_confirmed_quantity + v_round_total;

    v_confirmed_rounds :=
      v_confirmed_rounds + 1;
  end loop;


  -- Every selected code must now be fully reduced to its signed retention
  -- limit. The group may still require cuts on other unselected codes.
  for v_code_agg in
    select
      upper(trim(i.value->>'category')) as category,
      trim(i.value->>'code') as code
    from jsonb_array_elements(p_rounds) r(value)
    cross join lateral jsonb_array_elements(r.value->'items') i(value)
    group by
      upper(trim(i.value->>'category')),
      trim(i.value->>'code')
  loop
    select *
    into v_code_state
    from public.session_line_group_code_retention_state
    where settlement_session_id = p_settlement_session_id
      and line_group_id = v_line_group_id
      and category = v_code_agg.category
      and code = v_code_agg.code;

    if not found
      or v_code_state.confirmed_cut_exceeds_order_total
      or v_code_state.recommended_cut <> 0
      or v_code_state.retained_quantity
         <> v_code_state.retention_limit
    then
      raise exception 'POST_CONFIRM_RETENTION_MISMATCH';
    end if;
  end loop;


  select *
  into v_after
  from public.session_line_group_risk_state
  where settlement_session_id = p_settlement_session_id
    and line_group_id = v_line_group_id;

  if not found
    or coalesce(v_after.over_cut_code_count,0) > 0
  then
    raise exception 'RISK_STATE_STALE';
  end if;


  update public.settlement_distribution_runs
  set
    confirmed_quantity =
      v_confirmed_quantity,

    confirmed_rounds =
      v_confirmed_rounds,

    projected_point_after =
      v_after.point_reserve_total,

    projected_excess_after =
      v_after.recommended_point_reduction,

    retained_total_after =
      v_after.retained_total,

    recommended_cut_after =
      v_after.recommended_cut_total
  where id = v_run_id;


  return jsonb_build_object(
    'idempotent', false,
    'run_id', v_run_id,
    'line_group_id', v_line_group_id,
    'risk_pool', v_pool,
    'risk_model', 'CATEGORY_RETENTION',

    'planned_quantity',
      v_planned_quantity,

    'confirmed_quantity',
      v_confirmed_quantity,

    'planned_rounds',
      v_planned_rounds,

    'confirmed_rounds',
      v_confirmed_rounds,

    'retained_total_after',
      v_after.retained_total,

    'recommended_cut_after',
      v_after.recommended_cut_total,

    'risk_status_after',
      v_after.risk_status,

    'cut_required_after',
      v_after.cut_required,

    'confirmed_at',
      now()
  );
end;
$$;


revoke all on function
public.confirm_line_group_distribution_run(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  numeric,
  numeric,
  jsonb,
  text
)
from public, anon, authenticated;

grant execute on function
public.confirm_line_group_distribution_run(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  bigint,
  numeric,
  numeric,
  jsonb,
  text
)
to service_role;
