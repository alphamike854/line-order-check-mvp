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
set search_path = public
as $$
declare
  v_session_id uuid;
  v_old_summary_group_id text;
  v_has_snapshot boolean := false;
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

  -- Serialize against settlement open/close and message assignment.
  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE', 0)
  );

  select id
    into v_session_id
  from public.settlement_sessions
  where status = 'OPEN'
  limit 1
  for update;

  insert into public.line_groups (
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct,
    enabled,
    updated_at
  )
  values (
    p_line_group_id,
    p_line_group_name,
    p_summary_group_id,
    p_reduction_pct,
    p_enabled,
    now()
  )
  on conflict (line_group_id)
  do update set
    line_group_name = excluded.line_group_name,
    summary_group_id = excluded.summary_group_id,
    reduction_pct = excluded.reduction_pct,
    enabled = excluded.enabled,
    updated_at = now()
  returning * into v_saved;

  if v_session_id is null then
    return jsonb_build_object(
      'line_group', to_jsonb(v_saved),
      'open_settlement_id', null,
      'remapped', false,
      'messages_moved', 0,
      'items_moved', 0
    );
  end if;

  select summary_group_id
    into v_old_summary_group_id
  from public.settlement_line_group_config
  where settlement_session_id = v_session_id
    and line_group_id = p_line_group_id
  for update;

  v_has_snapshot := found;

  if v_has_snapshot
     and v_old_summary_group_id is distinct from p_summary_group_id then

    -- Lock both risk states. Distribution/transfer operations also acquire
    -- the summary-group advisory lock, so they serialize with this remap.
    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws('|', v_session_id::text, v_old_summary_group_id),
        0
      )
    );

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws('|', v_session_id::text, p_summary_group_id),
        0
      )
    );

    -- Moving a LINE group changes totals for BOTH source and destination.
    -- Once a cut/transfer has been confirmed, automatic remap is unsafe.
    if exists (
      select 1
      from public.settlement_allocation_confirmations
      where settlement_session_id = v_session_id
        and summary_group_id in (
          v_old_summary_group_id,
          p_summary_group_id
        )
        and coalesce(confirmed_transfer, 0) > 0
    ) then
      raise exception 'SUMMARY_GROUP_REMAP_BLOCKED_CONFIRMED_ALLOCATION';
    end if;

    if exists (
      select 1
      from public.settlement_transfer_batches
      where settlement_session_id = v_session_id
        and summary_group_id in (
          v_old_summary_group_id,
          p_summary_group_id
        )
    ) then
      raise exception 'SUMMARY_GROUP_REMAP_BLOCKED_TRANSFER_BATCH';
    end if;

    if exists (
      select 1
      from public.settlement_distribution_runs
      where settlement_session_id = v_session_id
        and summary_group_id in (
          v_old_summary_group_id,
          p_summary_group_id
        )
    ) then
      raise exception 'SUMMARY_GROUP_REMAP_BLOCKED_DISTRIBUTION';
    end if;

    update public.messages
    set summary_group_id = p_summary_group_id
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id
      and summary_group_id is distinct from p_summary_group_id;

    get diagnostics v_messages_moved = row_count;

    update public.order_items
    set summary_group_id = p_summary_group_id
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id
      and summary_group_id is distinct from p_summary_group_id;

    get diagnostics v_items_moved = row_count;

    update public.settlement_line_group_config
    set
      line_group_name = p_line_group_name,
      summary_group_id = p_summary_group_id,
      reduction_pct = p_reduction_pct,
      enabled = p_enabled
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id;

    v_remapped := true;

  elsif v_has_snapshot then

    -- Same summary group: operational edits apply immediately.
    update public.settlement_line_group_config
    set
      line_group_name = p_line_group_name,
      reduction_pct = p_reduction_pct,
      enabled = p_enabled
    where settlement_session_id = v_session_id
      and line_group_id = p_line_group_id;

  elsif p_enabled then

    -- Newly registered LINE group joins the current OPEN settlement.
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
$$;

revoke all on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) from public, anon, authenticated;

grant execute on function public.save_line_group_live(
  text,
  text,
  text,
  numeric,
  boolean
) to service_role;
