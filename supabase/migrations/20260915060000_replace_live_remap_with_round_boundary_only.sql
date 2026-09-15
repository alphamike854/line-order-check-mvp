-- V14B2D
-- Replace legacy live Summary Group remap with ROUND_BOUNDARY_ONLY routing.
--
-- Operational contract:
-- - Summary Group Round lifecycle is the remap/admission boundary authority.
-- - Parent settlement session remains only the current/future route container.
-- - Accepted messages/order_items and captured Round lineage are immutable.
-- - Identity remap requires source and destination to have no OPEN Round.
-- - New identity assignment / admission expansion requires destination
--   to have no OPEN Round.
-- - No Round is automatically opened or closed.

create or replace function public.save_line_group_live(
  p_line_group_id text,
  p_line_group_name text,
  p_summary_group_id text,
  p_reduction_pct numeric,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session_id uuid;

  -- Existing master identity before mutation.
  v_master_old_summary_group_id text;
  v_master_old_enabled boolean;
  v_has_master boolean := false;

  -- Existing current-route identity.
  --
  -- Keep legacy naming/return semantics:
  -- old_summary_group_id is the pre-change current-route identity.
  v_old_summary_group_id text;
  v_route_old_enabled boolean;
  v_has_snapshot boolean := false;

  v_identity_remap boolean := false;
  v_new_identity_assignment boolean := false;
  v_admission_expansion boolean := false;

  -- Legacy API compatibility.
  -- ROUND_BOUNDARY_ONLY never moves accepted records.
  v_messages_moved integer := 0;
  v_items_moved integer := 0;
  v_remapped boolean := false;

  v_saved public.line_groups%rowtype;
begin
  if coalesce(trim(p_line_group_id), '') = '' then
    raise exception 'INVALID_LINE_GROUP_ID';
  end if;

  if coalesce(trim(p_line_group_name), '') = '' then
    raise exception 'INVALID_LINE_GROUP_NAME';
  end if;

  if coalesce(trim(p_summary_group_id), '') = '' then
    raise exception 'INVALID_SUMMARY_GROUP_ID';
  end if;

  if p_reduction_pct is null
     or p_reduction_pct < 0
     or p_reduction_pct > 100 then
    raise exception 'INVALID_REDUCTION_PCT';
  end if;

  if not exists (
    select 1
    from public.summary_groups
    where id = p_summary_group_id
  ) then
    raise exception 'SUMMARY_GROUP_NOT_FOUND';
  end if;

  -- Serialize with OPEN_GROUP / CLOSE_GROUP and message admission.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  -- Lock/capture existing master identity before any mutation.
  select
    summary_group_id,
    enabled
  into
    v_master_old_summary_group_id,
    v_master_old_enabled
  from public.line_groups
  where line_group_id = p_line_group_id
  for update;

  v_has_master := found;

  -- Compatibility/current-route container only.
  --
  -- Parent settlement OPEN is deliberately NOT the Round-boundary authority.
  select id
  into v_session_id
  from public.settlement_sessions
  where status = 'OPEN'
  limit 1
  for update;

  if v_session_id is not null then
    select
      summary_group_id,
      enabled
    into
      v_old_summary_group_id,
      v_route_old_enabled
    from public.settlement_line_group_config
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id
    for update;

    v_has_snapshot := found;
  end if;

  -- Identity may be represented by master and/or current route.
  -- Any existing identity that changes is a boundary-only remap.
  v_identity_remap :=
    (
      v_has_master
      and v_master_old_summary_group_id
          is distinct from p_summary_group_id
    )
    or
    (
      v_has_snapshot
      and v_old_summary_group_id
          is distinct from p_summary_group_id
    );

  -- Truly new only when neither master nor current route already owns identity.
  v_new_identity_assignment :=
    not v_has_master
    and not v_has_snapshot;

  -- Admission expansion includes:
  -- - disabled master -> enabled
  -- - disabled route -> enabled
  -- - enabled request with no current route row
  v_admission_expansion :=
    coalesce(p_enabled, false)
    and (
      (
        v_has_master
        and not coalesce(
          v_master_old_enabled,
          false
        )
      )
      or
      (
        v_has_snapshot
        and not coalesce(
          v_route_old_enabled,
          false
        )
      )
      or
      (
        v_session_id is not null
        and not v_has_snapshot
      )
    );

  if v_identity_remap then
    -- Every pre-change identity that differs from the requested destination
    -- must be between Rounds.
    if exists (
      select 1
      from public.settlement_summary_group_rounds r
      where r.status = 'OPEN'
        and r.summary_group_id
            is distinct from p_summary_group_id
        and r.summary_group_id in (
          v_master_old_summary_group_id,
          v_old_summary_group_id
        )
    ) then
      raise exception
        'SUMMARY_GROUP_REMAP_BLOCKED_SOURCE_OPEN_ROUND';
    end if;

    if exists (
      select 1
      from public.settlement_summary_group_rounds r
      where r.status = 'OPEN'
        and r.summary_group_id = p_summary_group_id
    ) then
      raise exception
        'SUMMARY_GROUP_REMAP_BLOCKED_DESTINATION_OPEN_ROUND';
    end if;

  elsif
    v_new_identity_assignment
    or v_admission_expansion
  then
    if exists (
      select 1
      from public.settlement_summary_group_rounds r
      where r.status = 'OPEN'
        and r.summary_group_id = p_summary_group_id
    ) then
      raise exception
        'SUMMARY_GROUP_REMAP_BLOCKED_DESTINATION_OPEN_ROUND';
    end if;
  end if;

  -- All Round-boundary checks passed.
  insert into public.line_groups (
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct,
    enabled,
    created_at,
    updated_at
  )
  values (
    p_line_group_id,
    p_line_group_name,
    p_summary_group_id,
    p_reduction_pct,
    p_enabled,
    now(),
    now()
  )
  on conflict (line_group_id)
  do update set
    line_group_name = excluded.line_group_name,
    summary_group_id = excluded.summary_group_id,
    reduction_pct = excluded.reduction_pct,
    enabled = excluded.enabled,
    updated_at = now()
  returning *
  into v_saved;

  -- Preserve the existing no-parent return shape exactly.
  if v_session_id is null then
    return jsonb_build_object(
      'line_group', to_jsonb(v_saved),
      'open_settlement_id', null,
      'remapped', false,
      'messages_moved', 0,
      'items_moved', 0
    );
  end if;

  -- Current parent configuration is now a FUTURE ADMISSION ROUTE only.
  --
  -- Never rewrite accepted messages/order_items or captured Round lineage.
  if v_has_snapshot then
    update public.settlement_line_group_config
    set
      line_group_name = p_line_group_name,
      summary_group_id = p_summary_group_id,
      reduction_pct = p_reduction_pct,
      enabled = p_enabled
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id;

    -- Preserve legacy external meaning:
    -- "remapped" means the existing current route identity changed.
    v_remapped :=
      v_old_summary_group_id
      is distinct from p_summary_group_id;

  elsif p_enabled then
    insert into public.settlement_line_group_config (
      settlement_session_id,
      line_group_id,
      line_group_name,
      summary_group_id,
      reduction_pct,
      enabled
    )
    values (
      v_session_id,
      p_line_group_id,
      p_line_group_name,
      p_summary_group_id,
      p_reduction_pct,
      true
    );
  end if;

  -- Preserve the existing seven-key parent-session payload.
  --
  -- messages_moved/items_moved remain zero because accepted ownership
  -- is immutable under ROUND_BOUNDARY_ONLY.
  return jsonb_build_object(
    'line_group', to_jsonb(v_saved),
    'open_settlement_id', v_session_id,
    'old_summary_group_id', v_old_summary_group_id,
    'new_summary_group_id', p_summary_group_id,
    'remapped', v_remapped,
    'messages_moved', v_messages_moved,
    'items_moved', v_items_moved
  );
end;
$function$;

revoke all on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) from public;

revoke all on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) from anon;

revoke all on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) from authenticated;

grant execute on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) to service_role;
