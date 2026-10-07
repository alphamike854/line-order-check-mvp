-- Retention R2 — Current-Round / QStash / UNSEND Fence
--
-- Goals:
-- - latest/current Round per Summary Group is the only non-retired Round
-- - latest CLOSED Round remains eligible until a successor opens
-- - retired TEXT / IMAGE / UNSEND is rejected before webhook claim/write
-- - webhook_events gains nullable Round ownership for later R3 purge
-- - explicit message INSERT is revalidated against the runtime cursor
--
-- This migration intentionally performs NO operational purge and does
-- not replace OPEN_GROUP / CLOSE_GROUP lifecycle behavior.

begin;


-- ============================================================
-- 1. Webhook transport ownership for later retention purge
-- ============================================================

alter table
  public.webhook_events
add column if not exists
  summary_group_round_id uuid;


comment on column
  public.webhook_events.summary_group_round_id
is
  'Retention transport ownership. Nullable for legacy/unmatched events; current Round claims set this to the authoritative Summary Group Round. Intentionally no FK so later Round deletion cannot orphan-block retention cleanup.';


create index if not exists
  webhook_events_summary_group_round_idx
on public.webhook_events (
  summary_group_round_id,
  received_at
);


-- Safe ownership backfill only. No payload or business row is deleted.
update
  public.webhook_events w
set
  summary_group_round_id =
    m.summary_group_round_id
from
  public.messages m
where
  w.summary_group_round_id is null
  and m.webhook_event_id =
    w.webhook_event_id
  and m.summary_group_round_id
    is not null;


-- ============================================================
-- 2. Temporal ingress may resolve ONLY the runtime-latest Round
-- ============================================================

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
    from
      public.messages m
    join
      public.summary_group_round_runtime_state state
        on state.summary_group_id =
             m.summary_group_id
       and state.latest_round_id =
             m.summary_group_round_id
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

  select
    r.id,
    r.settlement_session_id,
    r.summary_group_id
  into
    v_round_id,
    v_session_id,
    v_summary_group_id
  from
    public.summary_group_round_runtime_state state
  join
    public.settlement_summary_group_rounds r
      on r.id =
        state.latest_round_id
     and r.summary_group_id =
        state.summary_group_id
  join
    public.settlement_line_group_round_config lineage
      on lineage.round_id =
        r.id
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
  limit 1;

  if v_round_id is null then
    return jsonb_build_object(
      'admitted', false,
      'reason', 'NO_CURRENT_ROUND_AT_EVENT_TIME',
      'resumed', false
    );
  end if;

  return jsonb_build_object(
    'admitted', true,
    'reason', 'EVENT_TIME_IN_CURRENT_ROUND',
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
  'Retention R2 read-only temporal admission. Only the runtime-latest Summary Group Round may be admitted; latest CLOSED remains retryable until a successor opens.';


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
-- 3. Atomic current-Round webhook claim fence
-- ============================================================

create or replace function
  public.claim_current_round_webhook_event(
    p_webhook_event_id text,
    p_destination text,
    p_event_type text,
    p_line_group_id text,
    p_user_id text,
    p_is_redelivery boolean,
    p_payload jsonb,
    p_summary_group_round_id uuid default null,
    p_unsend_message_id text default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_round_id uuid;
  v_message_record_id uuid;
  v_claim jsonb;
begin
  if coalesce(
    trim(p_webhook_event_id),
    ''
  ) = '' then
    raise exception
      'WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  if p_event_type = 'message' then
    if p_summary_group_round_id is null then
      return jsonb_build_object(
        'state', 'RETIRED',
        'reason', 'ROUND_REQUIRED'
      );
    end if;

    select
      r.id
    into
      v_round_id
    from
      public.summary_group_round_runtime_state state
    join
      public.settlement_summary_group_rounds r
        on r.id =
          state.latest_round_id
       and r.summary_group_id =
          state.summary_group_id
    where
      r.id =
        p_summary_group_round_id
      and exists (
        select 1
        from
          public.settlement_line_group_round_config lineage
        where
          lineage.round_id =
            r.id
          and lineage.line_group_id =
            p_line_group_id
      )
    limit 1;

    if v_round_id is null then
      return jsonb_build_object(
        'state', 'RETIRED',
        'reason', 'ROUND_RETIRED'
      );
    end if;

  elsif p_event_type = 'unsend' then
    if coalesce(
      trim(p_unsend_message_id),
      ''
    ) = '' then
      return jsonb_build_object(
        'state', 'RETIRED',
        'reason', 'UNSEND_ORIGINAL_NOT_CURRENT'
      );
    end if;

    select
      m.id,
      m.summary_group_round_id
    into
      v_message_record_id,
      v_round_id
    from
      public.messages m
    join
      public.summary_group_round_runtime_state state
        on state.summary_group_id =
             m.summary_group_id
       and state.latest_round_id =
             m.summary_group_round_id
    where
      m.destination =
        p_destination
      and m.message_id =
        p_unsend_message_id
      and m.line_group_id =
        p_line_group_id
      and m.summary_group_round_id
        is not null
    order by
      m.event_timestamp desc,
      m.id desc
    limit 1;

    if
      v_message_record_id is null
      or v_round_id is null
    then
      return jsonb_build_object(
        'state', 'RETIRED',
        'reason', 'UNSEND_ORIGINAL_NOT_CURRENT'
      );
    end if;

  else
    return jsonb_build_object(
      'state', 'RETIRED',
      'reason', 'UNSUPPORTED_EVENT'
    );
  end if;

  v_claim :=
    public.claim_webhook_event(
      p_webhook_event_id,
      p_destination,
      p_event_type,
      p_line_group_id,
      p_user_id,
      p_is_redelivery,
      p_payload
    );

  if coalesce(
    v_claim ->> 'state',
    ''
  ) <> 'DENIED' then
    update
      public.webhook_events
    set
      summary_group_round_id =
        coalesce(
          summary_group_round_id,
          v_round_id
        )
    where
      webhook_event_id =
        p_webhook_event_id;
  end if;

  return
    v_claim
    || jsonb_build_object(
      'round_id',
        v_round_id,
      'matched_message_record_id',
        v_message_record_id
    );
end;
$function$;


comment on function
  public.claim_current_round_webhook_event(
    text,
    text,
    text,
    text,
    text,
    boolean,
    jsonb,
    uuid,
    text
  )
is
  'Retention R2 atomic claim fence. Serializes against Round lifecycle; retired message/UNSEND traffic returns RETIRED before webhook_events is claimed or written.';


revoke all
on function
  public.claim_current_round_webhook_event(
    text,
    text,
    text,
    text,
    text,
    boolean,
    jsonb,
    uuid,
    text
  )
from
  public,
  anon,
  authenticated;


grant execute
on function
  public.claim_current_round_webhook_event(
    text,
    text,
    text,
    text,
    text,
    boolean,
    jsonb,
    uuid,
    text
  )
to service_role;


-- ============================================================
-- 4. Authoritative message INSERT revalidation
-- ============================================================

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

    if not exists (
      select 1
      from
        public.summary_group_round_runtime_state state
      where
        state.summary_group_id =
          v_round.summary_group_id
        and state.latest_round_id =
          v_round.id
    ) then
      raise exception
        'SUMMARY_GROUP_ROUND_RETIRED';
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
  'Retention R2 authoritative LINE message admission. Current immediate OPEN behavior is preserved; explicit queued ownership is rejected once a successor Round becomes runtime-latest.';


commit;
