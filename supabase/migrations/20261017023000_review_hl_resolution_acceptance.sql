-- LOC Review H/L SQL Acceptance Fix V1 -- 2026-10-17
-- SOURCE: commit 96f302e61381ce318d95cfc654c353d33c8b4b65
-- Corrects INVALID_PARSED_ITEM when signed Review Preview contains H/L one-digit items.
-- Preserves current settlement, latest working round (OPEN/CLOSED), immutable lineage,
-- exact-message transaction marker, audit logging and existing A/B/E/F/G semantics.
-- Exact one-function CREATE OR REPLACE; no table/constraint/data/config changes.
-- Existing function owner and GRANT/REVOKE ACLs are preserved by CREATE OR REPLACE.

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

  v_summary_group_id :=
    v_message.summary_group_id;

  if
    v_summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_GROUP_NOT_CONFIGURED';
  end if;

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
    if v_category not in ('A','B','E','F','G','H','L') or coalesce(v_code,'')='' or v_quantity<=0 then raise exception 'INVALID_PARSED_ITEM'; end if;
    -- H/L are one-digit categories (0-9); do not broaden other categories.
    if v_category in ('H','L') and v_code !~ '^[0-9]$' then raise exception 'INVALID_PARSED_ITEM'; end if;
    insert into public.order_items(message_record_id,business_date,line_group_id,summary_group_id,category,code,quantity,unsent_flag,parser_version,settlement_session_id)
    values(v_message.id,v_message.business_date,v_message.line_group_id,v_summary_group_id,v_category,v_code,v_quantity,false,p_parser_version,v_message.settlement_session_id);
  end loop;

  update public.messages set normalized_text=p_corrected_text,parse_status='PARSED',parser_version=p_parser_version where id=v_message.id;
  update public.review_items set status='RESOLVED',resolved_at=now(),resolution_type='CORRECTED',corrected_text=p_corrected_text,resolved_by=p_resolved_by where id=v_review.id;
  insert into public.review_resolution_events(review_id,message_record_id,action,original_parse_status,corrected_text,before_items,after_items,resolved_by)
  values(v_review.id,v_message.id,'CORRECTED',v_message.parse_status,p_corrected_text,v_before_items,p_items,p_resolved_by);
  return jsonb_build_object('review_id',v_review.id,'message_record_id',v_message.id,'status','RESOLVED','resolution_type','CORRECTED','items_count',jsonb_array_length(p_items));
end;
$$;

comment on function public.resolve_review_with_items(bigint,text,text,jsonb,text)
is 'Correct an OPEN Review for the latest working Round, including CLOSED; accepts A/B/E/F/G and one-digit H/L; preserves exact-message Review guard and audit.';

commit;
