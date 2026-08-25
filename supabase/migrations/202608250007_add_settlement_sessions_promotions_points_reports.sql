-- Dashboard v5: settlement sessions, per-opening promotions, special points, pricing reduction, and daily ledger.

create table if not exists public.settlement_sessions (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by text,
  closed_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists settlement_sessions_one_open_uidx
  on public.settlement_sessions ((status))
  where status = 'OPEN';
create index if not exists settlement_sessions_date_idx
  on public.settlement_sessions (business_date, opened_at desc);

alter table public.line_groups
  add column if not exists reduction_pct numeric(7,3) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'line_groups_reduction_pct_check'
      and conrelid = 'public.line_groups'::regclass
  ) then
    alter table public.line_groups
      add constraint line_groups_reduction_pct_check
      check (reduction_pct >= 0 and reduction_pct <= 100);
  end if;
end $$;

create table if not exists public.settlement_line_group_config (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  line_group_id text not null,
  line_group_name text not null,
  summary_group_id text not null references public.summary_groups(id),
  reduction_pct numeric(7,3) not null default 0 check (reduction_pct >= 0 and reduction_pct <= 100),
  primary key (settlement_session_id, line_group_id)
);

create table if not exists public.settlement_allocation_rules (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  summary_group_id text not null references public.summary_groups(id),
  category text not null check (category in ('A','B','E','F','G')),
  threshold integer not null check (threshold > 0),
  destination text,
  primary key (settlement_session_id, summary_group_id, category)
);

create table if not exists public.settlement_promotion_rules (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  summary_group_id text not null references public.summary_groups(id),
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  threshold integer not null check (threshold > 0),
  destination text,
  created_at timestamptz not null default now(),
  primary key (settlement_session_id, summary_group_id, category, code)
);

create table if not exists public.settlement_special_point_rules (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  multiplier integer not null check (multiplier > 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (settlement_session_id, category, code)
);

alter table public.messages add column if not exists settlement_session_id uuid references public.settlement_sessions(id);
alter table public.order_items add column if not exists settlement_session_id uuid references public.settlement_sessions(id);
alter table public.allocation_confirmation_events add column if not exists settlement_session_id uuid references public.settlement_sessions(id);

create index if not exists messages_settlement_idx
  on public.messages (settlement_session_id, line_group_id, event_timestamp, id);
create index if not exists order_items_settlement_idx
  on public.order_items (settlement_session_id, summary_group_id, category, code);
create index if not exists allocation_events_settlement_idx
  on public.allocation_confirmation_events (settlement_session_id, confirmed_at desc);

create table if not exists public.settlement_allocation_confirmations (
  settlement_session_id uuid not null references public.settlement_sessions(id) on delete cascade,
  business_date date not null,
  summary_group_id text not null references public.summary_groups(id),
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  confirmed_transfer bigint not null default 0 check (confirmed_transfer >= 0),
  confirmed_at timestamptz,
  confirmed_by text,
  primary key (settlement_session_id, summary_group_id, category, code)
);

-- Legacy records remain accessible but are placed into immutable legacy sessions, one per business date.
do $$
declare
  d date;
  sid uuid;
begin
  for d in
    select distinct business_date from public.messages where settlement_session_id is null order by business_date
  loop
    insert into public.settlement_sessions (business_date, status, opened_at, closed_at, opened_by, closed_by)
    values (d, 'CLOSED', d::timestamptz, d::timestamptz + interval '23 hours 59 minutes 59 seconds', 'MIGRATION', 'MIGRATION')
    returning id into sid;

    insert into public.settlement_line_group_config (settlement_session_id,line_group_id,line_group_name,summary_group_id,reduction_pct)
    select sid, lg.line_group_id, lg.line_group_name, lg.summary_group_id, lg.reduction_pct
    from public.line_groups lg
    where lg.enabled = true
    on conflict do nothing;

    insert into public.settlement_allocation_rules (settlement_session_id,summary_group_id,category,threshold,destination)
    select sid, ar.summary_group_id, ar.category, ar.threshold, ar.destination
    from public.allocation_rules ar where ar.enabled=true
    on conflict do nothing;

    update public.messages set settlement_session_id = sid
      where business_date = d and settlement_session_id is null;
    update public.order_items set settlement_session_id = sid
      where business_date = d and settlement_session_id is null;
    update public.allocation_confirmation_events set settlement_session_id = sid
      where business_date = d and settlement_session_id is null;
  end loop;
end $$;

create or replace view public.session_current_summary as
select
  oi.settlement_session_id,
  oi.business_date,
  oi.summary_group_id,
  oi.category,
  oi.code,
  sum(oi.quantity)::bigint as order_total,
  sum(case when oi.unsent_flag then oi.quantity else 0 end)::bigint as unsent_qty,
  sum(case when oi.unsent_flag then 0 else oi.quantity end)::bigint as active_equivalent,
  max(oi.created_at) as last_updated
from public.order_items oi
where oi.settlement_session_id is not null
group by oi.settlement_session_id, oi.business_date, oi.summary_group_id, oi.category, oi.code;

create or replace view public.session_allocation_state as
select
  cs.settlement_session_id,
  cs.business_date,
  cs.summary_group_id,
  cs.category,
  cs.code,
  cs.order_total,
  coalesce(pr.threshold, ar.threshold) as threshold,
  coalesce(pr.destination, ar.destination) as destination,
  (pr.settlement_session_id is not null) as promotion_override,
  greatest(0, ((cs.order_total::bigint / coalesce(pr.threshold, ar.threshold)::bigint) - 1) * coalesce(pr.threshold, ar.threshold)::bigint) as should_transfer,
  coalesce(ac.confirmed_transfer, 0)::bigint as confirmed_transfer,
  greatest(
    0,
    greatest(0, ((cs.order_total::bigint / coalesce(pr.threshold, ar.threshold)::bigint) - 1) * coalesce(pr.threshold, ar.threshold)::bigint)
      - coalesce(ac.confirmed_transfer, 0)::bigint
  ) as transfer_now,
  case
    when coalesce(ac.confirmed_transfer, 0)::bigint > greatest(0, ((cs.order_total::bigint / coalesce(pr.threshold, ar.threshold)::bigint) - 1) * coalesce(pr.threshold, ar.threshold)::bigint)
      then 'REVIEW'
    when greatest(
      0,
      greatest(0, ((cs.order_total::bigint / coalesce(pr.threshold, ar.threshold)::bigint) - 1) * coalesce(pr.threshold, ar.threshold)::bigint)
        - coalesce(ac.confirmed_transfer, 0)::bigint
    ) > 0 then 'TRANSFER_REQUIRED'
    else 'OK'
  end as status
from public.session_current_summary cs
left join public.settlement_allocation_rules ar
  on ar.settlement_session_id = cs.settlement_session_id
 and ar.summary_group_id = cs.summary_group_id
 and ar.category = cs.category
left join public.settlement_promotion_rules pr
  on pr.settlement_session_id = cs.settlement_session_id
 and pr.summary_group_id = cs.summary_group_id
 and pr.category = cs.category
 and pr.code = cs.code
left join public.settlement_allocation_confirmations ac
  on ac.settlement_session_id = cs.settlement_session_id
 and ac.summary_group_id = cs.summary_group_id
 and ac.category = cs.category
 and ac.code = cs.code
where coalesce(pr.threshold, ar.threshold) is not null;

create or replace function public.open_settlement_session(
  p_business_date date,
  p_promotions jsonb default '[]'::jsonb,
  p_opened_by text default 'DASHBOARD'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_summary text;
  v_category text;
  v_code text;
  v_threshold integer;
  v_destination text;
begin
  if exists (select 1 from public.settlement_sessions where status = 'OPEN') then
    raise exception 'SETTLEMENT_ALREADY_OPEN';
  end if;
  if p_promotions is null or jsonb_typeof(p_promotions) <> 'array' then
    raise exception 'INVALID_PROMOTIONS';
  end if;

  insert into public.settlement_sessions (business_date,status,opened_by)
  values (p_business_date,'OPEN',p_opened_by)
  returning id into v_id;

  insert into public.settlement_line_group_config (
    settlement_session_id,line_group_id,line_group_name,summary_group_id,reduction_pct
  )
  select v_id, line_group_id,line_group_name,summary_group_id,reduction_pct
  from public.line_groups
  where enabled = true;

  insert into public.settlement_allocation_rules (settlement_session_id,summary_group_id,category,threshold,destination)
  select v_id, summary_group_id, category, threshold, destination
  from public.allocation_rules where enabled=true;

  for v_item in select value from jsonb_array_elements(p_promotions)
  loop
    v_summary := trim(v_item->>'summary_group_id');
    v_category := upper(trim(v_item->>'category'));
    v_code := trim(v_item->>'code');
    begin
      v_threshold := (v_item->>'threshold')::integer;
    exception when others then
      raise exception 'INVALID_PROMOTION_THRESHOLD';
    end;
    v_destination := nullif(trim(v_item->>'destination'),'');

    if coalesce(v_summary,'') = '' or v_category not in ('A','B','E','F','G') or coalesce(v_code,'') = '' or v_threshold <= 0 then
      raise exception 'INVALID_PROMOTION_RULE';
    end if;

    insert into public.settlement_promotion_rules (
      settlement_session_id,summary_group_id,category,code,threshold,destination
    ) values (v_id,v_summary,v_category,v_code,v_threshold,v_destination)
    on conflict (settlement_session_id,summary_group_id,category,code)
    do update set threshold=excluded.threshold,destination=excluded.destination;
  end loop;

  return v_id;
end;
$$;

create or replace function public.close_settlement_session(
  p_session_id uuid,
  p_closed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.settlement_sessions%rowtype;
begin
  select * into v_session from public.settlement_sessions where id = p_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status <> 'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  update public.settlement_sessions
  set status='CLOSED', closed_at=now(), closed_by=p_closed_by
  where id=p_session_id;

  return jsonb_build_object('id',p_session_id,'business_date',v_session.business_date,'status','CLOSED','closed_at',now());
end;
$$;

create or replace function public.replace_settlement_special_points(
  p_session_id uuid,
  p_rules jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_item jsonb;
  v_category text;
  v_code text;
  v_multiplier integer;
  v_count integer := 0;
begin
  select * into v_session from public.settlement_sessions where id=p_session_id for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status <> 'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then raise exception 'INVALID_POINT_RULES'; end if;

  delete from public.settlement_special_point_rules where settlement_session_id=p_session_id;
  for v_item in select value from jsonb_array_elements(p_rules)
  loop
    v_category := upper(trim(v_item->>'category'));
    v_code := trim(v_item->>'code');
    begin v_multiplier := (v_item->>'multiplier')::integer;
    exception when others then raise exception 'INVALID_POINT_MULTIPLIER'; end;
    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_multiplier <= 1 then
      raise exception 'INVALID_POINT_RULE';
    end if;
    insert into public.settlement_special_point_rules(settlement_session_id,category,code,multiplier)
    values(p_session_id,v_category,v_code,v_multiplier);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.confirm_session_allocation_transfer_safe(
  p_request_id uuid,
  p_settlement_session_id uuid,
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
  v_session public.settlement_sessions%rowtype;
  v_previous bigint;
  v_new bigint;
  v_delta bigint;
  v_event_id uuid;
begin
  if p_request_id is null then raise exception 'CONFIRMATION_REQUEST_ID_REQUIRED'; end if;
  select * into v_session from public.settlement_sessions where id=p_settlement_session_id;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if v_session.status <> 'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_settlement_session_id::text,p_summary_group_id,upper(p_category),p_code),0));

  select * into v_existing from public.allocation_confirmation_events where request_id=p_request_id limit 1;
  if found then
    return jsonb_build_object('idempotent',true,'event_id',v_existing.id,'settlement_session_id',v_existing.settlement_session_id,
      'business_date',v_existing.business_date,'summary_group_id',v_existing.summary_group_id,'category',v_existing.category,
      'code',v_existing.code,'previous_confirmed',v_existing.previous_confirmed,'confirmed_transfer',v_existing.new_confirmed,
      'delta_confirmed',v_existing.delta_confirmed,'confirmed_at',v_existing.confirmed_at);
  end if;

  select * into v_state from public.session_allocation_state
  where settlement_session_id=p_settlement_session_id and summary_group_id=p_summary_group_id
    and category=upper(p_category) and code=p_code;
  if not found then raise exception 'ALLOCATION_STATE_NOT_FOUND'; end if;

  if v_state.business_date <> p_business_date
    or v_state.order_total::bigint <> p_expected_order_total
    or v_state.threshold::integer <> p_expected_threshold
    or v_state.destination is distinct from p_expected_destination
    or v_state.should_transfer::bigint <> p_expected_should_transfer
    or v_state.confirmed_transfer::bigint <> p_expected_confirmed_transfer
    or v_state.transfer_now::bigint <> p_expected_transfer_now
  then raise exception 'ALLOCATION_STALE'; end if;

  if p_expected_transfer_now <= 0 then raise exception 'NO_TRANSFER_REQUIRED'; end if;
  v_previous := v_state.confirmed_transfer::bigint;
  v_new := v_state.should_transfer::bigint;
  v_delta := v_new-v_previous;
  if v_delta <= 0 or v_delta <> p_expected_transfer_now then raise exception 'ALLOCATION_STALE'; end if;

  insert into public.settlement_allocation_confirmations(
    settlement_session_id,business_date,summary_group_id,category,code,confirmed_transfer,confirmed_at,confirmed_by
  ) values(p_settlement_session_id,p_business_date,p_summary_group_id,upper(p_category),p_code,v_new,now(),p_confirmed_by)
  on conflict(settlement_session_id,summary_group_id,category,code)
  do update set confirmed_transfer=excluded.confirmed_transfer,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by;

  insert into public.allocation_confirmation_events(
    request_id,settlement_session_id,business_date,summary_group_id,category,code,previous_confirmed,new_confirmed,delta_confirmed,
    order_total,threshold,destination,should_transfer,confirmed_by
  ) values(p_request_id,p_settlement_session_id,p_business_date,p_summary_group_id,upper(p_category),p_code,v_previous,v_new,v_delta,
    v_state.order_total,v_state.threshold,v_state.destination,v_state.should_transfer,p_confirmed_by)
  returning id into v_event_id;

  return jsonb_build_object('idempotent',false,'event_id',v_event_id,'settlement_session_id',p_settlement_session_id,
    'business_date',p_business_date,'summary_group_id',p_summary_group_id,'category',upper(p_category),'code',p_code,
    'previous_confirmed',v_previous,'confirmed_transfer',v_new,'delta_confirmed',v_delta,'order_total',v_state.order_total,
    'threshold',v_state.threshold,'destination',v_state.destination,'should_transfer',v_state.should_transfer,'confirmed_at',now());
end;
$$;

-- Review corrections must preserve the original settlement session and cannot mutate a closed settlement.
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

alter table public.settlement_sessions enable row level security;
alter table public.settlement_line_group_config enable row level security;
alter table public.settlement_allocation_rules enable row level security;
alter table public.settlement_promotion_rules enable row level security;
alter table public.settlement_special_point_rules enable row level security;
alter table public.settlement_allocation_confirmations enable row level security;

revoke all on public.settlement_sessions from anon, authenticated;
revoke all on public.settlement_line_group_config from anon, authenticated;
revoke all on public.settlement_allocation_rules from anon, authenticated;
revoke all on public.settlement_promotion_rules from anon, authenticated;
revoke all on public.settlement_special_point_rules from anon, authenticated;
revoke all on public.settlement_allocation_confirmations from anon, authenticated;
revoke all on public.session_current_summary from anon, authenticated;
revoke all on public.session_allocation_state from anon, authenticated;

revoke all on function public.open_settlement_session(date,jsonb,text) from public,anon,authenticated;
grant execute on function public.open_settlement_session(date,jsonb,text) to service_role;
revoke all on function public.close_settlement_session(uuid,text) from public,anon,authenticated;
grant execute on function public.close_settlement_session(uuid,text) to service_role;
revoke all on function public.replace_settlement_special_points(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_settlement_special_points(uuid,jsonb) to service_role;
revoke all on function public.confirm_session_allocation_transfer_safe(uuid,uuid,date,text,text,text,bigint,integer,text,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_session_allocation_transfer_safe(uuid,uuid,date,text,text,text,bigint,integer,text,bigint,bigint,bigint,text) to service_role;
