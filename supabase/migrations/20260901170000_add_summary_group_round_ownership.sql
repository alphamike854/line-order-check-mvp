-- R2B v9.21
-- Summary Group Round Ownership Foundation
--
-- Goals:
-- 1. Add nullable round ownership to messages/order_items.
-- 2. Backfill legacy operational rows to round 1.
-- 3. Mirror legacy settlement/group lifecycle into round 1.
-- 4. Assign future messages to the mirrored OPEN round.
-- 5. Propagate order-item ownership from its authoritative message.
--
-- This phase does NOT:
-- - change OPEN_GROUP/CLOSE_GROUP API semantics
-- - allow closed-round Review correction
-- - introduce POST_CLOSE
-- - purge/reset operational data
-- - change existing RPC signatures


-- ============================================================
-- 1. Ownership columns
-- ============================================================

alter table public.messages
  add column if not exists
    summary_group_round_id uuid;

alter table public.order_items
  add column if not exists
    summary_group_round_id uuid;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'messages_summary_group_round_fk'
      and conrelid =
        'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint
        messages_summary_group_round_fk
      foreign key (
        summary_group_round_id
      )
      references
        public.settlement_summary_group_rounds(id);
  end if;


  if not exists (
    select 1
    from pg_constraint
    where conname =
      'order_items_summary_group_round_fk'
      and conrelid =
        'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint
        order_items_summary_group_round_fk
      foreign key (
        summary_group_round_id
      )
      references
        public.settlement_summary_group_rounds(id);
  end if;
end
$$;


create index if not exists
  messages_summary_group_round_idx
on public.messages (
  summary_group_round_id,
  event_timestamp,
  id
);


create index if not exists
  order_items_summary_group_round_idx
on public.order_items (
  summary_group_round_id,
  category,
  code
);


-- ============================================================
-- 2. Legacy backfill
-- ============================================================

update public.messages m
set
  summary_group_round_id = r.id
from public.settlement_summary_group_rounds r
where
  m.summary_group_round_id is null
  and m.settlement_session_id =
      r.settlement_session_id
  and m.summary_group_id =
      r.summary_group_id
  and r.round_no = 1;


-- Message is authoritative for order ownership.
update public.order_items oi
set
  summary_group_round_id =
    m.summary_group_round_id
from public.messages m
where
  oi.message_record_id = m.id
  and oi.summary_group_round_id is null
  and m.summary_group_round_id
      is not null;


-- ============================================================
-- 3. Ensure future compatibility settlements get round 1
-- ============================================================

create or replace function
  public.ensure_summary_group_round_for_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session
    public.settlement_sessions%rowtype;
begin
  if new.enabled is not true then
    return new;
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_ROUND',
        new.settlement_session_id::text,
        new.summary_group_id
      ),
      0
    )
  );


  select *
    into v_session
  from public.settlement_sessions
  where id =
    new.settlement_session_id;


  if not found then
    raise exception
      'SETTLEMENT_NOT_FOUND';
  end if;


  insert into
    public.settlement_summary_group_rounds (
      settlement_session_id,
      summary_group_id,
      round_no,
      status,
      opened_at,
      opened_by,
      closed_at,
      closed_by
    )
  values (
    new.settlement_session_id,
    new.summary_group_id,
    1,

    case
      when v_session.status = 'OPEN'
        then 'OPEN'
      else 'CLOSED'
    end,

    coalesce(
      v_session.opened_at,
      now()
    ),

    v_session.opened_by,

    case
      when v_session.status = 'CLOSED'
        then v_session.closed_at
      else null
    end,

    case
      when v_session.status = 'CLOSED'
        then v_session.closed_by
      else null
    end
  )
  on conflict (
    settlement_session_id,
    summary_group_id,
    round_no
  )
  do nothing;


  return new;
end;
$$;


drop trigger if exists
  settlement_line_group_config_round_trg
on public.settlement_line_group_config;


create trigger
  settlement_line_group_config_round_trg
after insert
or update of
  enabled,
  summary_group_id
on public.settlement_line_group_config
for each row
execute function
  public.ensure_summary_group_round_for_config();


-- ============================================================
-- 4. Mirror legacy Summary Group OPEN/CLOSE into round 1
--
-- Legacy contract:
--   no control row = OPEN
--   accepting_orders=false row = CLOSED
--
-- R2B mirrors that state only.
-- R2C+ will replace reopening with creation of a new round.
-- ============================================================

create or replace function
  public.sync_legacy_summary_group_control_to_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_summary_group_id text;
  v_accepting boolean;
  v_changed_at timestamptz;
  v_changed_by text;
  v_session
    public.settlement_sessions%rowtype;
begin
  if tg_op = 'DELETE' then
    v_session_id :=
      old.settlement_session_id;

    v_summary_group_id :=
      old.summary_group_id;

    v_accepting := true;

    v_changed_at :=
      coalesce(
        old.changed_at,
        now()
      );

    v_changed_by :=
      old.changed_by;
  else
    v_session_id :=
      new.settlement_session_id;

    v_summary_group_id :=
      new.summary_group_id;

    v_accepting :=
      new.accepting_orders;

    v_changed_at :=
      coalesce(
        new.changed_at,
        now()
      );

    v_changed_by :=
      new.changed_by;
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_ROUND',
        v_session_id::text,
        v_summary_group_id
      ),
      0
    )
  );


  select *
    into v_session
  from public.settlement_sessions
  where id = v_session_id;


  if not found then
    return coalesce(new, old);
  end if;


  update
    public.settlement_summary_group_rounds
  set
    status =
      case
        when
          v_session.status = 'OPEN'
          and v_accepting is true
        then 'OPEN'
        else 'CLOSED'
      end,

    closed_at =
      case
        when
          v_session.status = 'OPEN'
          and v_accepting is true
        then null

        when v_session.status = 'CLOSED'
        then coalesce(
          v_session.closed_at,
          v_changed_at
        )

        else v_changed_at
      end,

    closed_by =
      case
        when
          v_session.status = 'OPEN'
          and v_accepting is true
        then null

        when v_session.status = 'CLOSED'
        then coalesce(
          v_session.closed_by,
          v_changed_by
        )

        else v_changed_by
      end,

    updated_at = now()

  where
    settlement_session_id =
      v_session_id

    and summary_group_id =
      v_summary_group_id

    and round_no = 1;


  return coalesce(new, old);
end;
$$;


drop trigger if exists
  settlement_summary_group_control_round_trg
on public.settlement_summary_group_controls;


create trigger
  settlement_summary_group_control_round_trg
after insert
or update of
  accepting_orders,
  closed_at,
  changed_at,
  changed_by
or delete
on public.settlement_summary_group_controls
for each row
execute function
  public.sync_legacy_summary_group_control_to_round();


-- ============================================================
-- 5. Parent settlement CLOSE mirrors to all OPEN round-1 rows
-- ============================================================

create or replace function
  public.sync_closed_settlement_to_summary_group_rounds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    old.status is distinct from new.status
    and new.status = 'CLOSED'
  then
    update
      public.settlement_summary_group_rounds
    set
      status = 'CLOSED',
      closed_at =
        coalesce(
          new.closed_at,
          now()
        ),
      closed_by =
        new.closed_by,
      updated_at =
        now()
    where
      settlement_session_id =
        new.id
      and status = 'OPEN';
  end if;


  return new;
end;
$$;


drop trigger if exists
  settlement_sessions_round_close_sync_trg
on public.settlement_sessions;


create trigger
  settlement_sessions_round_close_sync_trg
after update of status
on public.settlement_sessions
for each row
execute function
  public.sync_closed_settlement_to_summary_group_rounds();


-- ============================================================
-- 6. Assign future messages to mirrored OPEN round
--
-- Keep existing global settlement assignment semantics intact.
-- ============================================================

create or replace function
  public.assign_message_to_open_settlement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session_id uuid;
  v_business_date date;
  v_summary_group_id text;
  v_round_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  select
    id,
    business_date
  into
    v_session_id,
    v_business_date
  from public.settlement_sessions
  where status = 'OPEN'
  limit 1;


  if v_session_id is null then
    new.settlement_session_id := null;
    new.summary_group_round_id := null;
    return new;
  end if;


  new.settlement_session_id :=
    v_session_id;

  new.business_date :=
    v_business_date;


  select
    summary_group_id
  into
    v_summary_group_id
  from public.settlement_line_group_config
  where
    settlement_session_id =
      v_session_id
    and line_group_id =
      new.line_group_id;


  new.summary_group_id :=
    v_summary_group_id;


  if v_summary_group_id is null then
    new.summary_group_round_id := null;
    return new;
  end if;


  select r.id
    into v_round_id
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


  -- Foundation is deliberately backward-compatible:
  -- missing round ownership must not alter webhook acceptance
  -- before the lifecycle cutover phase.
  new.summary_group_round_id :=
    v_round_id;


  return new;
end;
$$;


-- Existing trigger already targets this function.
-- Recreate explicitly so the deployed contract is deterministic.

drop trigger if exists
  messages_open_settlement_assignment_trg
on public.messages;


create trigger
  messages_open_settlement_assignment_trg
before insert
on public.messages
for each row
execute function
  public.assign_message_to_open_settlement();


-- ============================================================
-- 7. order_items inherit immutable ownership from message
--
-- This covers:
-- - persist_parsed_message_atomic()
-- - resolve_review_with_items()
-- - any other canonical insert path
--
-- No RPC signature changes are required.
-- ============================================================

create or replace function
  public.enforce_order_item_round_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_round_id uuid;
  v_round
    public.settlement_summary_group_rounds%rowtype;
begin
  select
    m.summary_group_round_id
  into
    v_message_round_id
  from public.messages m
  where m.id =
    new.message_record_id;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if v_message_round_id is null then
    if new.summary_group_round_id
       is not null then
      raise exception
        'MESSAGE_ROUND_NOT_ASSIGNED';
    end if;

    return new;
  end if;


  if new.summary_group_round_id
     is null then
    new.summary_group_round_id :=
      v_message_round_id;

  elsif new.summary_group_round_id
        <> v_message_round_id then
    raise exception
      'SUMMARY_GROUP_ROUND_MISMATCH';
  end if;


  select *
    into v_round
  from
    public.settlement_summary_group_rounds
  where id =
    new.summary_group_round_id;


  if not found then
    raise exception
      'SUMMARY_GROUP_ROUND_NOT_FOUND';
  end if;


  if
    new.settlement_session_id
      is not null

    and v_round.settlement_session_id
        <> new.settlement_session_id
  then
    raise exception
      'ROUND_SETTLEMENT_MISMATCH';
  end if;


  if
    coalesce(
      new.summary_group_id,
      ''
    )
    <> v_round.summary_group_id
  then
    raise exception
      'ROUND_SUMMARY_GROUP_MISMATCH';
  end if;


  return new;
end;
$$;


drop trigger if exists
  order_items_round_ownership_trg
on public.order_items;


create trigger
  order_items_round_ownership_trg
before insert
or update of
  message_record_id,
  summary_group_round_id,
  settlement_session_id,
  summary_group_id
on public.order_items
for each row
execute function
  public.enforce_order_item_round_ownership();


-- ============================================================
-- 8. Function security
-- ============================================================

revoke all
on function
  public.ensure_summary_group_round_for_config()
from public, anon, authenticated;

grant execute
on function
  public.ensure_summary_group_round_for_config()
to service_role;


revoke all
on function
  public.sync_legacy_summary_group_control_to_round()
from public, anon, authenticated;

grant execute
on function
  public.sync_legacy_summary_group_control_to_round()
to service_role;


revoke all
on function
  public.sync_closed_settlement_to_summary_group_rounds()
from public, anon, authenticated;

grant execute
on function
  public.sync_closed_settlement_to_summary_group_rounds()
to service_role;


revoke all
on function
  public.enforce_order_item_round_ownership()
from public, anon, authenticated;

grant execute
on function
  public.enforce_order_item_round_ownership()
to service_role;
