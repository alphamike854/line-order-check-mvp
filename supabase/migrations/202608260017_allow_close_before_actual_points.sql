-- Dashboard v7.4: closing a settlement no longer requires actual Point codes.
-- Actual Point codes may be added/corrected later on the same CLOSED settlement.
-- Settlement-scoped reduction, promotion and Point profiles are already snapshotted,
-- so later Point calculation continues to use the values frozen for that settlement.

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
  v_open_reviews integer;
  v_ready boolean;
  v_counts jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0));

  select * into v_session
  from public.settlement_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status<>'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  -- Keep the existing data-quality guard for unresolved parser reviews.
  -- Point selection itself is deliberately NOT a close guard anymore.
  select count(*)::integer into v_open_reviews
  from public.review_items r
  join public.messages m on m.id=r.message_record_id
  where m.settlement_session_id=p_session_id and r.status='OPEN';

  if coalesce(v_open_reviews,0)>0 then
    raise exception 'SETTLEMENT_HAS_OPEN_REVIEW';
  end if;

  select actual_codes_ready,category_counts
    into v_ready,v_counts
  from public.session_actual_point_status
  where settlement_session_id=p_session_id;

  update public.settlement_sessions
  set status='CLOSED',closed_at=now(),closed_by=p_closed_by
  where id=p_session_id;

  return jsonb_build_object(
    'id',p_session_id,
    'business_date',v_session.business_date,
    'status','CLOSED',
    'closed_at',now(),
    'point_ready',coalesce(v_ready,false),
    'special_point_counts',coalesce(v_counts,'{}'::jsonb)
  );
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
  select * into v_session
  from public.settlement_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status not in ('OPEN','CLOSED') then raise exception 'SETTLEMENT_NOT_EDITABLE'; end if;
  if p_codes is null or jsonb_typeof(p_codes)<>'array' then raise exception 'INVALID_POINT_CODES'; end if;

  delete from public.settlement_actual_special_point_codes
  where settlement_session_id=p_session_id;

  for v_item in select value from jsonb_array_elements(p_codes)
  loop
    v_category:=upper(trim(v_item->>'category'));
    v_code:=trim(v_item->>'code');

    select max_special_codes into v_limit
    from public.settlement_point_profiles
    where settlement_session_id=p_session_id and category=v_category;

    if v_limit is null or coalesce(v_code,'')='' then raise exception 'INVALID_POINT_CODE'; end if;
    if (v_category in ('A','B') and v_code !~ '^\d{2}$')
      or (v_category in ('E','F','G') and v_code !~ '^\d{3}$')
    then
      raise exception 'INVALID_POINT_CODE';
    end if;

    if (
      select count(*)
      from public.settlement_actual_special_point_codes
      where settlement_session_id=p_session_id and category=v_category
    ) >= v_limit then
      raise exception 'SPECIAL_POINT_LIMIT_%',v_category;
    end if;

    insert into public.settlement_actual_special_point_codes(settlement_session_id,category,code)
    values(p_session_id,v_category,v_code);
    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.close_settlement_session(uuid,text) from public,anon,authenticated;
grant execute on function public.close_settlement_session(uuid,text) to service_role;

revoke all on function public.replace_settlement_actual_special_codes(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_settlement_actual_special_codes(uuid,jsonb) to service_role;
