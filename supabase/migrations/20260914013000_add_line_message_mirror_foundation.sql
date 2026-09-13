-- MIR2A / MIR2B-R1
-- Transparent LINE Message Mirror foundation.
--
-- Authoritative admission rule:
-- Mirror only messages that were successfully admitted into a
-- Summary Group Working Round.
--
-- summary_group_round_id on public.messages is the immutable proof
-- that the message crossed the OPEN Round admission boundary.
--
-- CLOSED / NOT_STARTED / unconfigured messages are therefore not
-- mirror-eligible.
--
-- Safety invariants:
-- 1. Feature disabled by default.
-- 2. No trigger on messages/order_items/review flow.
-- 3. Mirror transport state isolated from order-processing state.
-- 4. TEXT and IMAGE only in v1.
-- 5. One LINE Push request <= 5 message objects.
-- 6. Enqueue idempotent per route + webhook event.
-- 7. Mirror enqueue uses authoritative messages row, not browser/event
--    claims about Round ownership.

create table public.line_message_mirror_routes (
  id uuid primary key default gen_random_uuid(),

  source_line_group_id text not null,
  destination_line_group_id text not null,

  enabled boolean not null default false,

  max_batch_size smallint not null default 5,
  flush_after_seconds integer not null default 30,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint line_message_mirror_routes_source_destination_unique
    unique (
      source_line_group_id,
      destination_line_group_id
    ),

  constraint line_message_mirror_routes_not_self
    check (
      source_line_group_id
      <> destination_line_group_id
    ),

  constraint line_message_mirror_routes_batch_size_check
    check (
      max_batch_size between 1 and 5
    ),

  constraint line_message_mirror_routes_flush_seconds_check
    check (
      flush_after_seconds between 5 and 300
    )
);

create index line_message_mirror_routes_source_enabled_idx
  on public.line_message_mirror_routes (
    source_line_group_id,
    enabled
  );


create table public.line_message_mirror_batches (
  id uuid primary key default gen_random_uuid(),

  route_id uuid not null
    references public.line_message_mirror_routes(id)
    on delete cascade,

  destination_line_group_id text not null,

  retry_key uuid not null default gen_random_uuid(),

  item_count smallint not null,

  status text not null default 'PREPARING',

  attempt_count integer not null default 0,

  first_event_timestamp timestamptz not null,
  last_event_timestamp timestamptz not null,

  line_request_id text,
  last_error text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,

  constraint line_message_mirror_batches_retry_key_unique
    unique (retry_key),

  constraint line_message_mirror_batches_item_count_check
    check (
      item_count between 1 and 5
    ),

  constraint line_message_mirror_batches_status_check
    check (
      status in (
        'PREPARING',
        'SENDING',
        'SENT',
        'FAILED'
      )
    ),

  constraint line_message_mirror_batches_attempt_count_check
    check (
      attempt_count >= 0
    ),

  constraint line_message_mirror_batches_event_order_check
    check (
      last_event_timestamp >= first_event_timestamp
    )
);

create index line_message_mirror_batches_route_created_idx
  on public.line_message_mirror_batches (
    route_id,
    created_at desc
  );


create table public.line_message_mirror_queue (
  id bigint generated always as identity primary key,

  route_id uuid not null
    references public.line_message_mirror_routes(id)
    on delete cascade,

  -- Deliberately not FK to messages.
  -- Operational message rows can be purged when a later Round opens,
  -- while mirror delivery audit should remain independently durable.
  source_message_record_id uuid not null,

  -- Round rows are historical/durable and are the authoritative
  -- admission ownership for this mirror item.
  summary_group_round_id uuid not null
    references public.settlement_summary_group_rounds(id)
    on delete restrict,

  webhook_event_id text not null,
  source_message_id text not null,

  source_line_group_id text not null,
  destination_line_group_id text not null,

  message_type text not null,
  text_payload text,

  event_timestamp timestamptz not null,

  status text not null default 'PENDING',

  batch_id uuid
    references public.line_message_mirror_batches(id)
    on delete set null,

  claim_token uuid,
  claimed_at timestamptz,

  attempt_count integer not null default 0,
  last_error text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,

  constraint line_message_mirror_queue_route_event_unique
    unique (
      route_id,
      webhook_event_id
    ),

  constraint line_message_mirror_queue_message_type_check
    check (
      message_type in (
        'text',
        'image'
      )
    ),

  constraint line_message_mirror_queue_payload_check
    check (
      (
        message_type = 'text'
        and text_payload is not null
      )
      or
      (
        message_type = 'image'
        and text_payload is null
      )
    ),

  constraint line_message_mirror_queue_status_check
    check (
      status in (
        'PENDING',
        'CLAIMED',
        'SENT',
        'FAILED',
        'CANCELLED'
      )
    ),

  constraint line_message_mirror_queue_attempt_count_check
    check (
      attempt_count >= 0
    )
);

create index line_message_mirror_queue_pending_idx
  on public.line_message_mirror_queue (
    route_id,
    event_timestamp,
    id
  )
  where status = 'PENDING';

create index line_message_mirror_queue_round_idx
  on public.line_message_mirror_queue (
    summary_group_round_id,
    event_timestamp,
    id
  );

create index line_message_mirror_queue_batch_idx
  on public.line_message_mirror_queue (
    batch_id
  )
  where batch_id is not null;


create table public.line_message_mirror_route_leases (
  route_id uuid primary key
    references public.line_message_mirror_routes(id)
    on delete cascade,

  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),

  constraint line_message_mirror_route_leases_expiry_check
    check (
      lease_expires_at > updated_at
    )
);


-- Enqueue from an authoritative admitted public.messages row.
--
-- The caller supplies only the message-record UUID.
-- Source group, LINE message id, raw text, event timestamp and
-- Round ownership are read back from the database.
create or replace function public.enqueue_line_message_mirror(
  p_message_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message record;
  v_route record;

  v_inserted integer := 0;
  v_existing integer := 0;
begin
  if p_message_record_id is null then
    raise exception 'MIRROR_MESSAGE_RECORD_ID_REQUIRED';
  end if;

  select
    m.id,
    m.webhook_event_id,
    m.message_id,
    m.line_group_id,
    m.message_type,
    m.raw_text,
    m.event_timestamp,
    m.summary_group_round_id
  into
    v_message
  from public.messages m
  where m.id = p_message_record_id;

  if not found then
    return jsonb_build_object(
      'eligible',
      false,
      'reason',
      'SOURCE_MESSAGE_NOT_FOUND',
      'inserted',
      0,
      'existing',
      0
    );
  end if;

  -- This is the core Round admission boundary.
  --
  -- A successful current-generation message admission owns a
  -- Summary Group Round. A CLOSED / NOT_STARTED rejection has no
  -- admitted row and therefore can never reach this state.
  if v_message.summary_group_round_id is null then
    return jsonb_build_object(
      'eligible',
      false,
      'reason',
      'NOT_ADMITTED_TO_WORKING_ROUND',
      'inserted',
      0,
      'existing',
      0
    );
  end if;

  if v_message.message_type not in ('text', 'image') then
    return jsonb_build_object(
      'eligible',
      false,
      'reason',
      'UNSUPPORTED_MESSAGE_TYPE',
      'inserted',
      0,
      'existing',
      0
    );
  end if;

  if nullif(trim(v_message.webhook_event_id), '') is null then
    raise exception 'MIRROR_WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  if nullif(trim(v_message.line_group_id), '') is null then
    raise exception 'MIRROR_SOURCE_GROUP_REQUIRED';
  end if;

  if nullif(trim(v_message.message_id), '') is null then
    raise exception 'MIRROR_SOURCE_MESSAGE_ID_REQUIRED';
  end if;

  if v_message.event_timestamp is null then
    raise exception 'MIRROR_EVENT_TIMESTAMP_REQUIRED';
  end if;

  if v_message.message_type = 'text'
     and v_message.raw_text is null then
    raise exception 'MIRROR_TEXT_PAYLOAD_REQUIRED';
  end if;

  for v_route in
    select
      route.id,
      route.source_line_group_id,
      route.destination_line_group_id
    from public.line_message_mirror_routes route
    where route.enabled = true
      and route.source_line_group_id =
        v_message.line_group_id
    order by
      route.created_at,
      route.id
  loop
    insert into public.line_message_mirror_queue (
      route_id,
      source_message_record_id,
      summary_group_round_id,
      webhook_event_id,
      source_message_id,
      source_line_group_id,
      destination_line_group_id,
      message_type,
      text_payload,
      event_timestamp
    )
    values (
      v_route.id,
      v_message.id,
      v_message.summary_group_round_id,
      v_message.webhook_event_id,
      v_message.message_id,
      v_route.source_line_group_id,
      v_route.destination_line_group_id,
      v_message.message_type,
      case
        when v_message.message_type = 'text'
          then v_message.raw_text
        else null
      end,
      v_message.event_timestamp
    )
    on conflict (
      route_id,
      webhook_event_id
    )
    do nothing;

    if found then
      v_inserted := v_inserted + 1;
    else
      v_existing := v_existing + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'eligible',
    true,
    'summary_group_round_id',
    v_message.summary_group_round_id,
    'inserted',
    v_inserted,
    'existing',
    v_existing
  );
end;
$$;


alter table public.line_message_mirror_routes
  enable row level security;

alter table public.line_message_mirror_batches
  enable row level security;

alter table public.line_message_mirror_queue
  enable row level security;

alter table public.line_message_mirror_route_leases
  enable row level security;


revoke all
  on table public.line_message_mirror_routes
  from anon, authenticated;

revoke all
  on table public.line_message_mirror_batches
  from anon, authenticated;

revoke all
  on table public.line_message_mirror_queue
  from anon, authenticated;

revoke all
  on table public.line_message_mirror_route_leases
  from anon, authenticated;

revoke all
  on sequence public.line_message_mirror_queue_id_seq
  from anon, authenticated;


grant all
  on table public.line_message_mirror_routes
  to service_role;

grant all
  on table public.line_message_mirror_batches
  to service_role;

grant all
  on table public.line_message_mirror_queue
  to service_role;

grant all
  on table public.line_message_mirror_route_leases
  to service_role;

grant usage, select
  on sequence public.line_message_mirror_queue_id_seq
  to service_role;


revoke all
  on function public.enqueue_line_message_mirror(uuid)
  from public, anon, authenticated;

grant execute
  on function public.enqueue_line_message_mirror(uuid)
  to service_role;
