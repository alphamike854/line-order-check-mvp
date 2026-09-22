
-- Export Preparation Phase 2F2B2A
-- Dedicated Export Destination Registry Foundation.
--
-- No operational destination rows are inserted.
-- No Mirror route is created or changed.
-- No Allocation / Risk state is changed.
-- No OA/token routing is introduced.

begin;


-- ============================================================
-- 1. Dedicated registry
-- ============================================================

create table
  public.export_destination_line_groups (
    line_group_id text primary key,

    label text not null,

    enabled boolean not null
      default false,

    verification_source text not null
      default 'MANUAL_VERIFIED',

    created_at timestamptz not null
      default now(),

    created_by text not null
      default 'SYSTEM',

    updated_at timestamptz not null
      default now(),

    updated_by text not null
      default 'SYSTEM',

    constraint
      export_destination_line_groups_id_check
      check (
        length(trim(line_group_id))
          between 1 and 255
      ),

    constraint
      export_destination_line_groups_label_check
      check (
        length(trim(label))
          between 1 and 255
      ),

    constraint
      export_destination_line_groups_verification_check
      check (
        length(trim(verification_source))
          between 1 and 100
      )
  );

create index
  export_destination_line_groups_enabled_idx
on
  public.export_destination_line_groups (
    enabled,
    line_group_id
  );


-- ============================================================
-- 2. Destination identity serialization
-- ============================================================

create or replace function
  public.lock_export_destination(
    p_line_group_id text
  )
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line_group_id text;
begin
  v_line_group_id :=
    nullif(
      trim(
        coalesce(
          p_line_group_id,
          ''
        )
      ),
      ''
    );

  if v_line_group_id is null then
    raise exception
      'EXPORT_DESTINATION_REQUIRED';
  end if;

  perform
    pg_advisory_xact_lock(
      hashtext(
        'EXPORT_DESTINATION'
      ),
      hashtext(
        v_line_group_id
      )
    );
end;
$$;


-- ============================================================
-- 3. Canonical runtime assertion
--
-- Returns canonical server-owned destination label.
-- ============================================================

create or replace function
  public.assert_export_destination_allowed(
    p_line_group_id text
  )
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line_group_id text;
  v_label text;
begin
  v_line_group_id :=
    nullif(
      trim(
        coalesce(
          p_line_group_id,
          ''
        )
      ),
      ''
    );

  if v_line_group_id is null then
    raise exception
      'EXPORT_DESTINATION_REQUIRED';
  end if;

  perform
    public.lock_export_destination(
      v_line_group_id
    );

  select
    d.label
  into
    v_label
  from
    public.export_destination_line_groups d
  where
    d.line_group_id =
      v_line_group_id
    and d.enabled = true;

  if not found then
    raise exception
      'EXPORT_DESTINATION_NOT_ALLOWED';
  end if;

  if exists (
    select 1
    from
      public.line_groups g
    where
      g.line_group_id =
        v_line_group_id
      and g.enabled = true
  )
  then
    raise exception
      'EXPORT_DESTINATION_ACTIVE_ORDER_GROUP';
  end if;

  if exists (
    select 1
    from
      public.settlement_line_group_round_config_working_context c
    where
      c.line_group_id =
        v_line_group_id
      and c.round_status =
        'OPEN'
  )
  then
    raise exception
      'EXPORT_DESTINATION_ACTIVE_OPEN_ROUND_INPUT';
  end if;

  return v_label;
end;
$$;


-- ============================================================
-- 4. Registry guard
-- ============================================================

create or replace function
  public.guard_export_destination_registry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_known boolean;
begin
  new.line_group_id :=
    trim(
      coalesce(
        new.line_group_id,
        ''
      )
    );

  new.label :=
    trim(
      coalesce(
        new.label,
        ''
      )
    );

  new.verification_source :=
    trim(
      coalesce(
        new.verification_source,
        ''
      )
    );

  if
    tg_op = 'UPDATE'
    and old.line_group_id
      is distinct from
        new.line_group_id
  then
    raise exception
      'EXPORT_DESTINATION_IDENTITY_IMMUTABLE';
  end if;

  perform
    public.lock_export_destination(
      new.line_group_id
    );

  if
    tg_op = 'UPDATE'
    and old.enabled = true
    and new.enabled = false
    and exists (
      select 1
      from
        public.settlement_export_deliveries d
      where
        d.destination_line_group_id =
          new.line_group_id
        and d.status in (
          'SENDING',
          'RETRYABLE',
          'AMBIGUOUS'
        )
    )
  then
    raise exception
      'EXPORT_DESTINATION_HAS_UNRESOLVED_DELIVERY';
  end if;

  if new.enabled = true then

    select (
      exists (
        select 1
        from public.line_groups g
        where
          g.line_group_id =
            new.line_group_id
      )
      or exists (
        select 1
        from public.webhook_events e
        where
          e.line_group_id =
            new.line_group_id
      )
      or exists (
        select 1
        from public.line_message_mirror_routes r
        where
          r.destination_line_group_id =
            new.line_group_id
      )
    )
    into
      v_known;

    if not coalesce(v_known, false) then
      raise exception
        'EXPORT_DESTINATION_LINE_ROOM_NOT_KNOWN';
    end if;

    if exists (
      select 1
      from public.line_groups g
      where
        g.line_group_id =
          new.line_group_id
        and g.enabled = true
    )
    then
      raise exception
        'EXPORT_DESTINATION_ACTIVE_ORDER_GROUP';
    end if;

    if exists (
      select 1
      from
        public.settlement_line_group_round_config_working_context c
      where
        c.line_group_id =
          new.line_group_id
        and c.round_status =
          'OPEN'
    )
    then
      raise exception
        'EXPORT_DESTINATION_ACTIVE_OPEN_ROUND_INPUT';
    end if;

  end if;

  new.updated_at :=
    now();

  return new;
end;
$$;

create trigger
  export_destination_registry_guard_trg
before insert or update
on
  public.export_destination_line_groups
for each row
execute function
  public.guard_export_destination_registry();


-- ============================================================
-- 5. Unresolved-delivery delete protection
-- ============================================================

create or replace function
  public.guard_export_destination_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform
    public.lock_export_destination(
      old.line_group_id
    );

  if exists (
    select 1
    from
      public.settlement_export_deliveries d
    where
      d.destination_line_group_id =
        old.line_group_id
      and d.status in (
        'SENDING',
        'RETRYABLE',
        'AMBIGUOUS'
      )
  )
  then
    raise exception
      'EXPORT_DESTINATION_HAS_UNRESOLVED_DELIVERY';
  end if;

  return old;
end;
$$;

create trigger
  export_destination_delete_guard_trg
before delete
on
  public.export_destination_line_groups
for each row
execute function
  public.guard_export_destination_delete();


-- ============================================================
-- 6. Reciprocal order-input guard
-- ============================================================

create or replace function
  public.guard_line_group_from_export_destination()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.enabled = true then

    perform
      public.lock_export_destination(
        new.line_group_id
      );

    if exists (
      select 1
      from
        public.export_destination_line_groups d
      where
        d.line_group_id =
          new.line_group_id
        and d.enabled = true
    )
    then
      raise exception
        'LINE_GROUP_IS_ACTIVE_EXPORT_DESTINATION';
    end if;

  end if;

  return new;
end;
$$;

create trigger
  line_group_export_destination_guard_trg
before insert or update
on
  public.line_groups
for each row
execute function
  public.guard_line_group_from_export_destination();


-- ============================================================
-- 7. Reciprocal Round-config guard
-- ============================================================

create or replace function
  public.guard_round_config_from_export_destination()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round_status text;
begin
  perform
    public.lock_export_destination(
      new.line_group_id
    );

  select
    r.status
  into
    v_round_status
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      new.round_id;

  if
    v_round_status = 'OPEN'
    and exists (
      select 1
      from
        public.export_destination_line_groups d
      where
        d.line_group_id =
          new.line_group_id
        and d.enabled = true
    )
  then
    raise exception
      'OPEN_ROUND_LINE_GROUP_IS_EXPORT_DESTINATION';
  end if;

  return new;
end;
$$;

create trigger
  round_config_export_destination_guard_trg
before insert or update
on
  public.settlement_line_group_round_config
for each row
execute function
  public.guard_round_config_from_export_destination();


-- ============================================================
-- 8. READY boundary
--
-- Browser destination_label is not authoritative.
-- Registry label replaces it here.
-- ============================================================

create or replace function
  public.guard_export_cycle_ready_destination()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'READY' then

    new.destination_label :=
      public.assert_export_destination_allowed(
        new.destination_line_group_id
      );

  end if;

  return new;
end;
$$;

create trigger
  export_cycle_ready_destination_guard_trg
before update
on
  public.settlement_export_cycles
for each row
when (
  new.status = 'READY'
)
execute function
  public.guard_export_cycle_ready_destination();


-- ============================================================
-- 9. Transport SENDING / retry boundary
--
-- ACKNOWLEDGED is deliberately not revalidated after LINE has
-- accepted the external request.
-- ============================================================

create or replace function
  public.guard_export_delivery_sending_destination()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'SENDING' then

    perform
      public.assert_export_destination_allowed(
        new.destination_line_group_id
      );

  end if;

  return new;
end;
$$;

create trigger
  export_delivery_sending_destination_guard_trg
before insert or update
on
  public.settlement_export_deliveries
for each row
when (
  new.status = 'SENDING'
)
execute function
  public.guard_export_delivery_sending_destination();


-- ============================================================
-- 10. Security
-- ============================================================

alter table
  public.export_destination_line_groups
enable row level security;

revoke all
on table
  public.export_destination_line_groups
from public, anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on table
  public.export_destination_line_groups
to service_role;

revoke all
on function
  public.lock_export_destination(text)
from public, anon, authenticated;

revoke all
on function
  public.assert_export_destination_allowed(text)
from public, anon, authenticated;

grant execute
on function
  public.assert_export_destination_allowed(text)
to service_role;


-- ============================================================
-- EXPORT DESTINATION TRIGGER HELPERS — PRIVATE
--
-- SECURITY DEFINER trigger helpers execute through their trigger
-- boundary only. Browser/authenticated callers must never invoke
-- them directly.
-- ============================================================

revoke all
on function
  public.guard_export_destination_registry()
from public, anon, authenticated;

revoke all
on function
  public.guard_export_destination_delete()
from public, anon, authenticated;

revoke all
on function
  public.guard_line_group_from_export_destination()
from public, anon, authenticated;

revoke all
on function
  public.guard_round_config_from_export_destination()
from public, anon, authenticated;

revoke all
on function
  public.guard_export_cycle_ready_destination()
from public, anon, authenticated;

revoke all
on function
  public.guard_export_delivery_sending_destination()
from public, anon, authenticated;

comment on table
  public.export_destination_line_groups
is
  'Dedicated Export Preparation outbound LINE destination registry. Independent from Mirror routes and order-input LINE Groups.';

comment on function
  public.assert_export_destination_allowed(text)
is
  'Validates one enabled Export destination against current order-input master and OPEN Round lineage and returns its canonical server-owned label.';


-- ============================================================
-- 11. claim_webhook_event replacement follows below.
--
-- Generated from exact linked-DB function:
--   * existing Mirror query retained
--   * existing redaction retained
--   * existing terminal DENIED write retained
--   * one Export registry flag added
-- ============================================================


CREATE OR REPLACE FUNCTION public.claim_webhook_event(p_webhook_event_id text, p_destination text, p_event_type text, p_line_group_id text, p_user_id text, p_is_redelivery boolean, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event public.webhook_events%rowtype;
  v_is_export_destination boolean := false;
  v_is_mirror_destination boolean := false;
  v_stored_user_id text;
  v_stored_payload jsonb;
begin
  if coalesce(
    trim(p_webhook_event_id),
    ''
  ) = '' then
    raise exception
      'WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  if coalesce(
    trim(p_line_group_id),
    ''
  ) <> '' then
    select exists (
      select 1
      from public.export_destination_line_groups r
      where r.line_group_id =
            p_line_group_id
        and r.enabled = true
    )
      into v_is_export_destination;

  select exists (
    select 1
      from public.line_message_mirror_routes r
      where r.destination_line_group_id =
            p_line_group_id
        and r.enabled = true
    )
      into v_is_mirror_destination;
  end if;

  if v_is_mirror_destination or v_is_export_destination then
    v_stored_user_id := null;
    v_stored_payload := '{}'::jsonb;
  else
    v_stored_user_id := p_user_id;
    v_stored_payload :=
      coalesce(
        p_payload,
        '{}'::jsonb
      );
  end if;

  insert into public.webhook_events (
    webhook_event_id,
    destination,
    event_type,
    line_group_id,
    user_id,
    is_redelivery,
    payload
  )
  values (
    p_webhook_event_id,
    p_destination,
    p_event_type,
    p_line_group_id,
    v_stored_user_id,
    coalesce(
      p_is_redelivery,
      false
    ),
    v_stored_payload
  )
  on conflict (
    webhook_event_id
  ) do nothing;

  select *
    into v_event
  from public.webhook_events
  where webhook_event_id =
        p_webhook_event_id
  for update;

  if not found then
    raise exception
      'WEBHOOK_EVENT_NOT_FOUND';
  end if;

  if v_event.destination
       is distinct from
       p_destination
     or v_event.event_type
       is distinct from
       p_event_type then
    raise exception
      'WEBHOOK_EVENT_IDENTITY_MISMATCH';
  end if;

  if v_is_mirror_destination or v_is_export_destination then
    update public.webhook_events
    set
      user_id = null,
      payload = '{}'::jsonb,
      processed_at =
        coalesce(
          processed_at,
          now()
        ),
      processing_started_at = null,
      attempt_count =
        attempt_count + 1,
      is_redelivery =
        is_redelivery
        or coalesce(
          p_is_redelivery,
          false
        ),
      last_error = null
    where webhook_event_id =
          p_webhook_event_id
    returning *
      into v_event;

    return jsonb_build_object(
      'state',
        'DENIED',
      'reason',
        case
          when v_is_export_destination then
            'EXPORT_DESTINATION'
          else
            'MIRROR_DESTINATION'
        end,
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  if v_event.processed_at
       is not null then
    return jsonb_build_object(
      'state',
        'DONE',
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  if v_event.processing_started_at
       is not null
     and v_event.processing_started_at >
         now() - interval '2 minutes' then
    return jsonb_build_object(
      'state',
        'IN_FLIGHT',
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  update public.webhook_events
  set
    processing_started_at = now(),
    attempt_count =
      attempt_count + 1,
    is_redelivery =
      v_event.is_redelivery
      or coalesce(
        p_is_redelivery,
        false
      ),
    user_id = p_user_id,
    payload =
      coalesce(
        p_payload,
        v_event.payload
      ),
    last_error = null
  where webhook_event_id =
        p_webhook_event_id;

  return jsonb_build_object(
    'state',
      'CLAIMED',
    'attempt_count',
      v_event.attempt_count + 1
  );
end;
$function$;


-- Reassert existing webhook claim RPC privilege boundary after
-- replacing its definition with Export destination classification.
revoke all
on function
  public.claim_webhook_event(
    text,
    text,
    text,
    text,
    text,
    boolean,
    jsonb
  )
from public, anon, authenticated;

grant execute
on function
  public.claim_webhook_event(
    text,
    text,
    text,
    text,
    text,
    boolean,
    jsonb
  )
to service_role;

commit;
