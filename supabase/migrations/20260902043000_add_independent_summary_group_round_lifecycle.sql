-- R2C1 v9.21
-- Independent Summary Group Round Lifecycle + Reset-on-Open
--
-- Parent settlement_sessions remains the compatibility/config container.
-- Operational lifecycle source of truth becomes settlement_summary_group_rounds.
--
-- OPEN_GROUP:
--   - snapshot previous closed round
--   - reset only operational data of this session + Summary Group
--   - purge previous-round and post-close messages
--   - create next numbered OPEN round
--   - preserve Promotion/config snapshots
--
-- CLOSE_GROUP:
--   - close only this Summary Group's current OPEN round
--   - parent settlement remains OPEN
--
-- This phase deliberately keeps the existing webhook closed-group Review behavior.
-- POST_CLOSE and closed-round correction semantics are handled later.


-- ============================================================
-- 1. Final compact snapshot retained after operational purge
-- ============================================================

create table if not exists
  public.settlement_summary_group_round_snapshots (
    round_id uuid primary key
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    settlement_session_id uuid not null
      references public.settlement_sessions(id)
      on delete cascade,

    summary_group_id text not null
      references public.summary_groups(id),

    round_no integer not null
      check (round_no > 0),

    opened_at timestamptz not null,
    closed_at timestamptz,

    captured_at timestamptz not null default now(),

    message_count bigint not null default 0,
    image_message_count bigint not null default 0,

    order_item_count bigint not null default 0,
    order_quantity_total bigint not null default 0,
    unsent_quantity_total bigint not null default 0,
    active_quantity_total bigint not null default 0,

    review_open_count bigint not null default 0,
    corrected_count bigint not null default 0,
    ignored_count bigint not null default 0,
    deferred_count bigint not null default 0,

    gross_received numeric(18,2),
    adjusted_received numeric(18,2),
    actual_point_total numeric(18,2),
    confirmed_cut_total numeric(18,2),
    remaining_safe_capacity numeric(18,2)
  );


create index if not exists
  settlement_summary_group_round_snapshots_lookup_idx
on public.settlement_summary_group_round_snapshots (
  settlement_session_id,
  summary_group_id,
  round_no desc
);


alter table
  public.settlement_summary_group_round_snapshots
enable row level security;


revoke all
on public.settlement_summary_group_round_snapshots
from public, anon, authenticated;


grant select
on public.settlement_summary_group_round_snapshots
to service_role;


-- ============================================================
-- 2. Storage cleanup queue
--
-- DB reset is authoritative even if Storage deletion is delayed.
-- ============================================================

create table if not exists
  public.settlement_round_storage_cleanup_queue (
    id bigint generated always as identity primary key,

    round_id uuid not null
      references public.settlement_summary_group_rounds(id)
      on delete cascade,

    storage_bucket text not null default 'review-images',
    storage_path text not null,

    status text not null default 'PENDING'
      check (
        status in (
          'PENDING',
          'DELETED',
          'FAILED'
        )
      ),

    queued_at timestamptz not null default now(),
    attempted_at timestamptz,
    deleted_at timestamptz,
    last_error text,

    unique (
      round_id,
      storage_bucket,
      storage_path
    )
  );


create index if not exists
  settlement_round_storage_cleanup_pending_idx
on public.settlement_round_storage_cleanup_queue (
  status,
  queued_at
);


alter table
  public.settlement_round_storage_cleanup_queue
enable row level security;


revoke all
on public.settlement_round_storage_cleanup_queue
from public, anon, authenticated;


grant select, insert, update, delete
on public.settlement_round_storage_cleanup_queue
to service_role;


grant usage, select
on sequence
  public.settlement_round_storage_cleanup_queue_id_seq
to service_role;


-- ============================================================
-- 3. R2B legacy control -> round-1 mirror must stop here.
--
-- Otherwise deleting the compatibility control during OPEN_GROUP
-- would try to reopen round_no=1 and collide with round_no=2.
-- ============================================================

-- R2B compatibility behavior must also stop creating OPEN round 1
-- automatically when settlement_line_group_config is inserted.
--
-- From R2C onward:
--   config presence = Summary Group is available in the parent settlement
--   OPEN round       = Summary Group is actually accepting orders
--
-- Therefore every Summary Group starts NOT_STARTED until OPEN_GROUP.
drop trigger if exists
  settlement_line_group_config_round_trg
on public.settlement_line_group_config;


drop trigger if exists
  settlement_summary_group_control_round_trg
on public.settlement_summary_group_controls;


-- ============================================================
-- 4. Round state becomes authoritative accepting state
-- ============================================================

create or replace function
  public.is_settlement_summary_group_accepting(
    p_settlement_session_id uuid,
    p_summary_group_id text
  )
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.settlement_summary_group_rounds r
    join public.settlement_sessions s
      on s.id = r.settlement_session_id
    where
      r.settlement_session_id =
        p_settlement_session_id
      and r.summary_group_id =
        p_summary_group_id
      and r.status = 'OPEN'
      and s.status = 'OPEN'
  );
$$;


-- ============================================================
-- 5. Replace legacy OPEN_GROUP / CLOSE_GROUP RPC
--    without changing its API signature.
-- ============================================================

create or replace function
  public.set_settlement_summary_group_accepting(
    p_settlement_session_id uuid,
    p_summary_group_id text,
    p_accepting_orders boolean,
    p_changed_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session
    public.settlement_sessions%rowtype;

  v_current_round_id uuid;
  v_current_round_no integer;

  v_previous_round_id uuid;
  v_previous_round_no integer;

  v_new_round_id uuid;
  v_next_round_no integer;

  v_changed_at timestamptz := now();

  v_purged_messages bigint := 0;

  v_image_storage_paths jsonb :=
    '[]'::jsonb;
begin
  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_NOT_FOUND';
  end if;


  if coalesce(
    trim(p_summary_group_id),
    ''
  ) = '' then
    raise exception
      'SUMMARY_GROUP_REQUIRED';
  end if;


  if p_accepting_orders is null then
    raise exception
      'SUMMARY_GROUP_STATE_REQUIRED';
  end if;


  -- Lock order:
  -- global settlement boundary -> Summary Group boundary.
  --
  -- This serializes against message settlement assignment first,
  -- then canonical order-item persistence / group mutation.

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        p_settlement_session_id::text,
        p_summary_group_id
      ),
      0
    )
  );


  select *
    into v_session
  from public.settlement_sessions
  where id =
    p_settlement_session_id
  for update;


  if not found then
    raise exception
      'SETTLEMENT_NOT_FOUND';
  end if;


  -- Parent stays the compatibility container.
  if v_session.status <> 'OPEN' then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  if not exists (
    select 1
    from public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id =
        p_settlement_session_id
      and cfg.summary_group_id =
        p_summary_group_id
      and cfg.enabled = true
  ) then
    raise exception
      'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;


  select
    r.id,
    r.round_no
  into
    v_current_round_id,
    v_current_round_no
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      p_summary_group_id
    and r.status = 'OPEN'
  order by r.round_no desc
  limit 1
  for update;


  -- ==========================================================
  -- CLOSE_GROUP
  -- ==========================================================

  if p_accepting_orders is false then
    if v_current_round_id is null then
      return jsonb_build_object(
        'settlement_session_id',
          p_settlement_session_id,
        'summary_group_id',
          p_summary_group_id,
        'accepting_orders',
          false,
        'changed',
          false
      );
    end if;


    update
      public.settlement_summary_group_rounds
    set
      status = 'CLOSED',
      closed_at = v_changed_at,
      closed_by = p_changed_by,
      updated_at = v_changed_at
    where id =
      v_current_round_id;


    -- Compatibility mirror for existing webhook/API readers.
    insert into
      public.settlement_summary_group_controls (
        settlement_session_id,
        summary_group_id,
        accepting_orders,
        changed_at,
        changed_by,
        closed_at
      )
    values (
      p_settlement_session_id,
      p_summary_group_id,
      false,
      v_changed_at,
      p_changed_by,
      v_changed_at
    )
    on conflict (
      settlement_session_id,
      summary_group_id
    )
    do update set
      accepting_orders =
        false,
      changed_at =
        excluded.changed_at,
      changed_by =
        excluded.changed_by,
      closed_at =
        excluded.closed_at;


    insert into
      public.settlement_summary_group_control_events (
        settlement_session_id,
        summary_group_id,
        previous_accepting_orders,
        new_accepting_orders,
        changed_at,
        changed_by
      )
    values (
      p_settlement_session_id,
      p_summary_group_id,
      true,
      false,
      v_changed_at,
      p_changed_by
    );


    return jsonb_build_object(
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id',
        p_summary_group_id,
      'accepting_orders',
        false,
      'changed',
        true,
      'round_id',
        v_current_round_id,
      'round_no',
        v_current_round_no,
      'closed_at',
        v_changed_at
    );
  end if;


  -- ==========================================================
  -- OPEN_GROUP
  -- ==========================================================

  -- Already open = idempotent.
  if v_current_round_id is not null then
    return jsonb_build_object(
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id',
        p_summary_group_id,
      'accepting_orders',
        true,
      'changed',
        false,
      'round_id',
        v_current_round_id,
      'round_no',
        v_current_round_no
    );
  end if;


  -- Latest round belongs only to THIS parent session + Summary Group.
  select
    r.id,
    r.round_no
  into
    v_previous_round_id,
    v_previous_round_no
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      p_summary_group_id
  order by
    r.round_no desc
  limit 1
  for update;


  v_next_round_no :=
    coalesce(
      v_previous_round_no,
      0
    ) + 1;


  -- ==========================================================
  -- Snapshot previous CLOSED round after all post-close
  -- corrections, immediately before reset.
  -- ==========================================================

  if v_previous_round_id is not null then
    insert into
      public.settlement_summary_group_round_snapshots (
        round_id,
        settlement_session_id,
        summary_group_id,
        round_no,
        opened_at,
        closed_at,

        captured_at,

        message_count,
        image_message_count,

        order_item_count,
        order_quantity_total,
        unsent_quantity_total,
        active_quantity_total,

        review_open_count,
        corrected_count,
        ignored_count,
        deferred_count,

        gross_received,
        adjusted_received,
        actual_point_total,
        confirmed_cut_total,
        remaining_safe_capacity
      )
    select
      r.id,
      r.settlement_session_id,
      r.summary_group_id,
      r.round_no,
      r.opened_at,
      r.closed_at,

      v_changed_at,

      (
        select count(*)::bigint
        from public.messages m
        where
          m.summary_group_round_id =
            r.id
      ),

      (
        select count(*)::bigint
        from public.messages m
        where
          m.summary_group_round_id =
            r.id
          and m.message_type =
            'image'
      ),

      (
        select count(*)::bigint
        from public.order_items oi
        where
          oi.summary_group_round_id =
            r.id
      ),

      (
        select
          coalesce(
            sum(oi.quantity),
            0
          )::bigint
        from public.order_items oi
        where
          oi.summary_group_round_id =
            r.id
      ),

      (
        select
          coalesce(
            sum(
              case
                when oi.unsent_flag
                  then oi.quantity
                else 0
              end
            ),
            0
          )::bigint
        from public.order_items oi
        where
          oi.summary_group_round_id =
            r.id
      ),

      (
        select
          coalesce(
            sum(
              case
                when oi.unsent_flag
                  then 0
                else oi.quantity
              end
            ),
            0
          )::bigint
        from public.order_items oi
        where
          oi.summary_group_round_id =
            r.id
      ),

      (
        select count(*)::bigint
        from public.review_items rv
        join public.messages m
          on m.id =
            rv.message_record_id
        where
          m.summary_group_round_id =
            r.id
          and rv.status =
            'OPEN'
      ),

      (
        select count(*)::bigint
        from public.review_resolution_events e
        join public.messages m
          on m.id =
            e.message_record_id
        where
          m.summary_group_round_id =
            r.id
          and e.action =
            'CORRECTED'
      ),

      (
        select count(*)::bigint
        from public.review_resolution_events e
        join public.messages m
          on m.id =
            e.message_record_id
        where
          m.summary_group_round_id =
            r.id
          and e.action =
            'IGNORED'
      ),

      (
        select count(*)::bigint
        from public.review_resolution_events e
        join public.messages m
          on m.id =
            e.message_record_id
        where
          m.summary_group_round_id =
            r.id
          and e.action =
            'DEFERRED'
      ),

      risk.gross_received,
      risk.adjusted_received,
      risk.actual_point_total,
      risk.confirmed_cut_total,
      risk.remaining_safe_capacity

    from
      public.settlement_summary_group_rounds r

    left join
      public.session_overall_risk_state risk
      on risk.settlement_session_id =
           r.settlement_session_id
     and risk.summary_group_id =
           r.summary_group_id

    where r.id =
      v_previous_round_id

    on conflict (round_id)
    do update set
      captured_at =
        excluded.captured_at,

      message_count =
        excluded.message_count,

      image_message_count =
        excluded.image_message_count,

      order_item_count =
        excluded.order_item_count,

      order_quantity_total =
        excluded.order_quantity_total,

      unsent_quantity_total =
        excluded.unsent_quantity_total,

      active_quantity_total =
        excluded.active_quantity_total,

      review_open_count =
        excluded.review_open_count,

      corrected_count =
        excluded.corrected_count,

      ignored_count =
        excluded.ignored_count,

      deferred_count =
        excluded.deferred_count,

      gross_received =
        excluded.gross_received,

      adjusted_received =
        excluded.adjusted_received,

      actual_point_total =
        excluded.actual_point_total,

      confirmed_cut_total =
        excluded.confirmed_cut_total,

      remaining_safe_capacity =
        excluded.remaining_safe_capacity;


    -- Queue private Review evidence before deleting message metadata.
    insert into
      public.settlement_round_storage_cleanup_queue (
        round_id,
        storage_bucket,
        storage_path,
        status,
        queued_at
      )
    select distinct
      v_previous_round_id,
      'review-images',
      m.image_storage_path,
      'PENDING',
      v_changed_at
    from public.messages m
    where
      m.settlement_session_id =
        p_settlement_session_id
      and m.summary_group_id =
        p_summary_group_id
      and (
        m.summary_group_round_id =
          v_previous_round_id
        or m.summary_group_round_id
          is null
      )
      and coalesce(
        m.image_storage_path,
        ''
      ) <> ''

    on conflict (
      round_id,
      storage_bucket,
      storage_path
    )
    do update set
      status =
        'PENDING',
      queued_at =
        excluded.queued_at,
      attempted_at =
        null,
      deleted_at =
        null,
      last_error =
        null;


    -- --------------------------------------------------------
    -- FK-safe operational message purge.
    -- --------------------------------------------------------

    delete from
      public.review_resolution_events e
    where exists (
      select 1
      from public.messages m
      where
        m.id =
          e.message_record_id
        and m.settlement_session_id =
          p_settlement_session_id
        and m.summary_group_id =
          p_summary_group_id
        and (
          m.summary_group_round_id =
            v_previous_round_id
          or m.summary_group_round_id
            is null
        )
    );


    delete from
      public.unsend_events u
    where exists (
      select 1
      from public.messages m
      where
        m.id =
          u.matched_message_record_id
        and m.settlement_session_id =
          p_settlement_session_id
        and m.summary_group_id =
          p_summary_group_id
        and (
          m.summary_group_round_id =
            v_previous_round_id
          or m.summary_group_round_id
            is null
        )
    );


    delete from public.messages m
    where
      m.settlement_session_id =
        p_settlement_session_id
      and m.summary_group_id =
        p_summary_group_id
      and (
        m.summary_group_round_id =
          v_previous_round_id
        or m.summary_group_round_id
          is null
      );


    get diagnostics
      v_purged_messages =
        row_count;


    -- --------------------------------------------------------
    -- Session+Summary operational state.
    --
    -- These tables currently do not carry round_id, so they must
    -- be cleared for this group before the same parent/session is
    -- reused by its next round.
    -- --------------------------------------------------------

    delete from
      public.settlement_transfer_batches
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;


    delete from
      public.settlement_distribution_runs
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;


    delete from
      public.settlement_allocation_confirmations
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;


    delete from
      public.allocation_confirmation_events
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;


    delete from
      public.settlement_summary_group_actual_special_point_codes
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;


    -- Deliberately preserved:
    -- settlement_line_group_config
    -- settlement_allocation_rules
    -- settlement_point_profiles
    -- settlement_point_promotions
    -- settlement_point_promotion_events
    -- settlement_promotion_rules
    -- settlement_summary_group_control_events
    -- settlement_summary_group_rounds
  end if;


  -- ==========================================================
  -- Create next independent Round.
  -- ==========================================================

  insert into
    public.settlement_summary_group_rounds (
      settlement_session_id,
      summary_group_id,
      round_no,
      status,
      opened_at,
      opened_by
    )
  values (
    p_settlement_session_id,
    p_summary_group_id,
    v_next_round_no,
    'OPEN',
    v_changed_at,
    p_changed_by
  )
  returning id
    into v_new_round_id;


  -- Compatibility mirror:
  -- absence of control row still means accepting to old JS readers.
  delete from
    public.settlement_summary_group_controls
  where
    settlement_session_id =
      p_settlement_session_id
    and summary_group_id =
      p_summary_group_id;


  insert into
    public.settlement_summary_group_control_events (
      settlement_session_id,
      summary_group_id,
      previous_accepting_orders,
      new_accepting_orders,
      changed_at,
      changed_by
    )
  values (
    p_settlement_session_id,
    p_summary_group_id,
    false,
    true,
    v_changed_at,
    p_changed_by
  );


  if v_previous_round_id is not null then
    select
      coalesce(
        jsonb_agg(
          q.storage_path
          order by q.storage_path
        ),
        '[]'::jsonb
      )
    into
      v_image_storage_paths
    from
      public.settlement_round_storage_cleanup_queue q
    where
      q.round_id =
        v_previous_round_id
      and q.status =
        'PENDING';
  end if;


  return jsonb_build_object(
    'settlement_session_id',
      p_settlement_session_id,

    'summary_group_id',
      p_summary_group_id,

    'accepting_orders',
      true,

    'changed',
      true,

    'round_id',
      v_new_round_id,

    'round_no',
      v_next_round_no,

    'opened_at',
      v_changed_at,

    'reset_from_round_id',
      v_previous_round_id,

    'reset_from_round_no',
      v_previous_round_no,

    'purged_message_count',
      v_purged_messages,

    'image_storage_bucket',
      'review-images',

    'image_storage_paths',
      v_image_storage_paths
  );
end;
$$;


-- ============================================================
-- 6. Canonical accounting boundary stays serialized
--    against OPEN_GROUP/CLOSE_GROUP and now reads Round state.
-- ============================================================

create or replace function
  public.enforce_order_item_summary_group_accepting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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


  if not
    public.is_settlement_summary_group_accepting(
      new.settlement_session_id,
      new.summary_group_id
    )
  then
    raise exception
      'SUMMARY_GROUP_CLOSED';
  end if;


  return new;
end;
$$;


-- ============================================================
-- 7. Security
-- ============================================================

revoke all
on function
  public.is_settlement_summary_group_accepting(uuid,text)
from public, anon, authenticated;


grant execute
on function
  public.is_settlement_summary_group_accepting(uuid,text)
to service_role;


revoke all
on function
  public.set_settlement_summary_group_accepting(
    uuid,
    text,
    boolean,
    text
  )
from public, anon, authenticated;


grant execute
on function
  public.set_settlement_summary_group_accepting(
    uuid,
    text,
    boolean,
    text
  )
to service_role;


revoke all
on function
  public.enforce_order_item_summary_group_accepting()
from public, anon, authenticated;


grant execute
on function
  public.enforce_order_item_summary_group_accepting()
to service_role;
