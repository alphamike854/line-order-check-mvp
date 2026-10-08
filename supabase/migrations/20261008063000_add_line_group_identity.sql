-- LINE Group real identity + membership-aware discovery
--
-- Adds cached real LINE group name.
-- Membership status remains derived from last_event_type:
--   leave     -> LEFT
--   other     -> IN_GROUP
--   null      -> UNKNOWN
--
-- No raw LINE payload is stored.

begin;


alter table
  public.observed_line_groups
add column if not exists
  last_known_group_name text;


alter table
  public.observed_line_groups
add column if not exists
  group_name_synced_at timestamptz;


comment on column
  public.observed_line_groups.last_known_group_name
is
  'Last successfully fetched LINE groupName from Messaging API.';


comment on column
  public.observed_line_groups.group_name_synced_at
is
  'Timestamp of the last successful LINE group summary name sync.';


create or replace function
  public.observe_line_group_ingress_v2(
    p_line_group_id text,
    p_seen_at timestamptz,
    p_event_type text,
    p_webhook_event_id text
  )
returns jsonb

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

  v_last_event_type text;
  v_group_name text;
  v_group_name_synced_at timestamptz;

begin
  if v_line_group_id = '' then
    return jsonb_build_object(
      'membership_status',
      'UNKNOWN',
      'needs_name_sync',
      false
    );
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
      clock_timestamp()

  returning
    last_event_type,
    last_known_group_name,
    group_name_synced_at
  into
    v_last_event_type,
    v_group_name,
    v_group_name_synced_at;


  return jsonb_build_object(
    'membership_status',
    case
      when v_last_event_type = 'leave'
        then 'LEFT'
      when v_last_event_type is null
        then 'UNKNOWN'
      else 'IN_GROUP'
    end,

    'needs_name_sync',
    (
      v_last_event_type is not null
      and v_last_event_type <> 'leave'
      and (
        v_group_name is null
        or v_group_name_synced_at is null
        or v_group_name_synced_at
          < clock_timestamp()
            - interval '24 hours'
      )
    )
  );
end;
$$;


-- Preserve the original RPC contract so the currently deployed
-- source stays compatible if this migration is applied first.
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
begin
  perform
    public.observe_line_group_ingress_v2(
      p_line_group_id,
      p_seen_at,
      p_event_type,
      p_webhook_event_id
    );
end;
$$;


create or replace function
  public.set_observed_line_group_name(
    p_line_group_id text,
    p_group_name text,
    p_synced_at timestamptz
  )
returns boolean

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

  v_group_name text :=
    btrim(
      coalesce(
        p_group_name,
        ''
      )
    );

begin
  if
    v_line_group_id = ''
    or v_group_name = ''
    or char_length(v_group_name) > 120
  then
    return false;
  end if;

  update
    public.observed_line_groups
  set
    last_known_group_name =
      v_group_name,

    group_name_synced_at =
      coalesce(
        p_synced_at,
        clock_timestamp()
      ),

    updated_at =
      clock_timestamp()

  where
    line_group_id =
      v_line_group_id;

  return found;
end;
$$;


revoke all
on function
  public.observe_line_group_ingress_v2(
    text,
    timestamptz,
    text,
    text
  )
from public, anon, authenticated;


revoke all
on function
  public.set_observed_line_group_name(
    text,
    text,
    timestamptz
  )
from public, anon, authenticated;


grant execute
on function
  public.observe_line_group_ingress_v2(
    text,
    timestamptz,
    text,
    text
  )
to service_role;


grant execute
on function
  public.set_observed_line_group_name(
    text,
    text,
    timestamptz
  )
to service_role;


comment on function
  public.observe_line_group_ingress_v2(
    text,
    timestamptz,
    text,
    text
  )
is
  'Observe signed LINE group ingress and indicate whether cached groupName should be refreshed.';


comment on function
  public.set_observed_line_group_name(
    text,
    text,
    timestamptz
  )
is
  'Store the last successfully fetched LINE groupName without storing message payload.';


commit;
