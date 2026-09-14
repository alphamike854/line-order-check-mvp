-- MIR2C-B
-- Destination-scoped LINE Message Mirror orchestration.
--
-- Multiple source groups may feed the same destination group.
-- Therefore batching, ordering and worker leases belong to the
-- destination rather than to an individual route.
--
-- This migration does not perform LINE transport.

do $$
begin
  if exists (
    select 1
    from public.line_message_mirror_routes
  )
  or exists (
    select 1
    from public.line_message_mirror_batches
  )
  or exists (
    select 1
    from public.line_message_mirror_queue
  )
  or exists (
    select 1
    from public.line_message_mirror_route_leases
  ) then
    raise exception
      'MIRROR_DESTINATION_CUTOVER_REQUIRES_EMPTY_FOUNDATION';
  end if;
end;
$$;


-- Batch ownership moves from route -> destination.
drop index if exists
  public.line_message_mirror_batches_route_created_idx;

alter table public.line_message_mirror_batches
  drop column route_id;

create index
  line_message_mirror_batches_destination_created_idx
on public.line_message_mirror_batches (
  destination_line_group_id,
  created_at desc
);


-- FAILED is retryable and blocks overtaking.
-- CANCELLED is terminal/dead-letter and allows later work to continue.
alter table public.line_message_mirror_batches
  drop constraint line_message_mirror_batches_status_check;

alter table public.line_message_mirror_batches
  add constraint line_message_mirror_batches_status_check
  check (
    status in (
      'PREPARING',
      'SENDING',
      'SENT',
      'FAILED',
      'CANCELLED'
    )
  );

create unique index
  line_message_mirror_batches_destination_active_unique
on public.line_message_mirror_batches (
  destination_line_group_id
)
where status in (
  'PREPARING',
  'SENDING',
  'FAILED'
);


-- Route identity remains on queue rows for audit.
-- Worker ordering is destination + original event order.
create index
  line_message_mirror_queue_destination_pending_idx
on public.line_message_mirror_queue (
  destination_line_group_id,
  event_timestamp,
  id
)
where status = 'PENDING';


-- Route-level worker lease is obsolete before activation.
drop table public.line_message_mirror_route_leases;


create table public.line_message_mirror_destination_leases (
  destination_line_group_id text primary key,

  lease_token uuid not null,

  lease_expires_at timestamptz not null,

  updated_at timestamptz not null
    default now(),

  constraint
    line_message_mirror_destination_leases_expiry_check
  check (
    lease_expires_at > updated_at
  )
);

alter table
  public.line_message_mirror_destination_leases
enable row level security;

revoke all
  on table
    public.line_message_mirror_destination_leases
  from anon, authenticated;

grant all
  on table
    public.line_message_mirror_destination_leases
  to service_role;


-- Authoritative enqueue still accepts only an admitted messages row.
-- It additionally returns every destination affected by the enqueue.
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

  v_destinations text[] :=
    '{}'::text[];
begin
  if p_message_record_id is null then
    raise exception
      'MIRROR_MESSAGE_RECORD_ID_REQUIRED';
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
  into v_message
  from public.messages m
  where m.id = p_message_record_id;

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'SOURCE_MESSAGE_NOT_FOUND',
      'inserted', 0,
      'existing', 0,
      'destinations', '[]'::jsonb
    );
  end if;

  if v_message.summary_group_round_id is null then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'NOT_ADMITTED_TO_WORKING_ROUND',
      'inserted', 0,
      'existing', 0,
      'destinations', '[]'::jsonb
    );
  end if;

  if v_message.message_type not in ('text', 'image') then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'UNSUPPORTED_MESSAGE_TYPE',
      'inserted', 0,
      'existing', 0,
      'destinations', '[]'::jsonb
    );
  end if;

  if nullif(trim(v_message.webhook_event_id), '') is null then
    raise exception
      'MIRROR_WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  if nullif(trim(v_message.line_group_id), '') is null then
    raise exception
      'MIRROR_SOURCE_GROUP_REQUIRED';
  end if;

  if nullif(trim(v_message.message_id), '') is null then
    raise exception
      'MIRROR_SOURCE_MESSAGE_ID_REQUIRED';
  end if;

  if v_message.event_timestamp is null then
    raise exception
      'MIRROR_EVENT_TIMESTAMP_REQUIRED';
  end if;

  if v_message.message_type = 'text'
     and v_message.raw_text is null then
    raise exception
      'MIRROR_TEXT_PAYLOAD_REQUIRED';
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

    -- Include destination even on idempotent re-enqueue.
    -- This allows a later webhook attempt to wake stranded work.
    if not (
      v_route.destination_line_group_id
      = any(v_destinations)
    ) then
      v_destinations :=
        array_append(
          v_destinations,
          v_route.destination_line_group_id
        );
    end if;
  end loop;

  return jsonb_build_object(
    'eligible', true,
    'summary_group_round_id',
      v_message.summary_group_round_id,
    'inserted', v_inserted,
    'existing', v_existing,
    'destinations',
      to_jsonb(v_destinations)
  );
end;
$$;


-- Reserve exactly one active worker per destination.
create or replace function
  public.reserve_line_message_mirror_destination_worker(
    p_destination_line_group_id text,
    p_lease_seconds integer default 180
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destination text :=
    nullif(
      trim(p_destination_line_group_id),
      ''
    );

  v_token uuid;
  v_expires timestamptz;

  v_existing
    public.line_message_mirror_destination_leases%rowtype;

  v_has_work boolean := false;
begin
  if v_destination is null then
    raise exception
      'MIRROR_DESTINATION_REQUIRED';
  end if;

  if p_lease_seconds not between 60 and 600 then
    raise exception
      'MIRROR_INVALID_LEASE_SECONDS';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_MESSAGE_MIRROR_DESTINATION|'
      || v_destination,
      0
    )
  );

  select
    exists (
      select 1
      from public.line_message_mirror_queue q
      where q.destination_line_group_id =
        v_destination
        and q.status = 'PENDING'
    )
    or exists (
      select 1
      from public.line_message_mirror_batches b
      where b.destination_line_group_id =
        v_destination
        and b.status in (
          'PREPARING',
          'SENDING',
          'FAILED'
        )
    )
  into v_has_work;

  if not v_has_work then
    return jsonb_build_object(
      'reserved', false,
      'reason', 'NO_WORK'
    );
  end if;

  select *
  into v_existing
  from public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_destination
  for update;

  if found
     and v_existing.lease_expires_at
       > clock_timestamp() then
    return jsonb_build_object(
      'reserved', false,
      'reason', 'ACTIVE_LEASE',
      'lease_expires_at',
        v_existing.lease_expires_at
    );
  end if;

  v_token := gen_random_uuid();

  v_expires :=
    clock_timestamp()
    + make_interval(
        secs => p_lease_seconds
      );

  insert into
    public.line_message_mirror_destination_leases (
      destination_line_group_id,
      lease_token,
      lease_expires_at,
      updated_at
    )
  values (
    v_destination,
    v_token,
    v_expires,
    clock_timestamp()
  )
  on conflict (
    destination_line_group_id
  )
  do update
  set
    lease_token =
      excluded.lease_token,
    lease_expires_at =
      excluded.lease_expires_at,
    updated_at =
      excluded.updated_at;

  return jsonb_build_object(
    'reserved', true,
    'destination_line_group_id',
      v_destination,
    'lease_token', v_token,
    'lease_expires_at', v_expires
  );
end;
$$;


create or replace function
  public.renew_line_message_mirror_destination_worker(
    p_destination_line_group_id text,
    p_lease_token uuid,
    p_lease_seconds integer default 180
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer := 0;
begin
  if p_lease_seconds not between 60 and 600 then
    raise exception
      'MIRROR_INVALID_LEASE_SECONDS';
  end if;

  update
    public.line_message_mirror_destination_leases
  set
    lease_expires_at =
      clock_timestamp()
      + make_interval(
          secs => p_lease_seconds
        ),
    updated_at =
      clock_timestamp()
  where destination_line_group_id =
      p_destination_line_group_id
    and lease_token =
      p_lease_token
    and lease_expires_at >
      clock_timestamp();

  get diagnostics
    v_updated = row_count;

  return v_updated = 1;
end;
$$;


create or replace function
  public.release_line_message_mirror_destination_worker(
    p_destination_line_group_id text,
    p_lease_token uuid
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  delete from
    public.line_message_mirror_destination_leases
  where destination_line_group_id =
      p_destination_line_group_id
    and lease_token =
      p_lease_token;

  get diagnostics
    v_deleted = row_count;

  return v_deleted = 1;
end;
$$;


-- MIR2C-B PART 1 END


-- ============================================================
-- MIR2C-B PART 2
-- Destination batch claim + retry state machine.
-- ============================================================


-- Claim or resume exactly one batch for this destination.
--
-- Invariants:
--   * caller must own the live destination lease
--   * unresolved old batch always wins before new work
--   * at most five LINE message objects
--   * ordering = source event timestamp, then queue identity
--   * partial batch waits until oldest queue admission reaches
--     the effective flush window
--   * route-specific limits combine conservatively:
--       minimum max_batch_size
--       minimum flush_after_seconds
create or replace function
  public.claim_line_message_mirror_destination_batch(
    p_destination_line_group_id text,
    p_lease_token uuid
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_destination text :=
    nullif(
      trim(p_destination_line_group_id),
      ''
    );

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_batch
    public.line_message_mirror_batches%rowtype;

  v_pending_count integer := 0;

  v_oldest_created_at timestamptz;

  v_batch_size integer := 5;
  v_flush_seconds integer := 30;

  v_wait_ms integer := 0;

  v_ids bigint[];

  v_first_event timestamptz;
  v_last_event timestamptz;

  v_items jsonb :=
    '[]'::jsonb;
begin
  if v_destination is null
     or p_lease_token is null then
    raise exception
      'MIRROR_DESTINATION_LEASE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_MESSAGE_MIRROR_DESTINATION|'
      || v_destination,
      0
    )
  );

  select *
  into v_lease
  from public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_destination
  for update;

  if not found
     or v_lease.lease_token
       <> p_lease_token
     or v_lease.lease_expires_at
       <= clock_timestamp() then
    return jsonb_build_object(
      'state',
      'LEASE_NOT_OWNED'
    );
  end if;


  -- ----------------------------------------------------------
  -- Resume an unresolved old batch before touching newer rows.
  --
  -- This is required for visible ordering in the destination.
  -- FAILED remains retryable; it cannot be overtaken.
  -- ----------------------------------------------------------
  select *
  into v_batch
  from public.line_message_mirror_batches b
  where b.destination_line_group_id =
    v_destination
    and b.status in (
      'PREPARING',
      'SENDING',
      'FAILED'
    )
  order by
    b.created_at,
    b.id
  limit 1
  for update;

  if found then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',
              q.id,

            'route_id',
              q.route_id,

            'source_message_record_id',
              q.source_message_record_id,

            'summary_group_round_id',
              q.summary_group_round_id,

            'source_message_id',
              q.source_message_id,

            'source_line_group_id',
              q.source_line_group_id,

            'destination_line_group_id',
              q.destination_line_group_id,

            'message_type',
              q.message_type,

            'text_payload',
              q.text_payload,

            'event_timestamp',
              q.event_timestamp
          )
          order by
            q.event_timestamp,
            q.id
        ),
        '[]'::jsonb
      )
    into v_items
    from public.line_message_mirror_queue q
    where q.batch_id =
      v_batch.id;

    return jsonb_build_object(
      'state',
        'EXISTING',

      'batch_id',
        v_batch.id,

      'retry_key',
        v_batch.retry_key,

      'batch_status',
        v_batch.status,

      'attempt_count',
        v_batch.attempt_count,

      'destination_line_group_id',
        v_destination,

      'items',
        v_items
    );
  end if;


  -- ----------------------------------------------------------
  -- Calculate effective batching policy across every pending
  -- route feeding this destination.
  --
  -- Taking MIN means one route cannot be held longer or batched
  -- larger than its configured contract.
  -- ----------------------------------------------------------
  select
    count(*)::integer,

    min(q.created_at),

    greatest(
      1,
      least(
        5,
        coalesce(
          min(r.max_batch_size),
          5
        )
      )
    ),

    greatest(
      5,
      least(
        300,
        coalesce(
          min(r.flush_after_seconds),
          30
        )
      )
    )
  into
    v_pending_count,
    v_oldest_created_at,
    v_batch_size,
    v_flush_seconds
  from public.line_message_mirror_queue q
  join public.line_message_mirror_routes r
    on r.id =
      q.route_id
  where q.destination_line_group_id =
      v_destination
    and q.status =
      'PENDING';

  if v_pending_count = 0 then
    return jsonb_build_object(
      'state',
      'EMPTY'
    );
  end if;


  -- ----------------------------------------------------------
  -- Partial batch:
  -- wait from queue admission time, not LINE source timestamp.
  --
  -- This prevents old source timestamps from causing an
  -- immediate flush merely because delivery/enqueue was delayed.
  -- ----------------------------------------------------------
  if v_pending_count < v_batch_size
     and v_oldest_created_at
       + make_interval(
           secs => v_flush_seconds
         )
       > clock_timestamp() then

    v_wait_ms :=
      greatest(
        0,
        ceil(
          extract(
            epoch from (
              v_oldest_created_at
              + make_interval(
                  secs => v_flush_seconds
                )
              - clock_timestamp()
            )
          )
          * 1000
        )::integer
      );

    return jsonb_build_object(
      'state',
        'WAIT',

      'pending_count',
        v_pending_count,

      'batch_size',
        v_batch_size,

      'flush_after_seconds',
        v_flush_seconds,

      'wait_ms',
        v_wait_ms
    );
  end if;


  -- ----------------------------------------------------------
  -- Select and lock the oldest <= batch-size rows.
  -- event_timestamp preserves LINE source order.
  -- id deterministically breaks ties.
  -- ----------------------------------------------------------
  select
    array_agg(
      selected.id
      order by
        selected.event_timestamp,
        selected.id
    ),

    min(
      selected.event_timestamp
    ),

    max(
      selected.event_timestamp
    )
  into
    v_ids,
    v_first_event,
    v_last_event
  from (
    select
      q.id,
      q.event_timestamp
    from public.line_message_mirror_queue q
    where q.destination_line_group_id =
      v_destination
      and q.status =
        'PENDING'
    order by
      q.event_timestamp,
      q.id
    limit v_batch_size
    for update
  ) selected;

  if coalesce(
    cardinality(v_ids),
    0
  ) = 0 then
    return jsonb_build_object(
      'state',
      'EMPTY'
    );
  end if;


  -- retry_key is generated here, before any future network send.
  -- Every retry of this batch therefore reuses the same key.
  insert into
    public.line_message_mirror_batches (
      destination_line_group_id,
      item_count,
      status,
      first_event_timestamp,
      last_event_timestamp
    )
  values (
    v_destination,
    cardinality(v_ids),
    'PREPARING',
    v_first_event,
    v_last_event
  )
  returning *
  into v_batch;


  update
    public.line_message_mirror_queue
  set
    status =
      'CLAIMED',

    batch_id =
      v_batch.id,

    claim_token =
      p_lease_token,

    claimed_at =
      clock_timestamp(),

    attempt_count =
      attempt_count + 1,

    last_error =
      null
  where id =
    any(v_ids);


  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',
            q.id,

          'route_id',
            q.route_id,

          'source_message_record_id',
            q.source_message_record_id,

          'summary_group_round_id',
            q.summary_group_round_id,

          'source_message_id',
            q.source_message_id,

          'source_line_group_id',
            q.source_line_group_id,

          'destination_line_group_id',
            q.destination_line_group_id,

          'message_type',
            q.message_type,

          'text_payload',
            q.text_payload,

          'event_timestamp',
            q.event_timestamp
        )
        order by
          q.event_timestamp,
          q.id
      ),
      '[]'::jsonb
    )
  into v_items
  from public.line_message_mirror_queue q
  where q.batch_id =
    v_batch.id;


  return jsonb_build_object(
    'state',
      'CLAIMED',

    'batch_id',
      v_batch.id,

    'retry_key',
      v_batch.retry_key,

    'batch_status',
      v_batch.status,

    'attempt_count',
      v_batch.attempt_count,

    'destination_line_group_id',
      v_destination,

    'batch_size',
      v_batch_size,

    'flush_after_seconds',
      v_flush_seconds,

    'items',
      v_items
  );
end;
$$;


-- ------------------------------------------------------------
-- Transition a claimed batch into SENDING.
--
-- A crashed worker may leave status=SENDING.
-- A later worker is allowed to begin another attempt using the
-- same persisted retry_key.
-- ------------------------------------------------------------
create or replace function
  public.begin_line_message_mirror_batch_attempt(
    p_batch_id uuid,
    p_lease_token uuid
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;
begin
  if p_batch_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_BATCH_ATTEMPT_ARGUMENT_REQUIRED';
  end if;

  select *
  into v_batch
  from public.line_message_mirror_batches
  where id =
    p_batch_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'BATCH_NOT_FOUND'
    );
  end if;


  select *
  into v_lease
  from public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_batch.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
       <> p_lease_token
     or v_lease.lease_expires_at
       <= clock_timestamp() then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'LEASE_NOT_OWNED'
    );
  end if;


  if v_batch.status =
     'SENT' then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'ALREADY_SENT'
    );
  end if;


  if v_batch.status =
     'CANCELLED' then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'BATCH_CANCELLED'
    );
  end if;


  update
    public.line_message_mirror_batches
  set
    status =
      'SENDING',

    attempt_count =
      attempt_count + 1,

    last_error =
      null
  where id =
    p_batch_id
    and status in (
      'PREPARING',
      'SENDING',
      'FAILED'
    )
  returning *
  into v_batch;


  if not found then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'INVALID_BATCH_STATE'
    );
  end if;


  return jsonb_build_object(
    'ok',
      true,

    'batch_id',
      v_batch.id,

    'retry_key',
      v_batch.retry_key,

    'attempt_count',
      v_batch.attempt_count,

    'destination_line_group_id',
      v_batch.destination_line_group_id
  );
end;
$$;


-- ------------------------------------------------------------
-- Retryable transport/media failure.
--
-- FAILED remains unresolved and therefore continues to block
-- later batches for the same destination until retried or
-- explicitly dead-lettered.
-- ------------------------------------------------------------
create or replace function
  public.fail_line_message_mirror_batch(
    p_batch_id uuid,
    p_lease_token uuid,
    p_error text
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer := 0;
begin
  if p_batch_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_BATCH_FAILURE_ARGUMENT_REQUIRED';
  end if;

  update
    public.line_message_mirror_batches b
  set
    status =
      'FAILED',

    last_error =
      left(
        coalesce(
          nullif(
            trim(p_error),
            ''
          ),
          'UNKNOWN_MIRROR_SEND_FAILURE'
        ),
        2000
      )
  from
    public.line_message_mirror_destination_leases l
  where b.id =
      p_batch_id

    and l.destination_line_group_id =
      b.destination_line_group_id

    and l.lease_token =
      p_lease_token

    and l.lease_expires_at >
      clock_timestamp()

    and b.status in (
      'PREPARING',
      'SENDING',
      'FAILED'
    );

  get diagnostics
    v_updated = row_count;

  if v_updated = 1 then
    update
      public.line_message_mirror_queue q
    set
      last_error =
        left(
          coalesce(
            nullif(
              trim(p_error),
              ''
            ),
            'UNKNOWN_MIRROR_SEND_FAILURE'
          ),
          2000
        )
    where q.batch_id =
      p_batch_id
      and q.status =
        'CLAIMED';
  end if;

  return v_updated = 1;
end;
$$;


-- MIR2C-B PART 2A END


-- ============================================================
-- MIR2C-B PART 2B
-- Successful completion + permanent dead-letter transitions.
-- ============================================================


-- ------------------------------------------------------------
-- Mark a LINE Push batch successfully delivered.
--
-- Normal path:
--   PREPARING -> begin attempt -> SENDING -> SENT
--
-- Retry path:
--   FAILED -> begin attempt -> SENDING -> SENT
--
-- Network transport must only call this after it has positive
-- evidence that LINE accepted the request.
--
-- An already-SENT batch is idempotently successful.
-- ------------------------------------------------------------
create or replace function
  public.complete_line_message_mirror_batch(
    p_batch_id uuid,
    p_lease_token uuid,
    p_line_request_id text default null
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_claimed_count integer := 0;
begin
  if p_batch_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_BATCH_COMPLETE_ARGUMENT_REQUIRED';
  end if;


  select *
  into v_batch
  from public.line_message_mirror_batches
  where id =
    p_batch_id
  for update;

  if not found then
    return false;
  end if;


  select *
  into v_lease
  from public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_batch.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
       <> p_lease_token
     or v_lease.lease_expires_at
       <= clock_timestamp() then
    return false;
  end if;


  -- Idempotent completion.
  if v_batch.status = 'SENT' then
    return true;
  end if;


  if v_batch.status <> 'SENDING' then
    return false;
  end if;


  -- Fail closed if the batch and its queue membership diverged.
  select
    count(*)::integer
  into
    v_claimed_count
  from public.line_message_mirror_queue q
  where q.batch_id =
      p_batch_id
    and q.status =
      'CLAIMED';

  if v_claimed_count
     <> v_batch.item_count then
    raise exception
      'MIRROR_BATCH_ITEM_STATE_MISMATCH';
  end if;


  update
    public.line_message_mirror_queue
  set
    status =
      'SENT',

    sent_at =
      clock_timestamp(),

    claim_token =
      null,

    last_error =
      null
  where batch_id =
      p_batch_id
    and status =
      'CLAIMED';


  update
    public.line_message_mirror_batches
  set
    status =
      'SENT',

    line_request_id =
      nullif(
        trim(p_line_request_id),
        ''
      ),

    last_error =
      null,

    sent_at =
      clock_timestamp()
  where id =
    p_batch_id
    and status =
      'SENDING';

  if not found then
    raise exception
      'MIRROR_BATCH_COMPLETE_STATE_CHANGED';
  end if;


  return true;
end;
$$;


-- ------------------------------------------------------------
-- Permanent dead-letter / cancellation.
--
-- Use ONLY when the worker has deterministic evidence that this
-- batch cannot be delivered and was NOT accepted by LINE.
--
-- Examples:
--   * permanently unsupported media
--   * unrecoverable media preparation failure
--   * deterministic non-retryable LINE rejection
--
-- DO NOT call this for:
--   * timeout
--   * connection reset
--   * ambiguous network result
--   * retryable 5xx / provider failure
--
-- Those remain FAILED and retry with the same retry_key.
--
-- CANCELLED is terminal and no longer blocks newer destination
-- batches, while preserving audit rows.
-- ------------------------------------------------------------
create or replace function
  public.cancel_line_message_mirror_batch(
    p_batch_id uuid,
    p_lease_token uuid,
    p_reason text
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_claimed_count integer := 0;

  v_reason text :=
    left(
      coalesce(
        nullif(
          trim(p_reason),
          ''
        ),
        'PERMANENT_MIRROR_DELIVERY_FAILURE'
      ),
      2000
    );
begin
  if p_batch_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_BATCH_CANCEL_ARGUMENT_REQUIRED';
  end if;


  select *
  into v_batch
  from public.line_message_mirror_batches
  where id =
    p_batch_id
  for update;

  if not found then
    return false;
  end if;


  select *
  into v_lease
  from public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_batch.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
       <> p_lease_token
     or v_lease.lease_expires_at
       <= clock_timestamp() then
    return false;
  end if;


  if v_batch.status = 'SENT' then
    return false;
  end if;


  -- Idempotent terminal cancellation.
  if v_batch.status = 'CANCELLED' then
    return true;
  end if;


  if v_batch.status not in (
    'PREPARING',
    'SENDING',
    'FAILED'
  ) then
    return false;
  end if;


  select
    count(*)::integer
  into
    v_claimed_count
  from public.line_message_mirror_queue q
  where q.batch_id =
      p_batch_id
    and q.status =
      'CLAIMED';

  if v_claimed_count
     <> v_batch.item_count then
    raise exception
      'MIRROR_BATCH_ITEM_STATE_MISMATCH';
  end if;


  update
    public.line_message_mirror_queue
  set
    status =
      'CANCELLED',

    claim_token =
      null,

    last_error =
      v_reason
  where batch_id =
      p_batch_id
    and status =
      'CLAIMED';


  update
    public.line_message_mirror_batches
  set
    status =
      'CANCELLED',

    last_error =
      v_reason
  where id =
      p_batch_id
    and status in (
      'PREPARING',
      'SENDING',
      'FAILED'
    );

  if not found then
    raise exception
      'MIRROR_BATCH_CANCEL_STATE_CHANGED';
  end if;


  return true;
end;
$$;


-- ============================================================
-- RPC privilege boundary.
--
-- Every orchestration mutation remains service-role only.
-- No browser/anon/authenticated user can reserve, claim,
-- complete, retry or dead-letter Mirror delivery.
-- ============================================================


revoke all
  on function
    public.enqueue_line_message_mirror(
      uuid
    )
  from public, anon, authenticated;

revoke all
  on function
    public.reserve_line_message_mirror_destination_worker(
      text,
      integer
    )
  from public, anon, authenticated;

revoke all
  on function
    public.renew_line_message_mirror_destination_worker(
      text,
      uuid,
      integer
    )
  from public, anon, authenticated;

revoke all
  on function
    public.release_line_message_mirror_destination_worker(
      text,
      uuid
    )
  from public, anon, authenticated;

revoke all
  on function
    public.claim_line_message_mirror_destination_batch(
      text,
      uuid
    )
  from public, anon, authenticated;

revoke all
  on function
    public.begin_line_message_mirror_batch_attempt(
      uuid,
      uuid
    )
  from public, anon, authenticated;

revoke all
  on function
    public.fail_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  from public, anon, authenticated;

revoke all
  on function
    public.complete_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  from public, anon, authenticated;

revoke all
  on function
    public.cancel_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  from public, anon, authenticated;


grant execute
  on function
    public.enqueue_line_message_mirror(
      uuid
    )
  to service_role;

grant execute
  on function
    public.reserve_line_message_mirror_destination_worker(
      text,
      integer
    )
  to service_role;

grant execute
  on function
    public.renew_line_message_mirror_destination_worker(
      text,
      uuid,
      integer
    )
  to service_role;

grant execute
  on function
    public.release_line_message_mirror_destination_worker(
      text,
      uuid
    )
  to service_role;

grant execute
  on function
    public.claim_line_message_mirror_destination_batch(
      text,
      uuid
    )
  to service_role;

grant execute
  on function
    public.begin_line_message_mirror_batch_attempt(
      uuid,
      uuid
    )
  to service_role;

grant execute
  on function
    public.fail_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  to service_role;

grant execute
  on function
    public.complete_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  to service_role;

grant execute
  on function
    public.cancel_line_message_mirror_batch(
      uuid,
      uuid,
      text
    )
  to service_role;


-- MIR2C-B COMPLETE DRAFT END
