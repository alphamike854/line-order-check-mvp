alter table public.review_items
  add column if not exists resolution_type text,
  add column if not exists corrected_text text,
  add column if not exists resolved_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_items_resolution_type_check'
      and conrelid = 'public.review_items'::regclass
  ) then
    alter table public.review_items
      add constraint review_items_resolution_type_check
      check (resolution_type is null or resolution_type in ('CORRECTED','IGNORED'));
  end if;
end $$;

create table if not exists public.review_resolution_events (
  id uuid primary key default gen_random_uuid(),
  review_id bigint not null references public.review_items(id),
  message_record_id uuid not null references public.messages(id),
  action text not null check (action in ('CORRECTED','IGNORED')),
  original_parse_status text,
  corrected_text text,
  before_items jsonb not null default '[]'::jsonb,
  after_items jsonb not null default '[]'::jsonb,
  resolved_by text,
  resolved_at timestamptz not null default now()
);

create index if not exists review_resolution_events_review_idx
  on public.review_resolution_events (review_id, resolved_at desc);

alter table public.review_resolution_events enable row level security;
revoke all on public.review_resolution_events from anon, authenticated;

create table if not exists public.settings_change_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('SUMMARY_GROUP','LINE_GROUP','ALLOCATION_RULE','CATEGORY_ALIAS')),
  entity_key text not null,
  action text not null default 'UPSERT' check (action in ('UPSERT')),
  before_data jsonb,
  after_data jsonb not null,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists settings_change_events_lookup_idx
  on public.settings_change_events (entity_type, entity_key, changed_at desc);

alter table public.settings_change_events enable row level security;
revoke all on public.settings_change_events from anon, authenticated;

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
begin
  select r.*
    into v_review
  from public.review_items r
  where r.id = p_review_id
  for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND';
  end if;

  if v_review.status <> 'OPEN' then
    raise exception 'REVIEW_NOT_OPEN';
  end if;

  select m.*
    into v_message
  from public.messages m
  where m.id = v_review.message_record_id
  for update;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if v_message.unsent then
    raise exception 'MESSAGE_ALREADY_UNSENT';
  end if;

  select lg.summary_group_id
    into v_summary_group_id
  from public.line_groups lg
  where lg.line_group_id = v_message.line_group_id
    and lg.enabled = true;

  if v_summary_group_id is null then
    raise exception 'MESSAGE_GROUP_NOT_CONFIGURED';
  end if;

  if coalesce(trim(p_corrected_text), '') = '' then
    raise exception 'CORRECTED_TEXT_REQUIRED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PARSED_ITEMS_REQUIRED';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category', oi.category,
        'code', oi.code,
        'quantity', oi.quantity
      ) order by oi.category, oi.code
    ),
    '[]'::jsonb
  )
  into v_before_items
  from public.order_items oi
  where oi.message_record_id = v_message.id;

  delete from public.order_items
  where message_record_id = v_message.id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_category := upper(trim(v_item ->> 'category'));
    v_code := trim(v_item ->> 'code');

    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_ITEM_QUANTITY';
    end;

    if v_category not in ('A','B','E','F','G') then
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
      parser_version
    ) values (
      v_message.id,
      v_message.business_date,
      v_message.line_group_id,
      v_summary_group_id,
      v_category,
      v_code,
      v_quantity,
      false,
      p_parser_version
    );
  end loop;

  update public.messages
  set
    summary_group_id = v_summary_group_id,
    normalized_text = p_corrected_text,
    parse_status = 'PARSED',
    parser_version = p_parser_version
  where id = v_message.id;

  update public.review_items
  set
    status = 'RESOLVED',
    resolved_at = now(),
    resolution_type = 'CORRECTED',
    corrected_text = p_corrected_text,
    resolved_by = p_resolved_by
  where id = v_review.id;

  insert into public.review_resolution_events (
    review_id,
    message_record_id,
    action,
    original_parse_status,
    corrected_text,
    before_items,
    after_items,
    resolved_by
  ) values (
    v_review.id,
    v_message.id,
    'CORRECTED',
    v_message.parse_status,
    p_corrected_text,
    v_before_items,
    p_items,
    p_resolved_by
  );

  return jsonb_build_object(
    'review_id', v_review.id,
    'message_record_id', v_message.id,
    'status', 'RESOLVED',
    'resolution_type', 'CORRECTED',
    'items_count', jsonb_array_length(p_items)
  );
end;
$$;

create or replace function public.ignore_review(
  p_review_id bigint,
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
  v_before_items jsonb := '[]'::jsonb;
begin
  select r.*
    into v_review
  from public.review_items r
  where r.id = p_review_id
  for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND';
  end if;

  if v_review.status <> 'OPEN' then
    raise exception 'REVIEW_NOT_OPEN';
  end if;

  select m.*
    into v_message
  from public.messages m
  where m.id = v_review.message_record_id
  for update;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category', oi.category,
        'code', oi.code,
        'quantity', oi.quantity
      ) order by oi.category, oi.code
    ),
    '[]'::jsonb
  )
  into v_before_items
  from public.order_items oi
  where oi.message_record_id = v_message.id;

  delete from public.order_items
  where message_record_id = v_message.id;

  update public.messages
  set parse_status = 'IGNORE'
  where id = v_message.id;

  update public.review_items
  set
    status = 'IGNORED',
    resolved_at = now(),
    resolution_type = 'IGNORED',
    resolved_by = p_resolved_by
  where id = v_review.id;

  insert into public.review_resolution_events (
    review_id,
    message_record_id,
    action,
    original_parse_status,
    before_items,
    after_items,
    resolved_by
  ) values (
    v_review.id,
    v_message.id,
    'IGNORED',
    v_message.parse_status,
    v_before_items,
    '[]'::jsonb,
    p_resolved_by
  );

  return jsonb_build_object(
    'review_id', v_review.id,
    'message_record_id', v_message.id,
    'status', 'IGNORED',
    'resolution_type', 'IGNORED'
  );
end;
$$;

revoke all on function public.resolve_review_with_items(bigint,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.ignore_review(bigint,text) from public, anon, authenticated;
grant execute on function public.resolve_review_with_items(bigint,text,text,jsonb,text) to service_role;
grant execute on function public.ignore_review(bigint,text) to service_role;
