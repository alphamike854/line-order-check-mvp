alter table public.allocation_confirmation_events
  add column if not exists request_id uuid,
  add column if not exists order_total bigint,
  add column if not exists threshold integer,
  add column if not exists destination text,
  add column if not exists should_transfer bigint;

create unique index if not exists allocation_confirmation_events_request_id_uidx
  on public.allocation_confirmation_events (request_id)
  where request_id is not null;

create or replace function public.confirm_allocation_transfer_safe(
  p_request_id uuid,
  p_business_date date,
  p_summary_group_id text,
  p_category text,
  p_code text,
  p_expected_order_total bigint,
  p_expected_threshold integer,
  p_expected_destination text,
  p_expected_should_transfer bigint,
  p_expected_confirmed_transfer bigint,
  p_expected_transfer_now bigint,
  p_confirmed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.allocation_confirmation_events%rowtype;
  v_state record;
  v_previous bigint;
  v_new bigint;
  v_delta bigint;
  v_event_id uuid;
begin
  if p_request_id is null then
    raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED';
  end if;

  -- Serialize confirmations for the same business-date/group/category/code.
  -- This makes two browser tabs safe: the second request observes the first
  -- request's committed confirmation before it can proceed.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', p_business_date::text, p_summary_group_id, upper(p_category), p_code),
      0
    )
  );

  select *
    into v_existing
  from public.allocation_confirmation_events
  where request_id = p_request_id
  limit 1;

  if found then
    return jsonb_build_object(
      'idempotent', true,
      'event_id', v_existing.id,
      'business_date', v_existing.business_date,
      'summary_group_id', v_existing.summary_group_id,
      'category', v_existing.category,
      'code', v_existing.code,
      'previous_confirmed', v_existing.previous_confirmed,
      'confirmed_transfer', v_existing.new_confirmed,
      'delta_confirmed', v_existing.delta_confirmed,
      'confirmed_at', v_existing.confirmed_at
    );
  end if;

  select *
    into v_state
  from public.allocation_state
  where business_date = p_business_date
    and summary_group_id = p_summary_group_id
    and category = upper(p_category)
    and code = p_code;

  if not found then
    raise exception 'ALLOCATION_STATE_NOT_FOUND';
  end if;

  -- Optimistic snapshot check. Do not silently confirm a larger or different
  -- transfer than the operator actually saw on screen.
  if v_state.order_total::bigint <> p_expected_order_total
    or v_state.threshold::integer <> p_expected_threshold
    or v_state.destination is distinct from p_expected_destination
    or v_state.should_transfer::bigint <> p_expected_should_transfer
    or v_state.confirmed_transfer::bigint <> p_expected_confirmed_transfer
    or v_state.transfer_now::bigint <> p_expected_transfer_now
  then
    raise exception 'ALLOCATION_STALE';
  end if;

  if p_expected_transfer_now <= 0 or v_state.transfer_now::bigint <= 0 then
    raise exception 'NO_TRANSFER_REQUIRED';
  end if;

  v_previous := v_state.confirmed_transfer::bigint;
  v_new := v_state.should_transfer::bigint;
  v_delta := v_new - v_previous;

  if v_delta <= 0 or v_delta <> p_expected_transfer_now then
    raise exception 'ALLOCATION_STALE';
  end if;

  insert into public.allocation_confirmations (
    business_date,
    summary_group_id,
    category,
    code,
    confirmed_transfer,
    confirmed_at,
    confirmed_by
  ) values (
    p_business_date,
    p_summary_group_id,
    upper(p_category),
    p_code,
    v_new,
    now(),
    p_confirmed_by
  )
  on conflict (business_date, summary_group_id, category, code)
  do update set
    confirmed_transfer = excluded.confirmed_transfer,
    confirmed_at = excluded.confirmed_at,
    confirmed_by = excluded.confirmed_by;

  insert into public.allocation_confirmation_events (
    request_id,
    business_date,
    summary_group_id,
    category,
    code,
    previous_confirmed,
    new_confirmed,
    delta_confirmed,
    order_total,
    threshold,
    destination,
    should_transfer,
    confirmed_by
  ) values (
    p_request_id,
    p_business_date,
    p_summary_group_id,
    upper(p_category),
    p_code,
    v_previous,
    v_new,
    v_delta,
    v_state.order_total,
    v_state.threshold,
    v_state.destination,
    v_state.should_transfer,
    p_confirmed_by
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'idempotent', false,
    'event_id', v_event_id,
    'business_date', p_business_date,
    'summary_group_id', p_summary_group_id,
    'category', upper(p_category),
    'code', p_code,
    'previous_confirmed', v_previous,
    'confirmed_transfer', v_new,
    'delta_confirmed', v_delta,
    'order_total', v_state.order_total,
    'threshold', v_state.threshold,
    'destination', v_state.destination,
    'should_transfer', v_state.should_transfer,
    'confirmed_at', now()
  );
end;
$$;

revoke all on function public.confirm_allocation_transfer_safe(uuid,date,text,text,text,bigint,integer,text,bigint,bigint,bigint,text)
  from public, anon, authenticated;
grant execute on function public.confirm_allocation_transfer_safe(uuid,date,text,text,text,bigint,integer,text,bigint,bigint,bigint,text)
  to service_role;
