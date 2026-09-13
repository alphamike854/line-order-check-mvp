-- Allow Review correction inside the latest Working Round after CLOSE_GROUP.
--
-- Business contract:
-- 1. CLOSE_GROUP stops new intake only.
-- 2. The just-closed/latest Round remains the editable Working Round.
-- 3. Opening a newer Round supersedes the previous Round.
-- 4. Parser/OCR admitted-message persistence remains unchanged.
-- 5. Ordinary direct canonical writes while CLOSED remain blocked.
--
-- No parser grammar/data migration is performed here.

begin;

create or replace function public.resolve_review_with_items(
  p_review_id bigint,
  p_corrected_text text,
  p_parser_version text,
  p_items jsonb,
  p_resolved_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.review_items%rowtype;
  v_message public.messages%rowtype;
  v_summary_group_id text;
  v_before_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_category text;
  v_code text;
  v_quantity integer;
  v_session_status text;
  v_latest_round_id uuid;
begin
  select r.* into v_review from public.review_items r where r.id=p_review_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.status <> 'OPEN' then raise exception 'REVIEW_NOT_OPEN'; end if;
  select m.* into v_message from public.messages m where m.id=v_review.message_record_id for update;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if v_message.unsent then raise exception 'MESSAGE_ALREADY_UNSENT'; end if;
  if v_message.settlement_session_id is null then raise exception 'MESSAGE_SETTLEMENT_NOT_ASSIGNED'; end if;
  select status into v_session_status from public.settlement_sessions where id=v_message.settlement_session_id;
  if v_session_status <> 'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  select summary_group_id into v_summary_group_id from public.settlement_line_group_config
  where settlement_session_id=v_message.settlement_session_id and line_group_id=v_message.line_group_id;
  if v_summary_group_id is null then raise exception 'MESSAGE_GROUP_NOT_CONFIGURED'; end if;

  -- ----------------------------------------------------------
  -- Current Working Round boundary.
  --
  -- CLOSE_GROUP stops new intake only. Review/correction of an
  -- already-owned message remains valid while that message still
  -- belongs to the latest Summary Group Round, whether that Round
  -- is OPEN or CLOSED.
  --
  -- Opening the next Round supersedes the previous one.
  -- ----------------------------------------------------------
  if
    v_message.summary_group_round_id is null
    or v_message.summary_group_id
      is distinct from v_summary_group_id
  then
    raise exception 'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  select
    r.id
  into
    v_latest_round_id
  from
    public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      v_message.settlement_session_id
    and r.summary_group_id =
      v_summary_group_id
  order by
    r.round_no desc
  limit 1;

  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from v_latest_round_id
  then
    raise exception 'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  -- Exact-message, transaction-local marker consumed only by
  -- enforce_order_item_summary_group_accepting().
  perform set_config(
    'line_order.current_working_round_review_message_id',
    v_message.id::text,
    true
  );

  if coalesce(trim(p_corrected_text),'')='' then raise exception 'CORRECTED_TEXT_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'PARSED_ITEMS_REQUIRED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('category',oi.category,'code',oi.code,'quantity',oi.quantity) order by oi.category,oi.code),'[]'::jsonb)
  into v_before_items from public.order_items oi where oi.message_record_id=v_message.id;
  delete from public.order_items where message_record_id=v_message.id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category')); v_code:=trim(v_item->>'code');
    begin v_quantity:=(v_item->>'quantity')::integer; exception when others then raise exception 'INVALID_ITEM_QUANTITY'; end;
    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_quantity<=0 then raise exception 'INVALID_PARSED_ITEM'; end if;
    insert into public.order_items(message_record_id,business_date,line_group_id,summary_group_id,category,code,quantity,unsent_flag,parser_version,settlement_session_id)
    values(v_message.id,v_message.business_date,v_message.line_group_id,v_summary_group_id,v_category,v_code,v_quantity,false,p_parser_version,v_message.settlement_session_id);
  end loop;

  update public.messages set summary_group_id=v_summary_group_id,normalized_text=p_corrected_text,parse_status='PARSED',parser_version=p_parser_version where id=v_message.id;
  update public.review_items set status='RESOLVED',resolved_at=now(),resolution_type='CORRECTED',corrected_text=p_corrected_text,resolved_by=p_resolved_by where id=v_review.id;
  insert into public.review_resolution_events(review_id,message_record_id,action,original_parse_status,corrected_text,before_items,after_items,resolved_by)
  values(v_review.id,v_message.id,'CORRECTED',v_message.parse_status,p_corrected_text,v_before_items,p_items,p_resolved_by);
  return jsonb_build_object('review_id',v_review.id,'message_record_id',v_message.id,'status','RESOLVED','resolution_type','CORRECTED','items_count',jsonb_array_length(p_items));
end;
$$;

comment on function
  public.resolve_review_with_items(
    bigint,
    text,
    text,
    jsonb,
    text
  )
is
  'Resolves an OPEN Review only for a message in the latest Working Round; installs an exact-message transaction marker so correction remains valid after CLOSE_GROUP but not after a newer Round opens.';


create or replace function
  public.enforce_order_item_summary_group_accepting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admitted_message_id text;
  v_review_message_id text;

  v_message_round_id uuid;
  v_latest_round_id uuid;
  v_message_session_id uuid;
  v_message_summary_group_id text;

begin

  if
    new.settlement_session_id is null
    or coalesce(
      new.summary_group_id,
      ''
    ) = ''
  then
    return new;
  end if;


  v_admitted_message_id :=
    current_setting(
      'line_order.accepted_message_persistence_id',
      true
    );

  v_review_message_id :=
    current_setting(
      'line_order.current_working_round_review_message_id',
      true
    );


  -- ----------------------------------------------------------
  -- Accepted-message parser/OCR completion.
  --
  -- Do NOT re-check current OPEN/CLOSED state: the immutable
  -- message Round ownership is the admission decision.
  -- ----------------------------------------------------------

  if
    v_admitted_message_id
      = new.message_record_id::text
  then

    select
      m.summary_group_round_id,
      m.settlement_session_id,
      m.summary_group_id
    into
      v_message_round_id,
      v_message_session_id,
      v_message_summary_group_id
    from
      public.messages m
    where
      m.id =
        new.message_record_id;


    if not found then
      raise exception
        'MESSAGE_NOT_FOUND';
    end if;


    if v_message_round_id is null then
      raise exception
        'MESSAGE_ROUND_NOT_ASSIGNED';
    end if;


    if
      new.settlement_session_id
        is distinct from
          v_message_session_id
    then
      raise exception
        'ROUND_SETTLEMENT_MISMATCH';
    end if;


    if
      new.summary_group_id
        is distinct from
          v_message_summary_group_id
    then
      raise exception
        'ROUND_SUMMARY_GROUP_MISMATCH';
    end if;


    -- enforce_order_item_round_ownership() remains responsible
    -- for copying/checking summary_group_round_id itself.
    return new;
  end if;


  -- ----------------------------------------------------------
  -- Current Working Round Review correction.
  --
  -- This bypass is intentionally narrower than ordinary writes:
  --   * exact message marker only
  --   * message must already own a Round
  --   * item session/group must match message ownership
  --   * parent settlement remains OPEN
  --   * message Round must be the latest Round for the group
  --
  -- The latest Round may itself be OPEN or CLOSED.
  -- ----------------------------------------------------------
  if
    v_review_message_id
      = new.message_record_id::text
  then
    select
      m.summary_group_round_id,
      m.settlement_session_id,
      m.summary_group_id
    into
      v_message_round_id,
      v_message_session_id,
      v_message_summary_group_id
    from
      public.messages m
    where
      m.id =
        new.message_record_id;

    if not found then
      raise exception
        'MESSAGE_NOT_FOUND';
    end if;

    if v_message_round_id is null then
      raise exception
        'MESSAGE_ROUND_NOT_CURRENT';
    end if;

    if
      new.settlement_session_id
        is distinct from
          v_message_session_id
    then
      raise exception
        'ROUND_SETTLEMENT_MISMATCH';
    end if;

    if
      new.summary_group_id
        is distinct from
          v_message_summary_group_id
    then
      raise exception
        'ROUND_SUMMARY_GROUP_MISMATCH';
    end if;

    select
      r.id
    into
      v_latest_round_id
    from
      public.settlement_summary_group_rounds r
    join
      public.settlement_sessions s
        on s.id =
          r.settlement_session_id
    where
      r.settlement_session_id =
        v_message_session_id
      and r.summary_group_id =
        v_message_summary_group_id
      and s.status = 'OPEN'
    order by
      r.round_no desc
    limit 1;

    if
      v_latest_round_id is null
      or v_message_round_id
        is distinct from
          v_latest_round_id
    then
      raise exception
        'MESSAGE_ROUND_NOT_CURRENT';
    end if;

    -- No r.status='OPEN' predicate here by design.
    -- CLOSED latest Round is still the current Working Round.
    return new;
  end if;


  -- ----------------------------------------------------------
  -- All other canonical mutation retains the original S1 guard.
  -- ----------------------------------------------------------

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        new.settlement_session_id::text,
        new.summary_group_id
      ),
      0
    )
  );


  if not public.is_settlement_summary_group_accepting(
    new.settlement_session_id,
    new.summary_group_id
  ) then
    raise exception
      'SUMMARY_GROUP_CLOSED';
  end if;


  return new;
end;
$$;

comment on function
  public.enforce_order_item_summary_group_accepting()
is
  'Blocks ordinary canonical writes after Summary Group close; permits only admitted parser/OCR completion or exact-message Review correction for the latest Working Round, including when that latest Round is CLOSED.';

commit;
