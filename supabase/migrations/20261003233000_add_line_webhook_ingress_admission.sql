begin;

-- Q1A v2
-- Temporal LINE webhook admission for durable QStash delivery.
--
-- Business rule:
-- A TEXT/IMAGE belongs to the Round that was accepting its LINE Group
-- at the event's original LINE timestamp, not the time a queued
-- consumer eventually processes it.
--
-- Public ingress:
--   confirmed temporal Round -> queue with round_id hint
--   confirmed outside Round  -> do not queue
--   DB unavailable            -> fail-open to QStash
--
-- Consumer:
--   valid publisher hint      -> no duplicate admission read
--   no hint                   -> resolve temporal Round before claim
--
-- Authoritative INSERT:
--   explicit round_id is accepted only when:
--   - event_timestamp is inside that Round's [opened_at, closed_at)
--   - the LINE Group belongs to that Round's immutable lineage.
--
-- No operational data is mutated by the read model.

create or replace function
  public.line_webhook_ingress_admission(
    p_line_group_id text,
    p_event_timestamp timestamptz,
    p_webhook_event_id text default null
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '1500ms'
as $function$
declare
  v_round_id uuid;
  v_session_id uuid;
  v_summary_group_id text;
begin
  if
    p_line_group_id is null
    or trim(p_line_group_id) = ''
  then
    return jsonb_build_object(
      'admitted', false,
      'reason', 'GROUP_NOT_CONFIGURED'
    );
  end if;

  if p_event_timestamp is null then
    return jsonb_build_object(
      'admitted', false,
      'reason', 'INVALID_EVENT_TIMESTAMP'
    );
  end if;

  -- Consumer retry after the message has already crossed the
  -- authoritative INSERT boundary.
  if
    p_webhook_event_id is not null
    and trim(p_webhook_event_id) <> ''
  then
    select
      m.summary_group_round_id,
      m.settlement_session_id,
      m.summary_group_id
    into
      v_round_id,
      v_session_id,
      v_summary_group_id
    from public.messages m
    where
      m.webhook_event_id =
        p_webhook_event_id
      and m.line_group_id =
        p_line_group_id
      and m.summary_group_round_id
        is not null
    limit 1;

    if v_round_id is not null then
      return jsonb_build_object(
        'admitted', true,
        'reason', 'EXISTING_ADMITTED_MESSAGE',
        'round_id', v_round_id,
        'settlement_session_id', v_session_id,
        'summary_group_id', v_summary_group_id,
        'resumed', true
      );
    end if;
  end if;

  -- Immutable per-Round LINE Group lineage is the routing authority.
  --
  -- OPEN:
  --   [opened_at, infinity)
  --
  -- CLOSED:
  --   [opened_at, closed_at)
  --
  -- Half-open interval makes closed_at the exact first instant that
  -- the Round no longer accepts newly-arriving LINE events.
  select
    r.id,
    r.settlement_session_id,
    r.summary_group_id
  into
    v_round_id,
    v_session_id,
    v_summary_group_id
  from
    public.settlement_line_group_round_config lineage
  join
    public.settlement_summary_group_rounds r
      on r.id = lineage.round_id
  where
    lineage.line_group_id =
      p_line_group_id

    and p_event_timestamp >=
      r.opened_at

    and (
      (
        r.status = 'OPEN'
        and r.closed_at is null
      )
      or
      (
        r.status = 'CLOSED'
        and r.closed_at is not null
        and p_event_timestamp <
          r.closed_at
      )
    )
  order by
    r.opened_at desc,
    r.round_no desc
  limit 1;

  if v_round_id is null then
    return jsonb_build_object(
      'admitted', false,
      'reason', 'NO_ROUND_AT_EVENT_TIME',
      'resumed', false
    );
  end if;

  return jsonb_build_object(
    'admitted', true,
    'reason', 'EVENT_TIME_IN_ROUND',
    'round_id', v_round_id,
    'settlement_session_id', v_session_id,
    'summary_group_id', v_summary_group_id,
    'resumed', false
  );
end;
$function$;

comment on function
  public.line_webhook_ingress_admission(
    text,
    timestamptz,
    text
  )
is
  'Q1A temporal read-only LINE admission. Resolves immutable Round '
  'ownership using original LINE event_timestamp and per-Round LINE '
  'Group lineage; optionally resumes an already-admitted webhook event.';

revoke all
on function
  public.line_webhook_ingress_admission(
    text,
    timestamptz,
    text
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.line_webhook_ingress_admission(
    text,
    timestamptz,
    text
  )
to service_role;


-- ============================================================
-- Authoritative message INSERT boundary
-- ============================================================
--
-- Preserve the existing current-OPEN path when callers do not
-- supply explicit Round ownership.
--
-- For a trusted explicit Round (QStash temporal admission), the
-- Round may have CLOSED by processing time. The original LINE event
-- timestamp, immutable Round lineage and lifecycle timestamps decide.

create or replace function
  public.assign_message_to_open_settlement()
returns trigger
language plpgsql
set search_path = public
as $function$
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
  -- Explicit temporal Round ownership.
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

    -- CLOSE_GROUP may have committed while the queued event waited.
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

    if new.event_timestamp is null then
      raise exception
        'MESSAGE_EVENT_OUTSIDE_ROUND';
    end if;

    if
      new.event_timestamp <
        v_round.opened_at
      or (
        v_round.status = 'OPEN'
        and v_round.closed_at
          is not null
        and new.event_timestamp >=
          v_round.closed_at
      )
      or (
        v_round.status = 'CLOSED'
        and (
          v_round.closed_at
            is null
          or new.event_timestamp >=
            v_round.closed_at
        )
      )
    then
      raise exception
        'MESSAGE_EVENT_OUTSIDE_ROUND';
    end if;

    if not exists (
      select 1
      from
        public.settlement_line_group_round_config lineage
      where
        lineage.round_id =
          v_round.id
        and lineage.line_group_id =
          new.line_group_id
    ) then
      raise exception
        'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
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
  -- Existing immediate/current-OPEN compatibility path.
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
$function$;

comment on function
  public.assign_message_to_open_settlement()
is
  'Authoritative LINE message admission. Immediate callers retain '
  'current OPEN-Round locking semantics. A trusted explicit Round is '
  'validated against immutable LINE Group lineage and original LINE '
  'event_timestamp, allowing durable queued events that arrived before '
  'CLOSE_GROUP to complete after the Round closes.';

commit;
