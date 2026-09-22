-- Export Preparation Phase 2E
--
-- READY -> delivery reservation -> LINE acknowledgement -> SENT
--
-- SENT is never written before positive LINE acceptance.
-- Timeout / 5xx / ambiguous network state retains the reservation
-- and keeps the cycle READY.
--
-- This foundation performs no LINE HTTP request itself.

begin;


-- ============================================================
-- 1. Transport-time snapshot
-- ============================================================

alter table
  public.settlement_export_items
add column if not exists
  transport_current_effective_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  transport_prior_sent_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  transport_prior_reserved_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  transport_available_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  transport_validated_at timestamptz;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where
      conname =
        'settlement_export_items_transport_snapshot_check'
      and conrelid =
        'public.settlement_export_items'::regclass
  ) then

    alter table
      public.settlement_export_items
    add constraint
      settlement_export_items_transport_snapshot_check
    check (
      (
        transport_current_effective_quantity is null
        and transport_prior_sent_quantity is null
        and transport_prior_reserved_quantity is null
        and transport_available_quantity is null
        and transport_validated_at is null
      )
      or
      (
        transport_current_effective_quantity >= 0
        and transport_prior_sent_quantity >= 0
        and transport_prior_reserved_quantity >= 0
        and transport_available_quantity >= 0
        and transport_validated_at is not null
        and transport_available_quantity =
          greatest(
            transport_current_effective_quantity
            - transport_prior_sent_quantity
            - transport_prior_reserved_quantity,
            0
          )
      )
    );

  end if;
end
$$;


-- ============================================================
-- 2. One durable delivery identity per Export cycle
-- ============================================================

create table if not exists
  public.settlement_export_deliveries (
    cycle_id uuid primary key
      references public.settlement_export_cycles(id)
      on delete cascade,

    summary_group_round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    destination_line_group_id text not null,

    messages jsonb not null,

    payload_hash text not null,

    line_retry_key uuid not null unique,

    retry_key_started_at timestamptz not null,

    status text not null
      check (
        status in (
          'SENDING',
          'RETRYABLE',
          'AMBIGUOUS',
          'FAILED',
          'ACKNOWLEDGED'
        )
      ),

    attempt_count integer not null default 0
      check (attempt_count >= 0),

    lease_token uuid,
    lease_expires_at timestamptz,

    first_attempt_at timestamptz,
    last_attempt_at timestamptz,

    acknowledged_at timestamptz,

    line_request_id text,
    line_accepted_request_id text,

    last_http_status integer,
    last_error text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (
      payload_hash ~ '^[0-9a-f]{32}$'
    ),

    check (
      jsonb_typeof(messages) = 'array'
      and jsonb_array_length(messages) between 1 and 5
    )
  );


create index if not exists
  settlement_export_deliveries_round_status_idx
on
  public.settlement_export_deliveries (
    summary_group_round_id,
    status
  );


-- ============================================================
-- 3. Active reservation read model
-- ============================================================

create or replace view
  public.settlement_export_reserved_totals
as
select
  d.summary_group_round_id,
  i.category,
  i.code,
  sum(
    i.selected_send_quantity
  )::bigint
    as reserved_quantity
from
  public.settlement_export_deliveries d
join
  public.settlement_export_items i
    on i.cycle_id = d.cycle_id
where
  d.status in (
    'SENDING',
    'RETRYABLE',
    'AMBIGUOUS'
  )
group by
  d.summary_group_round_id,
  i.category,
  i.code;


-- ============================================================
-- 4. Begin/retry delivery
-- ============================================================

create or replace function
  public.begin_export_preparation_delivery(
    p_cycle_id uuid,
    p_expected_summary_group_round_id uuid,
    p_messages jsonb,
    p_operator text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_cycle
    public.settlement_export_cycles%rowtype;

  v_delivery
    public.settlement_export_deliveries%rowtype;

  v_item
    public.settlement_export_items%rowtype;

  v_snapshot jsonb;
  v_risk_row jsonb;
  v_message jsonb;

  v_payload_hash text;

  v_current bigint;
  v_prior_sent bigint;
  v_prior_reserved bigint;
  v_available bigint;

  v_item_count integer := 0;

  v_lease_token uuid;
  v_now timestamptz :=
    clock_timestamp();

begin

  if p_cycle_id is null then
    raise exception
      'EXPORT_CYCLE_ID_REQUIRED';
  end if;

  if p_expected_summary_group_round_id is null then
    raise exception
      'EXPORT_ROUND_REQUIRED';
  end if;

  if
    p_messages is null
    or jsonb_typeof(p_messages) <> 'array'
    or jsonb_array_length(p_messages) < 1
    or jsonb_array_length(p_messages) > 5
  then
    raise exception
      'EXPORT_DELIVERY_MESSAGES_INVALID';
  end if;


  for v_message in
    select value
    from jsonb_array_elements(p_messages)
  loop

    if
      jsonb_typeof(v_message) <> 'object'
      or v_message ->> 'type' <> 'text'
      or length(
        coalesce(
          v_message ->> 'text',
          ''
        )
      ) < 1
      or length(
        coalesce(
          v_message ->> 'text',
          ''
        )
      ) > 5000
    then
      raise exception
        'EXPORT_DELIVERY_MESSAGES_INVALID';
    end if;

  end loop;


  v_payload_hash :=
    md5(
      p_messages::text
    );


  /*
   * Round is the global serialization boundary for:
   *   - new transport reservations
   *   - final SENT transitions
   */
  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      p_expected_summary_group_round_id
  for update;


  if not found then
    raise exception
      'EXPORT_ROUND_NOT_FOUND';
  end if;


  if v_round.status <> 'OPEN' then
    raise exception
      'EXPORT_ROUND_NOT_OPEN';
  end if;


  select
    c.*
  into
    v_cycle
  from
    public.settlement_export_cycles c
  where
    c.id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_CYCLE_NOT_FOUND';
  end if;


  if
    v_cycle.summary_group_round_id
    <>
    p_expected_summary_group_round_id
  then
    raise exception
      'EXPORT_PREPARATION_STALE_ROUND';
  end if;


  /*
   * An acknowledged cycle is already terminal.
   */
  select
    d.*
  into
    v_delivery
  from
    public.settlement_export_deliveries d
  where
    d.cycle_id =
      p_cycle_id
  for update;


  if found then

    if
      v_delivery.payload_hash
      <>
      v_payload_hash

      or v_delivery.destination_line_group_id
      <>
      v_cycle.destination_line_group_id
    then
      raise exception
        'EXPORT_DELIVERY_PAYLOAD_CONFLICT';
    end if;


    if v_delivery.status = 'ACKNOWLEDGED' then

      if v_cycle.status <> 'SENT' then
        raise exception
          'EXPORT_DELIVERY_ACK_STATE_INVALID';
      end if;

      return jsonb_build_object(
        'ok', true,
        'send_needed', false,
        'idempotent_replay', true,
        'delivery', to_jsonb(v_delivery)
      );

    end if;


    if v_cycle.status <> 'READY' then
      raise exception
        'EXPORT_CYCLE_NOT_READY';
    end if;


    if v_delivery.status = 'FAILED' then
      raise exception
        'EXPORT_DELIVERY_TERMINAL_FAILURE';
    end if;


    /*
     * LINE retry-key retention is 24 hours.
     * Fail closed at 23 hours rather than risk duplicate delivery.
     */
    if
      v_now
      >=
      v_delivery.retry_key_started_at
      + interval '23 hours'
    then
      raise exception
        'EXPORT_DELIVERY_RETRY_WINDOW_EXPIRED';
    end if;


    if
      v_delivery.status = 'SENDING'
      and v_delivery.lease_expires_at is not null
      and v_delivery.lease_expires_at > v_now
    then
      raise exception
        'EXPORT_DELIVERY_BUSY';
    end if;


    v_lease_token :=
      gen_random_uuid();


    update
      public.settlement_export_deliveries
    set
      status =
        'SENDING',

      attempt_count =
        attempt_count + 1,

      lease_token =
        v_lease_token,

      lease_expires_at =
        v_now + interval '2 minutes',

      last_attempt_at =
        v_now,

      updated_at =
        v_now
    where
      cycle_id =
        p_cycle_id
    returning *
    into
      v_delivery;


    return jsonb_build_object(
      'ok', true,
      'send_needed', true,
      'idempotent_replay', true,
      'lease_token', v_lease_token,
      'delivery', to_jsonb(v_delivery)
    );

  end if;


  if v_cycle.status <> 'READY' then
    raise exception
      'EXPORT_CYCLE_NOT_READY';
  end if;


  if
    nullif(
      trim(
        coalesce(
          v_cycle.destination_line_group_id,
          ''
        )
      ),
      ''
    )
    is null

    or v_cycle.ready_at is null
  then
    raise exception
      'EXPORT_READY_STATE_INVALID';
  end if;


  /*
   * Canonical current truth at the point immediately BEFORE
   * external transport begins.
   */
  select
    public.dashboard_risk_snapshot(
      v_round.settlement_session_id,
      v_round.summary_group_id
    )
  into
    v_snapshot;


  if
    v_snapshot is null
    or jsonb_typeof(v_snapshot) <> 'object'
    or jsonb_typeof(
      v_snapshot -> 'risk_codes'
    ) <> 'array'
  then
    raise exception
      'EXPORT_RISK_SNAPSHOT_INVALID';
  end if;


  for v_item in

    select
      i.*
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        p_cycle_id
    order by
      i.category,
      i.code

  loop

    v_item_count :=
      v_item_count + 1;


    v_risk_row := null;

    select
      x.value
    into
      v_risk_row
    from
      jsonb_array_elements(
        v_snapshot -> 'risk_codes'
      ) x(value)
    where
      x.value
        ->> 'summary_group_id'
          =
        v_round.summary_group_id

      and upper(
        x.value
          ->> 'category'
      ) =
        v_item.category

      and x.value
        ->> 'code'
          =
        v_item.code
    limit 1;


    if found then
      begin
        v_current :=
          coalesce(
            (
              v_risk_row
                ->> 'order_total'
            )::bigint,
            0
          );
      exception
        when others then
          raise exception
            'EXPORT_CURRENT_QUANTITY_INVALID';
      end;
    else
      v_current := 0;
    end if;


    if v_current < 0 then
      raise exception
        'EXPORT_CURRENT_QUANTITY_INVALID';
    end if;


    select
      s.sent_cumulative_quantity
    into
      v_prior_sent
    from
      public.settlement_export_sent_totals s
    where
      s.summary_group_round_id =
        p_expected_summary_group_round_id
      and s.category =
        v_item.category
      and s.code =
        v_item.code;


    if not found then
      v_prior_sent := 0;
    end if;


    select
      r.reserved_quantity
    into
      v_prior_reserved
    from
      public.settlement_export_reserved_totals r
    where
      r.summary_group_round_id =
        p_expected_summary_group_round_id
      and r.category =
        v_item.category
      and r.code =
        v_item.code;


    if not found then
      v_prior_reserved := 0;
    end if;


    v_prior_sent :=
      coalesce(
        v_prior_sent,
        0
      );

    v_prior_reserved :=
      coalesce(
        v_prior_reserved,
        0
      );


    v_available :=
      greatest(
        v_current
        - v_prior_sent
        - v_prior_reserved,
        0
      );


    if
      v_item.selected_send_quantity
      >
      v_available
    then
      raise exception
        'EXPORT_TRANSPORT_STALE_AVAILABILITY';
    end if;


    update
      public.settlement_export_items
    set
      transport_current_effective_quantity =
        v_current,

      transport_prior_sent_quantity =
        v_prior_sent,

      transport_prior_reserved_quantity =
        v_prior_reserved,

      transport_available_quantity =
        v_available,

      transport_validated_at =
        v_now
    where
      cycle_id =
        p_cycle_id
      and category =
        v_item.category
      and code =
        v_item.code;

  end loop;


  if v_item_count < 1 then
    raise exception
      'EXPORT_CYCLE_HAS_NO_ITEMS';
  end if;


  v_lease_token :=
    gen_random_uuid();


  insert into
    public.settlement_export_deliveries (
      cycle_id,
      summary_group_round_id,
      destination_line_group_id,
      messages,
      payload_hash,
      line_retry_key,
      retry_key_started_at,
      status,
      attempt_count,
      lease_token,
      lease_expires_at,
      first_attempt_at,
      last_attempt_at
    )
  values (
    p_cycle_id,
    p_expected_summary_group_round_id,
    v_cycle.destination_line_group_id,
    p_messages,
    v_payload_hash,
    gen_random_uuid(),
    v_now,
    'SENDING',
    1,
    v_lease_token,
    v_now + interval '2 minutes',
    v_now,
    v_now
  )
  returning *
  into
    v_delivery;


  return jsonb_build_object(
    'ok', true,
    'send_needed', true,
    'idempotent_replay', false,
    'lease_token', v_lease_token,
    'delivery', to_jsonb(v_delivery)
  );

end;
$$;


-- ============================================================
-- 5. Record non-accepted transport result
-- ============================================================

create or replace function
  public.record_export_preparation_delivery_result(
    p_cycle_id uuid,
    p_expected_summary_group_round_id uuid,
    p_lease_token uuid,
    p_result text,
    p_http_status integer default null,
    p_line_request_id text default null,
    p_error text default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_cycle
    public.settlement_export_cycles%rowtype;

  v_delivery
    public.settlement_export_deliveries%rowtype;

  v_now timestamptz :=
    clock_timestamp();

begin

  if p_result not in (
    'RETRYABLE',
    'AMBIGUOUS',
    'FAILED'
  ) then
    raise exception
      'EXPORT_DELIVERY_RESULT_INVALID';
  end if;


  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      p_expected_summary_group_round_id
  for update;


  if not found then
    raise exception
      'EXPORT_ROUND_NOT_FOUND';
  end if;


  select
    c.*
  into
    v_cycle
  from
    public.settlement_export_cycles c
  where
    c.id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_CYCLE_NOT_FOUND';
  end if;


  if
    v_cycle.summary_group_round_id
    <>
    p_expected_summary_group_round_id
  then
    raise exception
      'EXPORT_PREPARATION_STALE_ROUND';
  end if;


  select
    d.*
  into
    v_delivery
  from
    public.settlement_export_deliveries d
  where
    d.cycle_id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_DELIVERY_NOT_FOUND';
  end if;


  if
    v_delivery.status <> 'SENDING'
    or v_delivery.lease_token
       is distinct from
       p_lease_token
  then
    raise exception
      'EXPORT_DELIVERY_LEASE_MISMATCH';
  end if;


  if v_cycle.status <> 'READY' then
    raise exception
      'EXPORT_CYCLE_NOT_READY';
  end if;


  update
    public.settlement_export_deliveries
  set
    status =
      p_result,

    lease_token =
      null,

    lease_expires_at =
      null,

    last_http_status =
      p_http_status,

    line_request_id =
      nullif(
        trim(
          coalesce(
            p_line_request_id,
            ''
          )
        ),
        ''
      ),

    last_error =
      nullif(
        left(
          coalesce(
            p_error,
            ''
          ),
          2000
        ),
        ''
      ),

    updated_at =
      v_now
  where
    cycle_id =
      p_cycle_id
  returning *
  into
    v_delivery;


  return jsonb_build_object(
    'ok', true,
    'cycle_status', v_cycle.status,
    'delivery', to_jsonb(v_delivery)
  );

end;
$$;


-- ============================================================
-- 6. Positive LINE acknowledgement -> SENT
-- ============================================================

create or replace function
  public.complete_export_preparation_delivery(
    p_cycle_id uuid,
    p_expected_summary_group_round_id uuid,
    p_lease_token uuid,
    p_http_status integer,
    p_line_request_id text default null,
    p_line_accepted_request_id text default null,
    p_sent_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_cycle
    public.settlement_export_cycles%rowtype;

  v_delivery
    public.settlement_export_deliveries%rowtype;

  v_item
    public.settlement_export_items%rowtype;

  v_acknowledged boolean := false;

  v_now timestamptz :=
    clock_timestamp();

  v_items jsonb :=
    '[]'::jsonb;

begin

  /*
   * Positive acknowledgement means:
   *
   *   2xx from LINE, OR
   *   409 with x-line-accepted-request-id.
   */
  v_acknowledged :=
    (
      p_http_status between 200 and 299
    )
    or
    (
      p_http_status = 409
      and nullif(
        trim(
          coalesce(
            p_line_accepted_request_id,
            ''
          )
        ),
        ''
      )
      is not null
    );


  if not v_acknowledged then
    raise exception
      'EXPORT_DELIVERY_NOT_ACKNOWLEDGED';
  end if;


  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      p_expected_summary_group_round_id
  for update;


  if not found then
    raise exception
      'EXPORT_ROUND_NOT_FOUND';
  end if;


  if v_round.status <> 'OPEN' then
    raise exception
      'EXPORT_ROUND_NOT_OPEN';
  end if;


  select
    c.*
  into
    v_cycle
  from
    public.settlement_export_cycles c
  where
    c.id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_CYCLE_NOT_FOUND';
  end if;


  if
    v_cycle.summary_group_round_id
    <>
    p_expected_summary_group_round_id
  then
    raise exception
      'EXPORT_PREPARATION_STALE_ROUND';
  end if;


  select
    d.*
  into
    v_delivery
  from
    public.settlement_export_deliveries d
  where
    d.cycle_id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_DELIVERY_NOT_FOUND';
  end if;


  /*
   * Fully idempotent after successful acknowledgement.
   */
  if v_delivery.status = 'ACKNOWLEDGED' then

    if v_cycle.status <> 'SENT' then
      raise exception
        'EXPORT_DELIVERY_ACK_STATE_INVALID';
    end if;

    select
      coalesce(
        jsonb_agg(
          to_jsonb(i)
          order by
            i.category,
            i.code
        ),
        '[]'::jsonb
      )
    into
      v_items
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        p_cycle_id;

    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent_replay', true,
      'cycle', to_jsonb(v_cycle),
      'delivery', to_jsonb(v_delivery),
      'items', v_items
    );

  end if;


  if
    v_delivery.status <> 'SENDING'
    or v_delivery.lease_token
       is distinct from
       p_lease_token
  then
    raise exception
      'EXPORT_DELIVERY_LEASE_MISMATCH';
  end if;


  if v_cycle.status <> 'READY' then
    raise exception
      'EXPORT_CYCLE_NOT_READY';
  end if;


  /*
   * The external message is already accepted.
   *
   * We therefore use the transport reservation snapshot.
   * We MUST NOT perform a new live availability rejection here:
   * a later UNSEND/correction must become reconciliation state,
   * not erase an already accepted external send.
   */
  for v_item in

    select
      i.*
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        p_cycle_id
    order by
      i.category,
      i.code

  loop

    if
      v_item.transport_current_effective_quantity
        is null
      or v_item.transport_prior_sent_quantity
        is null
      or v_item.transport_prior_reserved_quantity
        is null
      or v_item.transport_available_quantity
        is null
      or v_item.transport_validated_at
        is null
      or v_item.selected_send_quantity
        >
        v_item.transport_available_quantity
    then
      raise exception
        'EXPORT_TRANSPORT_SNAPSHOT_INVALID';
    end if;


    update
      public.settlement_export_items
    set
      sent_current_effective_quantity =
        v_item.transport_current_effective_quantity,

      sent_prior_sent_quantity =
        v_item.transport_prior_sent_quantity,

      sent_available_quantity =
        v_item.transport_available_quantity,

      sent_validated_at =
        v_now
    where
      cycle_id =
        p_cycle_id
      and category =
        v_item.category
      and code =
        v_item.code;

  end loop;


  update
    public.settlement_export_cycles
  set
    status =
      'SENT',

    sent_at =
      v_now,

    sent_by =
      coalesce(
        nullif(
          trim(
            p_sent_by
          ),
          ''
        ),
        'DASHBOARD'
      )
  where
    id =
      p_cycle_id
  returning *
  into
    v_cycle;


  update
    public.settlement_export_deliveries
  set
    status =
      'ACKNOWLEDGED',

    acknowledged_at =
      v_now,

    lease_token =
      null,

    lease_expires_at =
      null,

    last_http_status =
      p_http_status,

    line_request_id =
      nullif(
        trim(
          coalesce(
            p_line_request_id,
            ''
          )
        ),
        ''
      ),

    line_accepted_request_id =
      nullif(
        trim(
          coalesce(
            p_line_accepted_request_id,
            ''
          )
        ),
        ''
      ),

    last_error =
      null,

    updated_at =
      v_now
  where
    cycle_id =
      p_cycle_id
  returning *
  into
    v_delivery;


  select
    coalesce(
      jsonb_agg(
        to_jsonb(i)
        order by
          i.category,
          i.code
      ),
      '[]'::jsonb
    )
  into
    v_items
  from
    public.settlement_export_items i
  where
    i.cycle_id =
      p_cycle_id;


  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent_replay', false,
    'cycle', to_jsonb(v_cycle),
    'delivery', to_jsonb(v_delivery),
    'items', v_items
  );

end;
$$;


-- ============================================================
-- 7. Security
-- ============================================================

alter table
  public.settlement_export_deliveries
enable row level security;


revoke all
on public.settlement_export_deliveries
from public, anon, authenticated;

revoke all
on public.settlement_export_reserved_totals
from public, anon, authenticated;


grant
  select,
  insert,
  update,
  delete
on public.settlement_export_deliveries
to service_role;

grant select
on public.settlement_export_reserved_totals
to service_role;


revoke all
on function
  public.begin_export_preparation_delivery(
    uuid,
    uuid,
    jsonb,
    text
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.begin_export_preparation_delivery(
    uuid,
    uuid,
    jsonb,
    text
  )
to
  service_role;


revoke all
on function
  public.record_export_preparation_delivery_result(
    uuid,
    uuid,
    uuid,
    text,
    integer,
    text,
    text
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.record_export_preparation_delivery_result(
    uuid,
    uuid,
    uuid,
    text,
    integer,
    text,
    text
  )
to
  service_role;


revoke all
on function
  public.complete_export_preparation_delivery(
    uuid,
    uuid,
    uuid,
    integer,
    text,
    text,
    text
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.complete_export_preparation_delivery(
    uuid,
    uuid,
    uuid,
    integer,
    text,
    text,
    text
  )
to
  service_role;


/*
 * Retire direct service-role access to the old accounting-only
 * SENT RPC. Phase 2E acknowledgement is now the public server
 * mutation boundary.
 */
revoke execute
on function
  public.mark_export_preparation_sent(
    uuid,
    uuid,
    text
  )
from
  service_role;


comment on table
  public.settlement_export_deliveries
is
  'Durable LINE delivery identity for Export Preparation. A cycle remains READY until positive LINE acknowledgement.';

comment on view
  public.settlement_export_reserved_totals
is
  'Quantities reserved by unresolved outbound delivery attempts. Prevents concurrent READY cycles from sending overlapping quantities.';

commit;
