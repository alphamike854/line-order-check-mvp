-- Harden Summary Group Point Promotion mutation
-- against concurrent settlement lifecycle and
-- atomic distribution confirmation.
--
-- Production already has the Summary Group Promotion schema.
-- This migration replaces only the existing SET/DELETE RPCs.

begin;

create or replace function
  public.set_settlement_summary_group_point_promotion(
    p_settlement_session_id uuid,
    p_summary_group_id text,
    p_category text,
    p_code text,
    p_point_factor_pct numeric,
    p_changed_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_summary text;
  v_category text;
  v_code text;
  v_previous numeric(7,3);
  v_exists boolean := false;
  v_action text;
  v_changed_at timestamptz := now();
begin
  v_summary :=
    nullif(trim(p_summary_group_id), '');

  v_category :=
    upper(trim(p_category));

  v_code :=
    trim(p_code);

  if p_settlement_session_id is null then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_summary is null then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;

  if
    v_category not in (
      'A','B','E','F','G','H','L'
    )
    or coalesce(v_code, '') = ''
    or p_point_factor_pct is null
    or p_point_factor_pct < 0
    or p_point_factor_pct > 100
  then
    raise exception 'INVALID_PROMOTION_RULE';
  end if;

  if
    (
      v_category in ('H','L')
      and v_code !~ '^\d$'
    )
    or (
      v_category in ('A','B')
      and v_code !~ '^\d{2}$'
    )
    or (
      v_category in ('E','F','G')
      and v_code !~ '^\d{3}$'
    )
  then
    raise exception 'INVALID_PROMOTION_CODE';
  end if;

  -- Serialize Promotion changes with settlement lifecycle,
  -- LINE Group remap and atomic distribution confirmation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_session
  from public.settlement_sessions
  where id = p_settlement_session_id
  for share;

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
        v_summary
      and cfg.enabled = true
  ) then
    raise exception
      'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;

  -- Preserve the same Summary Group serialization boundary
  -- used by distribution confirmation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_settlement_session_id::text,
        v_summary
      ),
      0
    )
  );

  -- Then serialize this exact Promotion code.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_POINT_PROMOTION',
        p_settlement_session_id::text,
        v_summary,
        v_category,
        v_code
      ),
      0
    )
  );

  select point_factor_pct
  into v_previous
  from public.settlement_point_promotions
  where
    settlement_session_id =
      p_settlement_session_id
    and summary_group_id =
      v_summary
    and category =
      v_category
    and code =
      v_code;

  v_exists := found;

  if
    v_exists
    and v_previous =
      p_point_factor_pct
  then
    return jsonb_build_object(
      'changed', false,
      'action', 'NO_CHANGE',
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id', v_summary,
      'category', v_category,
      'code', v_code,
      'point_factor_pct',
        p_point_factor_pct
    );
  end if;

  v_action :=
    case
      when v_exists then 'UPDATE'
      else 'ADD'
    end;

  insert into
    public.settlement_point_promotions (
      settlement_session_id,
      summary_group_id,
      category,
      code,
      point_factor_pct,
      updated_at,
      updated_by
    )
  values (
    p_settlement_session_id,
    v_summary,
    v_category,
    v_code,
    p_point_factor_pct,
    v_changed_at,
    p_changed_by
  )
  on conflict (
    settlement_session_id,
    summary_group_id,
    category,
    code
  )
  do update set
    point_factor_pct =
      excluded.point_factor_pct,
    updated_at =
      excluded.updated_at,
    updated_by =
      excluded.updated_by;

  insert into
    public.settlement_point_promotion_events (
      settlement_session_id,
      summary_group_id,
      category,
      code,
      action,
      previous_point_factor_pct,
      new_point_factor_pct,
      changed_at,
      changed_by
    )
  values (
    p_settlement_session_id,
    v_summary,
    v_category,
    v_code,
    v_action,
    v_previous,
    p_point_factor_pct,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'changed', true,
    'action', v_action,
    'settlement_session_id',
      p_settlement_session_id,
    'summary_group_id', v_summary,
    'category', v_category,
    'code', v_code,
    'point_factor_pct',
      p_point_factor_pct,
    'changed_at', v_changed_at
  );
end;
$$;

create or replace function
  public.delete_settlement_summary_group_point_promotion(
    p_settlement_session_id uuid,
    p_summary_group_id text,
    p_category text,
    p_code text,
    p_changed_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_summary text;
  v_category text;
  v_code text;
  v_previous numeric(7,3);
  v_changed_at timestamptz := now();
begin
  v_summary :=
    nullif(trim(p_summary_group_id), '');

  v_category :=
    upper(trim(p_category));

  v_code :=
    trim(p_code);

  if p_settlement_session_id is null then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_summary is null then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;

  -- Serialize Promotion changes with settlement lifecycle,
  -- LINE Group remap and atomic distribution confirmation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_session
  from public.settlement_sessions
  where id = p_settlement_session_id
  for share;

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
        v_summary
      and cfg.enabled = true
  ) then
    raise exception
      'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;

  -- Preserve the same Summary Group serialization boundary
  -- used by distribution confirmation.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_settlement_session_id::text,
        v_summary
      ),
      0
    )
  );

  -- Then serialize this exact Promotion code.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_POINT_PROMOTION',
        p_settlement_session_id::text,
        v_summary,
        v_category,
        v_code
      ),
      0
    )
  );

  select point_factor_pct
  into v_previous
  from public.settlement_point_promotions
  where
    settlement_session_id =
      p_settlement_session_id
    and summary_group_id =
      v_summary
    and category =
      v_category
    and code =
      v_code;

  if not found then
    return jsonb_build_object(
      'changed', false,
      'action', 'NO_CHANGE',
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id', v_summary,
      'category', v_category,
      'code', v_code
    );
  end if;

  delete from
    public.settlement_point_promotions
  where
    settlement_session_id =
      p_settlement_session_id
    and summary_group_id =
      v_summary
    and category =
      v_category
    and code =
      v_code;

  insert into
    public.settlement_point_promotion_events (
      settlement_session_id,
      summary_group_id,
      category,
      code,
      action,
      previous_point_factor_pct,
      new_point_factor_pct,
      changed_at,
      changed_by
    )
  values (
    p_settlement_session_id,
    v_summary,
    v_category,
    v_code,
    'DELETE',
    v_previous,
    null,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'changed', true,
    'action', 'DELETE',
    'settlement_session_id',
      p_settlement_session_id,
    'summary_group_id', v_summary,
    'category', v_category,
    'code', v_code,
    'previous_point_factor_pct',
      v_previous,
    'changed_at', v_changed_at
  );
end;
$$;

commit;
