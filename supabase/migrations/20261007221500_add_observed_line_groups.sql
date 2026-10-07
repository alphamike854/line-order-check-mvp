-- LINE Group discovery bootstrap registry
--
-- Purpose:
--   Remember a valid LINE group as soon as a signed webhook reaches
--   public ingress, even when temporal / Round admission rejects it.
--
-- This registry is discovery metadata only.
-- It contains no LINE message payload and creates no order/business data.

begin;

create table if not exists
  public.observed_line_groups (
    line_group_id text primary key,

    first_seen_at timestamptz not null,
    last_seen_at timestamptz not null,

    last_event_type text,
    last_webhook_event_id text,

    created_at timestamptz not null
      default clock_timestamp(),

    updated_at timestamptz not null
      default clock_timestamp(),

    constraint
      observed_line_groups_id_nonempty
      check (
        btrim(line_group_id) <> ''
      )
  );


create index if not exists
  observed_line_groups_last_seen_idx
on public.observed_line_groups (
  last_seen_at desc,
  line_group_id
);


alter table
  public.observed_line_groups
enable row level security;


revoke all
on table public.observed_line_groups
from public, anon, authenticated;


grant
  select,
  insert,
  update
on table public.observed_line_groups
to service_role;


-- Backfill rooms that were historically admitted far enough
-- to create webhook_events.
insert into public.observed_line_groups (
  line_group_id,
  first_seen_at,
  last_seen_at,
  last_event_type,
  last_webhook_event_id
)
select
  e.line_group_id,

  min(e.received_at)
    as first_seen_at,

  max(e.received_at)
    as last_seen_at,

  (
    array_agg(
      e.event_type
      order by
        e.received_at desc,
        e.webhook_event_id desc
    )
  )[1]
    as last_event_type,

  (
    array_agg(
      e.webhook_event_id
      order by
        e.received_at desc,
        e.webhook_event_id desc
    )
  )[1]
    as last_webhook_event_id

from public.webhook_events e

where
  e.line_group_id is not null
  and btrim(e.line_group_id) <> ''

group by
  e.line_group_id

on conflict (line_group_id)
do update set
  first_seen_at =
    least(
      public.observed_line_groups.first_seen_at,
      excluded.first_seen_at
    ),

  last_seen_at =
    greatest(
      public.observed_line_groups.last_seen_at,
      excluded.last_seen_at
    ),

  last_event_type =
    case
      when
        excluded.last_seen_at
          >= public.observed_line_groups.last_seen_at
      then excluded.last_event_type
      else public.observed_line_groups.last_event_type
    end,

  last_webhook_event_id =
    case
      when
        excluded.last_seen_at
          >= public.observed_line_groups.last_seen_at
      then excluded.last_webhook_event_id
      else public.observed_line_groups.last_webhook_event_id
    end,

  updated_at =
    clock_timestamp();


create or replace function
  public.observe_line_group_ingress(
    p_line_group_id text,
    p_seen_at timestamptz,
    p_event_type text,
    p_webhook_event_id text
  )
returns void

language plpgsql
security definer
set search_path = public, pg_temp

as $$
declare
  v_line_group_id text :=
    btrim(
      coalesce(
        p_line_group_id,
        ''
      )
    );

  v_seen_at timestamptz :=
    coalesce(
      p_seen_at,
      clock_timestamp()
    );

  v_event_type text :=
    nullif(
      btrim(
        coalesce(
          p_event_type,
          ''
        )
      ),
      ''
    );

  v_webhook_event_id text :=
    nullif(
      btrim(
        coalesce(
          p_webhook_event_id,
          ''
        )
      ),
      ''
    );

begin
  if v_line_group_id = '' then
    return;
  end if;

  insert into public.observed_line_groups (
    line_group_id,
    first_seen_at,
    last_seen_at,
    last_event_type,
    last_webhook_event_id
  )
  values (
    v_line_group_id,
    v_seen_at,
    v_seen_at,
    v_event_type,
    v_webhook_event_id
  )

  on conflict (line_group_id)
  do update set
    first_seen_at =
      least(
        public.observed_line_groups.first_seen_at,
        excluded.first_seen_at
      ),

    last_event_type =
      case
        when
          excluded.last_seen_at
            >= public.observed_line_groups.last_seen_at
        then excluded.last_event_type
        else public.observed_line_groups.last_event_type
      end,

    last_webhook_event_id =
      case
        when
          excluded.last_seen_at
            >= public.observed_line_groups.last_seen_at
        then excluded.last_webhook_event_id
        else public.observed_line_groups.last_webhook_event_id
      end,

    last_seen_at =
      greatest(
        public.observed_line_groups.last_seen_at,
        excluded.last_seen_at
      ),

    updated_at =
      clock_timestamp();

end;
$$;


revoke all
on function
  public.observe_line_group_ingress(
    text,
    timestamptz,
    text,
    text
  )
from public, anon, authenticated;


grant execute
on function
  public.observe_line_group_ingress(
    text,
    timestamptz,
    text,
    text
  )
to service_role;


comment on table
  public.observed_line_groups
is
  'Signed LINE group ingress discovery metadata. '
  'One row per LINE group; contains no raw LINE payload.';


comment on function
  public.observe_line_group_ingress(
    text,
    timestamptz,
    text,
    text
  )
is
  'Best-effort ingress discovery registry update. '
  'Called after LINE signature/JSON validation but before temporal Round admission.';


commit;
