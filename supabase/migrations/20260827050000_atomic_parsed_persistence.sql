-- v8.8
-- Persist a PARSED message and all canonical order_items in one PostgreSQL transaction.
-- Any validation/insert failure rolls the whole function call back.

create or replace function public.persist_parsed_message_atomic(
  p_message_id uuid,
  p_normalized_text text,
  p_parser_version text,
  p_items jsonb,
  p_summary_group_id text,
  p_message_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_patched_message public.messages%rowtype;
  v_session_status text;
  v_summary_group_id text;

  v_item jsonb;
  v_category text;
  v_code text;
  v_quantity integer;
  v_inserted integer := 0;
begin
  -- PARSED is never allowed without canonical items.
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'PARSED_ITEMS_REQUIRED';
  end if;

  if coalesce(trim(p_normalized_text), '') = '' then
    raise exception 'NORMALIZED_TEXT_REQUIRED';
  end if;

  if coalesce(trim(p_parser_version), '') = '' then
    raise exception 'PARSER_VERSION_REQUIRED';
  end if;

  -- Serialize changes to this message.
  select m.*
    into v_message
  from public.messages m
  where m.id = p_message_id
  for update;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if v_message.unsent then
    raise exception 'MESSAGE_ALREADY_UNSENT';
  end if;

  if v_message.settlement_session_id is null then
    raise exception 'SETTLEMENT_NOT_OPEN';
  end if;

  -- Serialize against settlement close.
  select s.status
    into v_session_status
  from public.settlement_sessions s
  where s.id = v_message.settlement_session_id
  for update;

  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_session_status <> 'OPEN' then
    raise exception 'SETTLEMENT_NOT_OPEN';
  end if;

  -- The message snapshot is authoritative when already present.
  if v_message.summary_group_id is not null
     and p_summary_group_id is not null
     and v_message.summary_group_id <> p_summary_group_id then
    raise exception 'SUMMARY_GROUP_MISMATCH';
  end if;

  v_summary_group_id :=
    coalesce(v_message.summary_group_id, p_summary_group_id);

  if v_summary_group_id is null then
    raise exception 'MESSAGE_GROUP_NOT_CONFIGURED';
  end if;

  -- Fresh webhook parsing must never overwrite existing canonical accounting.
  if exists (
    select 1
    from public.order_items oi
    where oi.message_record_id = v_message.id
  ) then
    raise exception 'MESSAGE_ALREADY_HAS_ITEMS';
  end if;

  -- Safely coerce optional message metadata using the real messages row type.
  select *
    into v_patched_message
  from jsonb_populate_record(
    v_message,
    coalesce(p_message_patch, '{}'::jsonb)
  );

  -- Keep the previous application ordering for compatibility, but now this
  -- update and all item inserts live inside ONE database transaction.
  update public.messages
  set
    summary_group_id = v_summary_group_id,
    normalized_text = p_normalized_text,
    parse_status = 'PARSED',
    parser_version = p_parser_version,

    first_order_code = v_patched_message.first_order_code,

    ocr_text = v_patched_message.ocr_text,
    ocr_provider = v_patched_message.ocr_provider,
    ocr_model = v_patched_message.ocr_model,
    ocr_status = v_patched_message.ocr_status,
    ocr_error = v_patched_message.ocr_error,

    image_content_type = v_patched_message.image_content_type,
    image_size_bytes = v_patched_message.image_size_bytes
  where id = v_message.id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_PARSED_ITEM';
    end if;

    v_category := upper(trim(v_item ->> 'category'));
    v_code := trim(v_item ->> 'code');

    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_ITEM_QUANTITY';
    end;

    if v_category not in ('A','B','E','F','G','H','L') then
      raise exception 'INVALID_ITEM_CATEGORY';
    end if;

    if coalesce(v_code, '') = '' then
      raise exception 'INVALID_ITEM_CODE';
    end if;

    if v_quantity <= 0 then
      raise exception 'INVALID_ITEM_QUANTITY';
    end if;

    insert into public.order_items (
      message_record_id,
      business_date,
      line_group_id,
      summary_group_id,
      category,
      code,
      quantity,
      unsent_flag,
      parser_version,
      settlement_session_id
    )
    values (
      v_message.id,
      v_message.business_date,
      v_message.line_group_id,
      v_summary_group_id,
      v_category,
      v_code,
      v_quantity,
      false,
      p_parser_version,
      v_message.settlement_session_id
    );

    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted <> jsonb_array_length(p_items) then
    raise exception 'PARSED_ITEM_COUNT_MISMATCH';
  end if;

  return jsonb_build_object(
    'message_record_id', v_message.id,
    'status', 'PARSED',
    'parser_version', p_parser_version,
    'items_count', v_inserted
  );
end;
$$;

revoke all on function public.persist_parsed_message_atomic(
  uuid,
  text,
  text,
  jsonb,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.persist_parsed_message_atomic(
  uuid,
  text,
  text,
  jsonb,
  text,
  jsonb
) to service_role;
