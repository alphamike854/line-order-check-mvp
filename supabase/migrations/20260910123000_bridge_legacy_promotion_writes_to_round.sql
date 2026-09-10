begin;

do $guard$
begin
  if
    exists (
      select 1
      from public.settlement_point_promotions
    )
    or exists (
      select 1
      from public.settlement_round_point_promotions
    )
    or exists (
      select 1
      from public.settlement_round_point_promotion_line_groups
    )
  then
    raise exception
      'PROMOTION_COMPAT_BRIDGE_REQUIRES_ZERO_CURRENT_CONFIG';
  end if;
end
$guard$;

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
set search_path = 'public'
as $function$
declare
  v_session
    public.settlement_sessions%rowtype;

  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_rule
    public.settlement_round_point_promotions%rowtype;

  v_summary text;
  v_category text;
  v_code text;

  v_round_result jsonb;

  v_changed boolean;
  v_action text;
begin
  v_summary :=
    nullif(
      trim(p_summary_group_id),
      ''
    );

  v_category :=
    upper(
      trim(p_category)
    );

  v_code :=
    trim(p_code);

  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_NOT_FOUND';
  end if;

  if v_summary is null then
    raise exception
      'SUMMARY_GROUP_REQUIRED';
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
    raise exception
      'INVALID_PROMOTION_RULE';
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
    raise exception
      'INVALID_PROMOTION_CODE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_session
  from public.settlement_sessions
  where id =
    p_settlement_session_id
  for share;

  if not found then
    raise exception
      'SETTLEMENT_NOT_FOUND';
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

  select r.*
  into v_round
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_summary
    and r.status in (
      'OPEN',
      'CLOSED'
    )
  order by
    r.round_no desc
  limit 1;

  if not found then
    raise exception
      'ROUND_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.settlement_summary_group_round_snapshots s
    where s.round_id =
      v_round.id
  ) then
    raise exception
      'ROUND_CONFIG_ARCHIVED';
  end if;

  v_round_result :=
    public.set_settlement_round_point_promotion(
      p_round_id =>
        v_round.id,
      p_category =>
        v_category,
      p_code =>
        v_code,
      p_point_factor_pct =>
        p_point_factor_pct,
      p_target_scope =>
        'ALL',
      p_line_group_ids =>
        '[]'::jsonb,
      p_changed_by =>
        p_changed_by
    );

  v_changed :=
    coalesce(
      (
        v_round_result
        ->> 'changed'
      )::boolean,
      false
    );

  v_action :=
    coalesce(
      v_round_result
        ->> 'action',
      'NO_CHANGE'
    );

  if
    (
      v_changed
      and v_action not in (
        'ADD',
        'UPDATE'
      )
    )
    or (
      not v_changed
      and v_action <>
        'NO_CHANGE'
    )
  then
    raise exception
      'PROMOTION_COMPAT_UNEXPECTED_ROUND_RESULT';
  end if;

  select *
  into v_rule
  from public.settlement_round_point_promotions
  where
    round_id =
      v_round.id
    and category =
      v_category
    and code =
      v_code;

  if not found then
    raise exception
      'PROMOTION_COMPAT_ROUND_RESULT_MISSING';
  end if;

  if
    v_rule.target_scope <>
      'ALL'
    or v_rule.point_factor_pct <>
      p_point_factor_pct
    or exists (
      select 1
      from public.settlement_round_point_promotion_line_groups t
      where t.promotion_id =
        v_rule.id
    )
  then
    raise exception
      'PROMOTION_COMPAT_ROUND_RESULT_MISMATCH';
  end if;

  insert into
    public.settlement_point_promotions (
      settlement_session_id,
      summary_group_id,
      category,
      code,
      point_factor_pct,
      created_at,
      updated_at,
      updated_by
    )
  values (
    p_settlement_session_id,
    v_summary,
    v_category,
    v_code,
    v_rule.point_factor_pct,
    v_rule.updated_at,
    v_rule.updated_at,
    v_rule.updated_by
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

  if v_changed then
    return jsonb_build_object(
      'changed',
        true,
      'action',
        v_action,
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id',
        v_summary,
      'category',
        v_category,
      'code',
        v_code,
      'point_factor_pct',
        v_rule.point_factor_pct,
      'changed_at',
        v_rule.updated_at
    );
  end if;

  return jsonb_build_object(
    'changed',
      false,
    'action',
      'NO_CHANGE',
    'settlement_session_id',
      p_settlement_session_id,
    'summary_group_id',
      v_summary,
    'category',
      v_category,
    'code',
      v_code,
    'point_factor_pct',
      v_rule.point_factor_pct
  );
end;
$function$;

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
set search_path = 'public'
as $function$
declare
  v_session
    public.settlement_sessions%rowtype;

  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_summary text;
  v_category text;
  v_code text;

  v_previous numeric(7,3);
  v_exists boolean := false;

  v_round_result jsonb;
  v_changed boolean;
  v_action text;

  v_changed_at timestamptz :=
    now();
begin
  v_summary :=
    nullif(
      trim(p_summary_group_id),
      ''
    );

  v_category :=
    upper(
      trim(p_category)
    );

  v_code :=
    trim(p_code);

  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_NOT_FOUND';
  end if;

  if v_summary is null then
    raise exception
      'SUMMARY_GROUP_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_session
  from public.settlement_sessions
  where id =
    p_settlement_session_id
  for share;

  if not found then
    raise exception
      'SETTLEMENT_NOT_FOUND';
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

  select r.*
  into v_round
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_summary
    and r.status in (
      'OPEN',
      'CLOSED'
    )
  order by
    r.round_no desc
  limit 1;

  if not found then
    raise exception
      'ROUND_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.settlement_summary_group_round_snapshots s
    where s.round_id =
      v_round.id
  ) then
    raise exception
      'ROUND_CONFIG_ARCHIVED';
  end if;

  select
    point_factor_pct
  into
    v_previous
  from public.settlement_round_point_promotions
  where
    round_id =
      v_round.id
    and category =
      v_category
    and code =
      v_code;

  v_exists :=
    found;

  v_round_result :=
    public.delete_settlement_round_point_promotion(
      p_round_id =>
        v_round.id,
      p_category =>
        v_category,
      p_code =>
        v_code,
      p_changed_by =>
        p_changed_by
    );

  v_changed :=
    coalesce(
      (
        v_round_result
        ->> 'changed'
      )::boolean,
      false
    );

  v_action :=
    coalesce(
      v_round_result
        ->> 'action',
      'NO_CHANGE'
    );

  if
    (
      v_exists
      and (
        not v_changed
        or v_action <>
          'DELETE'
      )
    )
    or (
      not v_exists
      and (
        v_changed
        or v_action <>
          'NO_CHANGE'
      )
    )
  then
    raise exception
      'PROMOTION_COMPAT_UNEXPECTED_ROUND_RESULT';
  end if;

  if exists (
    select 1
    from public.settlement_round_point_promotions p
    where
      p.round_id =
        v_round.id
      and p.category =
        v_category
      and p.code =
        v_code
  ) then
    raise exception
      'PROMOTION_COMPAT_ROUND_DELETE_MISMATCH';
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

  if not v_exists then
    return jsonb_build_object(
      'changed',
        false,
      'action',
        'NO_CHANGE',
      'settlement_session_id',
        p_settlement_session_id,
      'summary_group_id',
        v_summary,
      'category',
        v_category,
      'code',
        v_code
    );
  end if;

  return jsonb_build_object(
    'changed',
      true,
    'action',
      'DELETE',
    'settlement_session_id',
      p_settlement_session_id,
    'summary_group_id',
      v_summary,
    'category',
      v_category,
    'code',
      v_code,
    'previous_point_factor_pct',
      v_previous,
    'changed_at',
      v_changed_at
  );
end;
$function$;

revoke all on function
  public.set_settlement_summary_group_point_promotion(
    uuid,
    text,
    text,
    text,
    numeric,
    text
  )
from
  public,
  anon,
  authenticated,
  service_role;

grant execute on function
  public.set_settlement_summary_group_point_promotion(
    uuid,
    text,
    text,
    text,
    numeric,
    text
  )
to service_role;

revoke all on function
  public.delete_settlement_summary_group_point_promotion(
    uuid,
    text,
    text,
    text,
    text
  )
from
  public,
  anon,
  authenticated,
  service_role;

grant execute on function
  public.delete_settlement_summary_group_point_promotion(
    uuid,
    text,
    text,
    text,
    text
  )
to service_role;

commit;
