-- Mirror Route Settings MR1H
--
-- Goals:
-- 1. MIRROR_ROUTE is a valid Settings audit entity.
-- 2. Route source/destination identity becomes immutable after creation.
-- 3. Route mutation + Settings audit share one PostgreSQL transaction.
-- 4. Enabling a route cannot target an active order-input group,
--    including immutable membership in an OPEN Summary Group Round.
-- 5. Repair the one known MR1 partial-write audit without recreating
--    or updating that route.
--
-- This migration deliberately does NOT enable any Mirror route.
-- It does NOT change Summary Group/Round lifecycle state.
-- It does NOT send LINE messages.

begin;


-- ============================================================
-- 1. Settings audit accepts MIRROR_ROUTE
-- ============================================================

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    where
      c.conrelid =
        'public.settings_change_events'::regclass
      and c.conname =
        'settings_change_events_entity_type_check'
  ) then
    alter table public.settings_change_events
      drop constraint
        settings_change_events_entity_type_check;
  end if;

  alter table public.settings_change_events
    add constraint
      settings_change_events_entity_type_check
    check (
      entity_type in (
        'SUMMARY_GROUP',
        'LINE_GROUP',
        'ALLOCATION_RULE',
        'CATEGORY_ALIAS',
        'POINT_PROFILE',
        'RISK_CUT_POLICY',
        'RISK_BUDGET',
        'WAREHOUSE_LIMIT',
        'MIRROR_ROUTE'
      )
    );
end
$$;


-- ============================================================
-- 2. Route identity is immutable at the table boundary
-- ============================================================

create or replace function
  public.enforce_line_message_mirror_route_identity_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if
    old.source_line_group_id
      is distinct from
        new.source_line_group_id
    or
    old.destination_line_group_id
      is distinct from
        new.destination_line_group_id
  then
    raise exception
      'MIRROR_ROUTE_IDENTITY_IMMUTABLE';
  end if;

  return new;
end;
$$;


drop trigger if exists
  line_message_mirror_route_identity_immutable_trg
on public.line_message_mirror_routes;


create trigger
  line_message_mirror_route_identity_immutable_trg
before update of
  source_line_group_id,
  destination_line_group_id
on public.line_message_mirror_routes
for each row
execute function
  public.enforce_line_message_mirror_route_identity_immutable();


-- ============================================================
-- 2B. Symmetric Mirror destination / order-input boundary
-- ============================================================
--
-- Invariant:
--
-- An enabled Mirror destination must never simultaneously become
-- an enabled order-input identity.
--
-- Every relevant boundary serializes on the same transaction-level
-- advisory key:
--
--   MIRROR_ORDER_INPUT_BOUNDARY|<LINE_GROUP_ID>
--
-- The guard lives at DB/table boundaries so direct service-role
-- writes cannot bypass the Settings RPC policy.


-- ------------------------------------------------------------
-- 2B-1. Mirror route activation boundary
-- ------------------------------------------------------------

create or replace function
  public.enforce_mirror_route_activation_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.enabled is not true then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'MIRROR_ORDER_INPUT_BOUNDARY',
        new.destination_line_group_id
      ),
      0
    )
  );

  -- Master/current LINE Group registry.
  if exists (
    select 1
    from public.line_groups lg
    where
      lg.line_group_id =
        new.destination_line_group_id
      and lg.enabled = true
  ) then
    raise exception
      'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  -- Current/future admission route in the active parent settlement.
  if exists (
    select 1
    from public.settlement_line_group_config cfg
    join public.settlement_sessions s
      on s.id =
        cfg.settlement_session_id
    where
      s.status = 'OPEN'
      and cfg.line_group_id =
        new.destination_line_group_id
      and cfg.enabled = true
  ) then
    raise exception
      'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  -- Immutable membership in an already OPEN Round.
  if exists (
    select 1
    from public.settlement_summary_group_rounds r
    join public.settlement_line_group_round_config cfg
      on cfg.round_id = r.id
    where
      r.status = 'OPEN'
      and cfg.line_group_id =
        new.destination_line_group_id
  ) then
    raise exception
      'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  return new;
end;
$$;


drop trigger if exists
  line_message_mirror_route_activation_boundary_trg
on public.line_message_mirror_routes;


create trigger
  line_message_mirror_route_activation_boundary_trg
before insert
or update of
  enabled
on public.line_message_mirror_routes
for each row
execute function
  public.enforce_mirror_route_activation_boundary();


-- ------------------------------------------------------------
-- 2B-2. Master LINE Group enable boundary
-- ------------------------------------------------------------

create or replace function
  public.enforce_line_group_mirror_destination_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.enabled is not true then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'MIRROR_ORDER_INPUT_BOUNDARY',
        new.line_group_id
      ),
      0
    )
  );

  if exists (
    select 1
    from public.line_message_mirror_routes r
    where
      r.destination_line_group_id =
        new.line_group_id
      and r.enabled = true
  ) then
    raise exception
      'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  return new;
end;
$$;


drop trigger if exists
  line_group_mirror_destination_boundary_trg
on public.line_groups;


create trigger
  line_group_mirror_destination_boundary_trg
before insert
or update of
  enabled
on public.line_groups
for each row
execute function
  public.enforce_line_group_mirror_destination_boundary();


-- ------------------------------------------------------------
-- 2B-3. Current settlement route enable boundary
-- ------------------------------------------------------------
--
-- A config belonging only to a CLOSED parent settlement is historical
-- configuration and is not an active order-input route.
--
-- The guard applies when the owning parent settlement is OPEN.

create or replace function
  public.enforce_settlement_line_group_mirror_destination_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.enabled is not true then
    return new;
  end if;

  if not exists (
    select 1
    from public.settlement_sessions s
    where
      s.id = new.settlement_session_id
      and s.status = 'OPEN'
  ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'MIRROR_ORDER_INPUT_BOUNDARY',
        new.line_group_id
      ),
      0
    )
  );

  if exists (
    select 1
    from public.line_message_mirror_routes r
    where
      r.destination_line_group_id =
        new.line_group_id
      and r.enabled = true
  ) then
    raise exception
      'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  return new;
end;
$$;


drop trigger if exists
  settlement_line_group_mirror_destination_boundary_trg
on public.settlement_line_group_config;


create trigger
  settlement_line_group_mirror_destination_boundary_trg
before insert
or update of
  enabled,
  line_group_id,
  settlement_session_id
on public.settlement_line_group_config
for each row
execute function
  public.enforce_settlement_line_group_mirror_destination_boundary();


-- ------------------------------------------------------------
-- 2B-4. OPEN Round boundary
-- ------------------------------------------------------------
--
-- All enabled LINE Groups that are about to enter the new Round are
-- locked in deterministic LINE Group order.
--
-- This trigger runs BEFORE Round INSERT. The existing AFTER INSERT
-- lineage-capture trigger remains unchanged.
--
-- Any conflict raises inside the same OPEN_GROUP transaction, so the
-- Round INSERT and all downstream lineage capture are rolled back.

create or replace function
  public.enforce_open_round_mirror_destination_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_group_id text;
begin
  if new.status <> 'OPEN' then
    return new;
  end if;

  for v_line_group_id in
    select cfg.line_group_id
    from public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id =
        new.settlement_session_id
      and cfg.summary_group_id =
        new.summary_group_id
      and cfg.enabled = true
    order by cfg.line_group_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          'MIRROR_ORDER_INPUT_BOUNDARY',
          v_line_group_id
        ),
        0
      )
    );

    if exists (
      select 1
      from public.line_message_mirror_routes r
      where
        r.destination_line_group_id =
          v_line_group_id
        and r.enabled = true
    ) then
      raise exception
        'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
    end if;
  end loop;

  return new;
end;
$$;


drop trigger if exists
  settlement_round_mirror_destination_boundary_trg
on public.settlement_summary_group_rounds;


create trigger
  settlement_round_mirror_destination_boundary_trg
before insert
on public.settlement_summary_group_rounds
for each row
when (new.status = 'OPEN')
execute function
  public.enforce_open_round_mirror_destination_boundary();


-- ============================================================
-- 3. Atomic service-role Mirror Route Settings mutation
-- ============================================================

create or replace function
  public.save_mirror_route_settings(
    p_route_id uuid,
    p_source_line_group_id text,
    p_destination_line_group_id text,
    p_enabled boolean,
    p_max_batch_size integer,
    p_flush_after_seconds integer,
    p_changed_by text
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_line_group_id text :=
    btrim(
      coalesce(
        p_source_line_group_id,
        ''
      )
    );

  v_destination_line_group_id text :=
    btrim(
      coalesce(
        p_destination_line_group_id,
        ''
      )
    );

  v_changed_by text :=
    coalesce(
      nullif(
        btrim(
          coalesce(
            p_changed_by,
            ''
          )
        ),
        ''
      ),
      'DASHBOARD'
    );

  v_before
    public.line_message_mirror_routes%rowtype;

  v_saved
    public.line_message_mirror_routes%rowtype;

  v_source_enabled boolean;
  v_destination_enabled boolean;
  v_destination_configured boolean := false;
begin
  if v_source_line_group_id = '' then
    raise exception
      'MIRROR_SOURCE_NOT_FOUND';
  end if;

  if v_destination_line_group_id = '' then
    raise exception
      'MIRROR_DESTINATION_NOT_FOUND';
  end if;

  if
    v_source_line_group_id =
      v_destination_line_group_id
  then
    raise exception
      'MIRROR_ROUTE_SELF';
  end if;

  if p_enabled is null then
    raise exception
      'INVALID_BOOLEAN';
  end if;

  if
    p_max_batch_size is null
    or p_max_batch_size < 1
    or p_max_batch_size > 5
  then
    raise exception
      'MIRROR_ROUTE_INVALID_BATCH_SIZE';
  end if;

  if
    p_flush_after_seconds is null
    or p_flush_after_seconds < 5
    or p_flush_after_seconds > 300
  then
    raise exception
      'MIRROR_ROUTE_INVALID_FLUSH_SECONDS';
  end if;


  -- Existing route identity is locked and immutable.
  if p_route_id is not null then
    select r.*
    into v_before
    from public.line_message_mirror_routes r
    where r.id = p_route_id
    for update;

    if not found then
      raise exception
        'MIRROR_ROUTE_NOT_FOUND';
    end if;

    if
      v_before.source_line_group_id
        is distinct from
          v_source_line_group_id
      or
      v_before.destination_line_group_id
        is distinct from
          v_destination_line_group_id
    then
      raise exception
        'MIRROR_ROUTE_IDENTITY_IMMUTABLE';
    end if;
  end if;


  -- Serialize Mirror activation against every order-input boundary.
  --
  -- Disabled saves do not reserve the destination and therefore do
  -- not need this cross-domain lock.
  if p_enabled then
    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          'MIRROR_ORDER_INPUT_BOUNDARY',
          v_destination_line_group_id
        ),
        0
      )
    );
  end if;


  -- A Mirror source must remain a configured LINE Group.
  select lg.enabled
  into v_source_enabled
  from public.line_groups lg
  where
    lg.line_group_id =
      v_source_line_group_id;

  if not found then
    raise exception
      'MIRROR_SOURCE_NOT_FOUND';
  end if;


  -- Preserve MR1 destination registry semantics:
  -- a destination may be configured, observed, or already known
  -- as a Mirror destination.
  select lg.enabled
  into v_destination_enabled
  from public.line_groups lg
  where
    lg.line_group_id =
      v_destination_line_group_id;

  v_destination_configured := found;

  if
    not v_destination_configured
    and not exists (
      select 1
      from public.webhook_events e
      where
        e.line_group_id =
          v_destination_line_group_id
    )
    and not exists (
      select 1
      from public.line_message_mirror_routes r
      where
        r.destination_line_group_id =
          v_destination_line_group_id
    )
  then
    raise exception
      'MIRROR_DESTINATION_NOT_FOUND';
  end if;


  if p_enabled then
    if not v_source_enabled then
      raise exception
        'MIRROR_SOURCE_DISABLED';
    end if;

    -- Master/current input registry guard.
    if
      v_destination_configured
      and v_destination_enabled
    then
      raise exception
        'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
    end if;

    -- Active parent/current admission-route guard.
    if exists (
      select 1
      from public.settlement_line_group_config cfg
      join public.settlement_sessions s
        on s.id = cfg.settlement_session_id
      where
        s.status = 'OPEN'
        and cfg.line_group_id =
          v_destination_line_group_id
        and cfg.enabled = true
    ) then
      raise exception
        'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
    end if;

    -- Operational authority guard.
    -- A destination captured in any OPEN Summary Group Round
    -- is still an active order-input identity even if its
    -- current master row has since been disabled.
    if exists (
      select 1
      from
        public.settlement_summary_group_rounds r
      join
        public.settlement_line_group_round_config cfg
        on cfg.round_id = r.id
      where
        r.status = 'OPEN'
        and cfg.line_group_id =
          v_destination_line_group_id
    ) then
      raise exception
        'MIRROR_DESTINATION_ACTIVE_ORDER_GROUP';
    end if;
  end if;


  if p_route_id is not null then
    -- Identity columns deliberately do not appear in UPDATE.
    update public.line_message_mirror_routes
    set
      enabled =
        p_enabled,
      max_batch_size =
        p_max_batch_size::smallint,
      flush_after_seconds =
        p_flush_after_seconds,
      updated_at =
        now()
    where
      id = p_route_id
    returning *
      into v_saved;

  else
    if exists (
      select 1
      from public.line_message_mirror_routes r
      where
        r.source_line_group_id =
          v_source_line_group_id
        and r.destination_line_group_id =
          v_destination_line_group_id
    ) then
      raise exception
        'MIRROR_ROUTE_DUPLICATE';
    end if;

    begin
      insert into public.line_message_mirror_routes (
        source_line_group_id,
        destination_line_group_id,
        enabled,
        max_batch_size,
        flush_after_seconds,
        updated_at
      )
      values (
        v_source_line_group_id,
        v_destination_line_group_id,
        p_enabled,
        p_max_batch_size::smallint,
        p_flush_after_seconds,
        now()
      )
      returning *
        into v_saved;

    exception
      when unique_violation then
        raise exception
          'MIRROR_ROUTE_DUPLICATE';
    end;
  end if;


  -- This INSERT is in the same PostgreSQL transaction as
  -- the route INSERT/UPDATE above. Any audit failure rolls
  -- back the route mutation.
  insert into public.settings_change_events (
    entity_type,
    entity_key,
    action,
    before_data,
    after_data,
    changed_by
  )
  values (
    'MIRROR_ROUTE',
    v_saved.id::text,
    'UPSERT',
    case
      when p_route_id is null
        then null
      else to_jsonb(v_before)
    end,
    to_jsonb(v_saved),
    v_changed_by
  );


  return jsonb_build_object(
    'route',
    to_jsonb(v_saved)
  );
end;
$$;


revoke all on function
  public.save_mirror_route_settings(
    uuid,
    text,
    text,
    boolean,
    integer,
    integer,
    text
  )
from public, anon, authenticated;


grant execute on function
  public.save_mirror_route_settings(
    uuid,
    text,
    text,
    boolean,
    integer,
    integer,
    text
  )
to service_role;


-- ============================================================
-- 4. One-time repair of the known MR1 partial write
-- ============================================================
--
-- The original Settings request inserted this exact disabled route,
-- then failed while writing its audit because MIRROR_ROUTE was not
-- yet permitted by settings_change_events_entity_type_check.
--
-- Never recreate or update the route here. If the known ID exists
-- with different business identity/state, fail the migration.

do $$
declare
  v_route
    public.line_message_mirror_routes%rowtype;
begin
  select r.*
  into v_route
  from public.line_message_mirror_routes r
  where
    r.id =
      '39c6877e-5a05-4592-ac68-fbcc163c2a9a'
        ::uuid;

  if not found then
    -- Non-production environments may never have experienced
    -- the partial write. Nothing to repair there.
    return;
  end if;

  if
    v_route.source_line_group_id
      <> 'C4212b95275363a5ea933f25965ab207e'
    or
    v_route.destination_line_group_id
      <> 'C0eb57909d1308627bf504614228c360b'
    or
    v_route.enabled is distinct from false
    or
    v_route.max_batch_size <> 5
    or
    v_route.flush_after_seconds <> 30
  then
    raise exception
      'MIRROR_MR1_REPAIR_ROUTE_STATE_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.settings_change_events e
    where
      e.entity_type = 'MIRROR_ROUTE'
      and e.entity_key = v_route.id::text
  ) then
    insert into public.settings_change_events (
      entity_type,
      entity_key,
      action,
      before_data,
      after_data,
      changed_by
    )
    values (
      'MIRROR_ROUTE',
      v_route.id::text,
      'UPSERT',
      null,
      to_jsonb(v_route),
      'MIGRATION_REPAIR_MR1_PARTIAL_WRITE'
    );
  end if;
end
$$;


commit;
