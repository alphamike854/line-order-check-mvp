-- DR1D-B
-- Round-owned LINE message admission + accepted-message persistence.
--
-- Business contract:
-- 1. TEXT/IMAGE intake is accepted only while that Summary Group has
--    an authoritative OPEN Round.
-- 2. Accepted messages inherit business_date from the Round.
-- 3. No OPEN Round => no message row is persisted.
-- 4. Once admitted, parser/OCR completion belongs to that immutable
--    Round even if CLOSE_GROUP happens while processing is in flight.
-- 5. Review/correction mutation outside the parser intake path keeps
--    the existing closed-group protection.

begin;


-- ============================================================
-- 1. Authoritative message admission
--
-- Lock order deliberately matches
-- set_settlement_summary_group_accepting():
--
-- global settlement boundary
-- -> Summary Group boundary
--
-- This makes INSERT race atomically with OPEN_GROUP/CLOSE_GROUP.
-- ============================================================

create or replace function
  public.assign_message_to_open_settlement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session_id uuid;
  v_summary_group_id text;

  v_round
    public.settlement_summary_group_rounds%rowtype;

begin

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  -- ----------------------------------------------------------
  -- Explicit Round ownership, when supplied by a trusted caller.
  -- The Round must still be OPEN at admission time.
  -- ----------------------------------------------------------

  if new.summary_group_round_id is not null then

    select *
      into v_round
    from
      public.settlement_summary_group_rounds
    where
      id = new.summary_group_round_id;


    if not found then
      raise exception
        'SUMMARY_GROUP_ROUND_NOT_FOUND';
    end if;


    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          'SETTLEMENT_SUMMARY_GROUP_CONTROL',
          v_round.settlement_session_id::text,
          v_round.summary_group_id
        ),
        0
      )
    );


    -- Re-read after acquiring the Summary Group boundary.
    select *
      into v_round
    from
      public.settlement_summary_group_rounds
    where
      id = new.summary_group_round_id;


    if not found then
      raise exception
        'SUMMARY_GROUP_ROUND_NOT_FOUND';
    end if;


    if v_round.status <> 'OPEN' then
      raise exception
        'SUMMARY_GROUP_NOT_OPEN';
    end if;


    new.settlement_session_id :=
      v_round.settlement_session_id;

    new.summary_group_id :=
      v_round.summary_group_id;

    new.business_date :=
      v_round.business_date;


    return new;
  end if;


  -- ----------------------------------------------------------
  -- Resolve compatibility parent session.
  -- Parent session is NOT the business-date authority.
  -- ----------------------------------------------------------

  select
    s.id
  into
    v_session_id
  from
    public.settlement_sessions s
  where
    s.status = 'OPEN'
  limit 1;


  if v_session_id is null then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  -- ----------------------------------------------------------
  -- Resolve Summary Group from the frozen settlement mapping.
  -- ----------------------------------------------------------

  select
    cfg.summary_group_id
  into
    v_summary_group_id
  from
    public.settlement_line_group_config cfg
  where
    cfg.settlement_session_id =
      v_session_id

    and cfg.line_group_id =
      new.line_group_id

    and cfg.enabled = true
  limit 1;


  if
    v_summary_group_id is null
    or trim(v_summary_group_id) = ''
  then
    raise exception
      'GROUP_NOT_CONFIGURED';
  end if;


  -- Same per-group lock used by OPEN_GROUP / CLOSE_GROUP.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        v_session_id::text,
        v_summary_group_id
      ),
      0
    )
  );


  -- ----------------------------------------------------------
  -- Round is now the authoritative intake boundary and
  -- authoritative business-date owner.
  -- ----------------------------------------------------------

  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      v_session_id

    and r.summary_group_id =
      v_summary_group_id

    and r.status = 'OPEN'
  order by
    r.round_no desc
  limit 1;


  if not found then
    raise exception
      'SUMMARY_GROUP_NOT_OPEN';
  end if;


  new.settlement_session_id :=
    v_round.settlement_session_id;

  new.summary_group_id :=
    v_round.summary_group_id;

  new.summary_group_round_id :=
    v_round.id;

  new.business_date :=
    v_round.business_date;


  return new;
end;
$$;


comment on function
  public.assign_message_to_open_settlement()
is
  'Authoritative LINE message admission. TEXT/IMAGE message INSERT inherits settlement, Summary Group, Round and business_date from the currently OPEN Summary Group Round under the same lock order as OPEN_GROUP/CLOSE_GROUP.';


-- ============================================================
-- 2. Narrow parser/OCR persistence wrapper
--
-- Existing persist_parsed_message_atomic() stays intact.
--
-- This wrapper is the ONLY path that marks a transaction as
-- completing an already-admitted webhook message.
--
-- The Round may be OPEN or CLOSED here: admission already
-- happened while it was OPEN.
-- ============================================================

create or replace function
  public.persist_parsed_message_atomic_admitted(
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

  v_round
    public.settlement_summary_group_rounds%rowtype;

begin

  select
    m.*
  into
    v_message
  from
    public.messages m
  where
    m.id = p_message_id
  for update;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if v_message.summary_group_round_id is null then
    raise exception
      'MESSAGE_ROUND_NOT_ASSIGNED';
  end if;


  -- This exception path is reserved for webhook-admitted intake.
  if v_message.webhook_event_id is null then
    raise exception
      'MESSAGE_NOT_WEBHOOK_ADMITTED';
  end if;


  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      v_message.summary_group_round_id;


  if not found then
    raise exception
      'SUMMARY_GROUP_ROUND_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id
      is distinct from
        v_round.settlement_session_id
  then
    raise exception
      'ROUND_SETTLEMENT_MISMATCH';
  end if;


  if
    v_message.summary_group_id
      is distinct from
        v_round.summary_group_id
  then
    raise exception
      'ROUND_SUMMARY_GROUP_MISMATCH';
  end if;


  if
    v_message.business_date
      is distinct from
        v_round.business_date
  then
    raise exception
      'ROUND_BUSINESS_DATE_MISMATCH';
  end if;


  -- PENDING is the normal parser/OCR path.
  --
  -- PARSED + zero items remains eligible only for the historical
  -- recovery invariant already supported by the webhook.
  if v_message.parse_status = 'PARSED' then

    if exists (
      select 1
      from
        public.order_items oi
      where
        oi.message_record_id =
          v_message.id
    ) then
      raise exception
        'MESSAGE_ALREADY_HAS_ITEMS';
    end if;

  elsif v_message.parse_status <> 'PENDING' then

    raise exception
      'MESSAGE_NOT_PARSER_PENDING';

  end if;


  -- Transaction-local, message-specific bypass marker.
  --
  -- The order-item trigger below accepts the bypass only when
  -- the inserted item's message_record_id exactly matches this
  -- value and the message already owns a Round.
  perform set_config(
    'line_order.accepted_message_persistence_id',
    p_message_id::text,
    true
  );


  return
    public.persist_parsed_message_atomic(
      p_message_id,
      p_normalized_text,
      p_parser_version,
      p_items,
      p_summary_group_id,
      p_message_patch
    );
end;
$$;


revoke all
on function
  public.persist_parsed_message_atomic_admitted(
    uuid,
    text,
    text,
    jsonb,
    text,
    jsonb
  )
from public, anon, authenticated;


grant execute
on function
  public.persist_parsed_message_atomic_admitted(
    uuid,
    text,
    text,
    jsonb,
    text,
    jsonb
  )
to service_role;


comment on function
  public.persist_parsed_message_atomic_admitted(
    uuid,
    text,
    text,
    jsonb,
    text,
    jsonb
  )
is
  'Completes canonical parser/OCR persistence for a webhook message that already acquired immutable Summary Group Round ownership while intake was OPEN.';


-- ============================================================
-- 3. Preserve closed-group guard, with one narrow exception
--
-- Normal Review/correction/direct writes still run the original
-- Summary Group accepting check.
--
-- Only persist_parsed_message_atomic_admitted() can install the
-- transaction-local message-specific bypass marker.
-- ============================================================

create or replace function
  public.enforce_order_item_summary_group_accepting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admitted_message_id text;

  v_message_round_id uuid;
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


revoke all
on function
  public.enforce_order_item_summary_group_accepting()
from public, anon, authenticated;


grant execute
on function
  public.enforce_order_item_summary_group_accepting()
to service_role;


comment on function
  public.enforce_order_item_summary_group_accepting()
is
  'Blocks ordinary canonical mutation after Summary Group close while allowing only transaction-marked parser/OCR completion for a message that already owns an admitted Round.';


commit;
