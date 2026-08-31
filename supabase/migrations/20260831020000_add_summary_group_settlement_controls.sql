-- S1 Fast-Safe
-- Keep one OPEN settlement session, but allow each Summary Group
-- to independently accept or stop accepting new orders.
--
-- Absence of a control row means OPEN/accepting for backward compatibility.

create table if not exists public.settlement_summary_group_controls (
  settlement_session_id uuid not null
    references public.settlement_sessions(id)
    on delete cascade,

  summary_group_id text not null
    references public.summary_groups(id),

  accepting_orders boolean not null default true,

  changed_at timestamptz not null default now(),
  changed_by text,

  closed_at timestamptz,

  primary key (
    settlement_session_id,
    summary_group_id
  )
);

create table if not exists public.settlement_summary_group_control_events (
  id bigint generated always as identity primary key,

  settlement_session_id uuid not null
    references public.settlement_sessions(id)
    on delete cascade,

  summary_group_id text not null
    references public.summary_groups(id),

  previous_accepting_orders boolean not null,
  new_accepting_orders boolean not null,

  changed_at timestamptz not null default now(),
  changed_by text
);

create index if not exists
  settlement_summary_group_control_events_session_idx
on public.settlement_summary_group_control_events (
  settlement_session_id,
  changed_at desc
);

alter table
  public.settlement_summary_group_controls
enable row level security;

alter table
  public.settlement_summary_group_control_events
enable row level security;

revoke all
on public.settlement_summary_group_controls
from public, anon, authenticated;

revoke all
on public.settlement_summary_group_control_events
from public, anon, authenticated;

grant select, insert, update, delete
on public.settlement_summary_group_controls
to service_role;

grant select, insert
on public.settlement_summary_group_control_events
to service_role;

grant usage, select
on sequence public.settlement_summary_group_control_events_id_seq
to service_role;


create or replace function public.is_settlement_summary_group_accepting(
  p_settlement_session_id uuid,
  p_summary_group_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.accepting_orders
      from public.settlement_summary_group_controls c
      where
        c.settlement_session_id =
          p_settlement_session_id
        and c.summary_group_id =
          p_summary_group_id
    ),
    true
  );
$$;


create or replace function public.set_settlement_summary_group_accepting(
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
  v_session public.settlement_sessions%rowtype;
  v_previous boolean;
  v_changed_at timestamptz := now();
begin
  if p_settlement_session_id is null then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if coalesce(trim(p_summary_group_id), '') = '' then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;

  if p_accepting_orders is null then
    raise exception 'SUMMARY_GROUP_STATE_REQUIRED';
  end if;

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
  where id = p_settlement_session_id
  for update;

  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_session.status <> 'OPEN' then
    raise exception 'SETTLEMENT_NOT_OPEN';
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
    raise exception 'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;

  select coalesce(
    (
      select c.accepting_orders
      from public.settlement_summary_group_controls c
      where
        c.settlement_session_id =
          p_settlement_session_id
        and c.summary_group_id =
          p_summary_group_id
    ),
    true
  )
  into v_previous;

  if v_previous = p_accepting_orders then
    return jsonb_build_object(
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id',
        p_summary_group_id,
      'accepting_orders',
        p_accepting_orders,
      'changed',
        false
    );
  end if;

  if p_accepting_orders then
    -- OPEN is the default state. Delete the override.
    delete from public.settlement_summary_group_controls
    where
      settlement_session_id =
        p_settlement_session_id
      and summary_group_id =
        p_summary_group_id;
  else
    insert into public.settlement_summary_group_controls (
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
      accepting_orders = false,
      changed_at = excluded.changed_at,
      changed_by = excluded.changed_by,
      closed_at = excluded.closed_at;
  end if;

  insert into public.settlement_summary_group_control_events (
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
    v_previous,
    p_accepting_orders,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'settlement_session_id',
      p_settlement_session_id,
    'summary_group_id',
      p_summary_group_id,
    'accepting_orders',
      p_accepting_orders,
    'changed',
      true,
    'changed_at',
      v_changed_at
  );
end;
$$;


-- Defensive database boundary.
-- If a group is closed between webhook pre-check and canonical persistence,
-- canonical order_items must still not be created.
create or replace function
  public.enforce_order_item_summary_group_accepting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    new.settlement_session_id is not null
    and coalesce(new.summary_group_id, '') <> ''
    and not public.is_settlement_summary_group_accepting(
      new.settlement_session_id,
      new.summary_group_id
    )
  then
    raise exception 'SUMMARY_GROUP_CLOSED';
  end if;

  return new;
end;
$$;

drop trigger if exists
  order_items_summary_group_accepting_trg
on public.order_items;

create trigger
  order_items_summary_group_accepting_trg
before insert
or update of settlement_session_id, summary_group_id
on public.order_items
for each row
execute function
  public.enforce_order_item_summary_group_accepting();


revoke all
on function public.is_settlement_summary_group_accepting(uuid,text)
from public, anon, authenticated;

grant execute
on function public.is_settlement_summary_group_accepting(uuid,text)
to service_role;

revoke all
on function public.set_settlement_summary_group_accepting(uuid,text,boolean,text)
from public, anon, authenticated;

grant execute
on function public.set_settlement_summary_group_accepting(uuid,text,boolean,text)
to service_role;
