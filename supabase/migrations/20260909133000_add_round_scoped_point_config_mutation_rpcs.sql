-- Round-scoped audited Point configuration mutation RPCs v1
--
-- Phase 2B:
-- - Round identity is authoritative for Promotion and Actual/Special Point.
-- - OPEN Round config is editable.
-- - CLOSED Round config remains editable until the Round has been archived
--   into settlement_summary_group_round_snapshots by the next OPEN/reset.
-- - Archived Round config fails closed because canonical message/order detail
--   has already been purged and cannot be safely recomputed.
-- - Promotion supports ALL or SELECTED LINE Groups.
-- - Actual/Special Point remains Summary Group only.
-- - Existing settlement-scoped API/read-model callers remain unchanged.

begin;

-- ============================================================
-- 1. Set / update Round-scoped Point Promotion
-- ============================================================

create or replace function
  public.set_settlement_round_point_promotion(
    p_round_id uuid,
    p_category text,
    p_code text,
    p_point_factor_pct numeric,
    p_target_scope text default 'ALL',
    p_line_group_ids jsonb default '[]'::jsonb,
    p_changed_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;
  v_previous
    public.settlement_round_point_promotions%rowtype;
  v_category text;
  v_code text;
  v_scope text;
  v_targets_input jsonb;
  v_previous_targets jsonb := '[]'::jsonb;
  v_new_targets jsonb := '[]'::jsonb;
  v_target_count integer := 0;
  v_valid_target_count integer := 0;
  v_promotion_id uuid;
  v_exists boolean := false;
  v_action text;
  v_changed_at timestamptz := now();
begin
  if p_round_id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  v_category :=
    upper(trim(p_category));
  v_code :=
    trim(p_code);
  v_scope :=
    upper(trim(coalesce(p_target_scope, '')));
  v_targets_input :=
    coalesce(p_line_group_ids, '[]'::jsonb);

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

  if v_scope not in ('ALL','SELECTED') then
    raise exception 'INVALID_PROMOTION_SCOPE';
  end if;

  if jsonb_typeof(v_targets_input) <> 'array' then
    raise exception 'INVALID_PROMOTION_LINE_GROUPS';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_targets_input) e(value)
    where
      jsonb_typeof(e.value) <> 'string'
      or nullif(trim(e.value #>> '{}'), '') is null
  ) then
    raise exception 'INVALID_PROMOTION_LINE_GROUPS';
  end if;

  select
    coalesce(
      jsonb_agg(
        x.line_group_id
        order by x.line_group_id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into
    v_new_targets,
    v_target_count
  from (
    select distinct
      trim(e.value) as line_group_id
    from
      jsonb_array_elements_text(
        v_targets_input
      ) e(value)
  ) x;

  if v_scope = 'ALL' then
    if v_target_count <> 0 then
      raise exception
        'PROMOTION_ALL_WITH_SELECTED_GROUPS';
    end if;

    v_new_targets := '[]'::jsonb;
  elsif v_target_count = 0 then
    raise exception
      'PROMOTION_SELECTED_GROUPS_REQUIRED';
  end if;

  -- Global lifecycle boundary first.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_round
  from
    public.settlement_summary_group_rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if v_round.status not in ('OPEN','CLOSED') then
    raise exception 'ROUND_NOT_EDITABLE';
  end if;

  -- Once the next Round has snapshotted/reset this Round, detailed
  -- source data is no longer guaranteed to exist for recalculation.
  if exists (
    select 1
    from
      public.settlement_summary_group_round_snapshots s
    where s.round_id = p_round_id
  ) then
    raise exception 'ROUND_CONFIG_ARCHIVED';
  end if;

  -- Preserve the existing Summary Group serialization boundary.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        v_round.settlement_session_id::text,
        v_round.summary_group_id
      ),
      0
    )
  );

  -- Then serialize this exact Round Promotion code.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_ROUND_POINT_PROMOTION',
        p_round_id::text,
        v_category,
        v_code
      ),
      0
    )
  );

  if v_scope = 'SELECTED' then
    select
      count(distinct cfg.line_group_id)::integer
    into v_valid_target_count
    from
      public.settlement_line_group_config cfg
    join
      jsonb_array_elements_text(
        v_new_targets
      ) t(line_group_id)
      on t.line_group_id =
        cfg.line_group_id
    where
      cfg.settlement_session_id =
        v_round.settlement_session_id
      and cfg.summary_group_id =
        v_round.summary_group_id
      and cfg.enabled = true;

    if v_valid_target_count <> v_target_count then
      raise exception
        'PROMOTION_LINE_GROUP_OUT_OF_SCOPE';
    end if;
  end if;

  select *
  into v_previous
  from
    public.settlement_round_point_promotions
  where
    round_id = p_round_id
    and category = v_category
    and code = v_code
  for update;

  v_exists := found;

  if v_exists then
    select
      coalesce(
        jsonb_agg(
          lg.line_group_id
          order by lg.line_group_id
        ),
        '[]'::jsonb
      )
    into v_previous_targets
    from
      public.settlement_round_point_promotion_line_groups lg
    where lg.promotion_id =
      v_previous.id;
  end if;

  if
    v_exists
    and v_previous.point_factor_pct =
      p_point_factor_pct
    and v_previous.target_scope =
      v_scope
    and v_previous_targets =
      v_new_targets
  then
    return jsonb_build_object(
      'changed', false,
      'action', 'NO_CHANGE',
      'round_id', p_round_id,
      'settlement_session_id',
        v_round.settlement_session_id,
      'summary_group_id',
        v_round.summary_group_id,
      'round_no', v_round.round_no,
      'round_status', v_round.status,
      'category', v_category,
      'code', v_code,
      'point_factor_pct',
        p_point_factor_pct,
      'target_scope', v_scope,
      'line_group_ids',
        v_new_targets
    );
  end if;

  v_action :=
    case
      when v_exists then 'UPDATE'
      else 'ADD'
    end;

  insert into
    public.settlement_round_point_promotions (
      round_id,
      category,
      code,
      point_factor_pct,
      target_scope,
      updated_at,
      updated_by
    )
  values (
    p_round_id,
    v_category,
    v_code,
    p_point_factor_pct,
    v_scope,
    v_changed_at,
    p_changed_by
  )
  on conflict (
    round_id,
    category,
    code
  )
  do update set
    point_factor_pct =
      excluded.point_factor_pct,
    target_scope =
      excluded.target_scope,
    updated_at =
      excluded.updated_at,
    updated_by =
      excluded.updated_by
  returning id
  into v_promotion_id;

  delete from
    public.settlement_round_point_promotion_line_groups
  where promotion_id =
    v_promotion_id;

  if v_scope = 'SELECTED' then
    insert into
      public.settlement_round_point_promotion_line_groups (
        promotion_id,
        line_group_id,
        created_at,
        created_by
      )
    select
      v_promotion_id,
      t.line_group_id,
      v_changed_at,
      p_changed_by
    from
      jsonb_array_elements_text(
        v_new_targets
      ) t(line_group_id);
  end if;

  insert into
    public.settlement_round_point_promotion_events (
      round_id,
      category,
      code,
      action,
      previous_point_factor_pct,
      new_point_factor_pct,
      previous_target_scope,
      new_target_scope,
      previous_line_group_ids,
      new_line_group_ids,
      changed_at,
      changed_by
    )
  values (
    p_round_id,
    v_category,
    v_code,
    v_action,
    case
      when v_exists
        then v_previous.point_factor_pct
      else null
    end,
    p_point_factor_pct,
    case
      when v_exists
        then v_previous.target_scope
      else null
    end,
    v_scope,
    case
      when v_exists
        then v_previous_targets
      else '[]'::jsonb
    end,
    v_new_targets,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'changed', true,
    'action', v_action,
    'round_id', p_round_id,
    'settlement_session_id',
      v_round.settlement_session_id,
    'summary_group_id',
      v_round.summary_group_id,
    'round_no', v_round.round_no,
    'round_status', v_round.status,
    'category', v_category,
    'code', v_code,
    'point_factor_pct',
      p_point_factor_pct,
    'target_scope', v_scope,
    'line_group_ids',
      v_new_targets,
    'changed_at', v_changed_at
  );
end;
$$;

-- ============================================================
-- 2. Delete Round-scoped Point Promotion
-- ============================================================

create or replace function
  public.delete_settlement_round_point_promotion(
    p_round_id uuid,
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
  v_round
    public.settlement_summary_group_rounds%rowtype;
  v_previous
    public.settlement_round_point_promotions%rowtype;
  v_category text;
  v_code text;
  v_previous_targets jsonb := '[]'::jsonb;
  v_changed_at timestamptz := now();
begin
  if p_round_id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  v_category :=
    upper(trim(p_category));
  v_code :=
    trim(p_code);

  if
    v_category not in (
      'A','B','E','F','G','H','L'
    )
    or coalesce(v_code, '') = ''
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

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_round
  from
    public.settlement_summary_group_rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if v_round.status not in ('OPEN','CLOSED') then
    raise exception 'ROUND_NOT_EDITABLE';
  end if;

  if exists (
    select 1
    from
      public.settlement_summary_group_round_snapshots s
    where s.round_id = p_round_id
  ) then
    raise exception 'ROUND_CONFIG_ARCHIVED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        v_round.settlement_session_id::text,
        v_round.summary_group_id
      ),
      0
    )
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_ROUND_POINT_PROMOTION',
        p_round_id::text,
        v_category,
        v_code
      ),
      0
    )
  );

  select *
  into v_previous
  from
    public.settlement_round_point_promotions
  where
    round_id = p_round_id
    and category = v_category
    and code = v_code
  for update;

  if not found then
    return jsonb_build_object(
      'changed', false,
      'action', 'NO_CHANGE',
      'round_id', p_round_id,
      'settlement_session_id',
        v_round.settlement_session_id,
      'summary_group_id',
        v_round.summary_group_id,
      'round_no', v_round.round_no,
      'round_status', v_round.status,
      'category', v_category,
      'code', v_code
    );
  end if;

  select
    coalesce(
      jsonb_agg(
        lg.line_group_id
        order by lg.line_group_id
      ),
      '[]'::jsonb
    )
  into v_previous_targets
  from
    public.settlement_round_point_promotion_line_groups lg
  where lg.promotion_id =
    v_previous.id;

  delete from
    public.settlement_round_point_promotions
  where id = v_previous.id;

  insert into
    public.settlement_round_point_promotion_events (
      round_id,
      category,
      code,
      action,
      previous_point_factor_pct,
      new_point_factor_pct,
      previous_target_scope,
      new_target_scope,
      previous_line_group_ids,
      new_line_group_ids,
      changed_at,
      changed_by
    )
  values (
    p_round_id,
    v_category,
    v_code,
    'DELETE',
    v_previous.point_factor_pct,
    null,
    v_previous.target_scope,
    null,
    v_previous_targets,
    '[]'::jsonb,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'changed', true,
    'action', 'DELETE',
    'round_id', p_round_id,
    'settlement_session_id',
      v_round.settlement_session_id,
    'summary_group_id',
      v_round.summary_group_id,
    'round_no', v_round.round_no,
    'round_status', v_round.status,
    'category', v_category,
    'code', v_code,
    'previous_point_factor_pct',
      v_previous.point_factor_pct,
    'previous_target_scope',
      v_previous.target_scope,
    'previous_line_group_ids',
      v_previous_targets,
    'changed_at', v_changed_at
  );
end;
$$;

-- ============================================================
-- 3. Replace Round-scoped Actual/Special Point
-- ============================================================

create or replace function
  public.replace_settlement_round_actual_special_codes(
    p_round_id uuid,
    p_codes jsonb,
    p_changed_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;
  v_codes_input jsonb;
  v_previous_codes jsonb := '[]'::jsonb;
  v_new_codes jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_limit_category text;
  v_changed_at timestamptz := now();
begin
  if p_round_id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  v_codes_input :=
    coalesce(p_codes, 'null'::jsonb);

  if
    v_codes_input = 'null'::jsonb
    or jsonb_typeof(v_codes_input) <> 'array'
  then
    raise exception 'INVALID_POINT_CODES';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_codes_input) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'INVALID_POINT_CODES';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  select *
  into v_round
  from
    public.settlement_summary_group_rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if v_round.status not in ('OPEN','CLOSED') then
    raise exception 'ROUND_NOT_EDITABLE';
  end if;

  if exists (
    select 1
    from
      public.settlement_summary_group_round_snapshots s
    where s.round_id = p_round_id
  ) then
    raise exception 'ROUND_CONFIG_ARCHIVED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        v_round.settlement_session_id::text,
        v_round.summary_group_id
      ),
      0
    )
  );

  -- Validate category, code width and Point Profile membership.
  if exists (
    with parsed as (
      select
        upper(trim(e.value->>'category')) as category,
        trim(e.value->>'code') as code
      from
        jsonb_array_elements(v_codes_input) e(value)
    )
    select 1
    from parsed p
    left join
      public.settlement_point_profiles pp
      on pp.settlement_session_id =
        v_round.settlement_session_id
      and pp.category =
        p.category
    where
      p.category not in (
        'A','B','E','F','G','H','L'
      )
      or coalesce(p.code, '') = ''
      or pp.category is null
      or (
        p.category in ('H','L')
        and p.code !~ '^\d$'
      )
      or (
        p.category in ('A','B')
        and p.code !~ '^\d{2}$'
      )
      or (
        p.category in ('E','F','G')
        and p.code !~ '^\d{3}$'
      )
  ) then
    raise exception 'INVALID_POINT_CODE';
  end if;

  -- Duplicate codes in the replacement payload are ambiguous.
  if exists (
    with parsed as (
      select
        upper(trim(e.value->>'category')) as category,
        trim(e.value->>'code') as code
      from
        jsonb_array_elements(v_codes_input) e(value)
    )
    select 1
    from parsed
    group by category, code
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_POINT_CODE';
  end if;

  -- Preserve the configured per-category maximum.
  with parsed as (
    select
      upper(trim(e.value->>'category')) as category,
      trim(e.value->>'code') as code
    from
      jsonb_array_elements(v_codes_input) e(value)
  ),
  counts as (
    select
      category,
      count(*)::integer as selected_count
    from parsed
    group by category
  )
  select c.category
  into v_limit_category
  from counts c
  join
    public.settlement_point_profiles pp
    on pp.settlement_session_id =
      v_round.settlement_session_id
    and pp.category =
      c.category
  where
    c.selected_count >
      pp.max_special_codes
  order by c.category
  limit 1;

  if v_limit_category is not null then
    raise exception
      'SPECIAL_POINT_LIMIT_%',
      v_limit_category;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category', x.category,
          'code', x.code
        )
        order by
          x.category,
          x.code
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into
    v_new_codes,
    v_count
  from (
    select
      upper(trim(e.value->>'category')) as category,
      trim(e.value->>'code') as code
    from
      jsonb_array_elements(v_codes_input) e(value)
  ) x;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category', sp.category,
          'code', sp.code
        )
        order by
          sp.category,
          sp.code
      ),
      '[]'::jsonb
    )
  into v_previous_codes
  from
    public.settlement_round_actual_special_point_codes sp
  where sp.round_id =
    p_round_id;

  if v_previous_codes = v_new_codes then
    return jsonb_build_object(
      'changed', false,
      'action', 'NO_CHANGE',
      'round_id', p_round_id,
      'settlement_session_id',
        v_round.settlement_session_id,
      'summary_group_id',
        v_round.summary_group_id,
      'round_no', v_round.round_no,
      'round_status', v_round.status,
      'count', v_count,
      'codes', v_new_codes
    );
  end if;

  delete from
    public.settlement_round_actual_special_point_codes
  where round_id =
    p_round_id;

  insert into
    public.settlement_round_actual_special_point_codes (
      round_id,
      category,
      code,
      created_at,
      updated_at,
      updated_by
    )
  select
    p_round_id,
    upper(trim(e.value->>'category')),
    trim(e.value->>'code'),
    v_changed_at,
    v_changed_at,
    p_changed_by
  from
    jsonb_array_elements(v_codes_input) e(value);

  insert into
    public.settlement_round_actual_special_point_events (
      round_id,
      action,
      previous_codes,
      new_codes,
      changed_at,
      changed_by
    )
  values (
    p_round_id,
    'REPLACE',
    v_previous_codes,
    v_new_codes,
    v_changed_at,
    p_changed_by
  );

  return jsonb_build_object(
    'changed', true,
    'action', 'REPLACE',
    'round_id', p_round_id,
    'settlement_session_id',
      v_round.settlement_session_id,
    'summary_group_id',
      v_round.summary_group_id,
    'round_no', v_round.round_no,
    'round_status', v_round.status,
    'count', v_count,
    'codes', v_new_codes,
    'changed_at', v_changed_at
  );
end;
$$;

-- ============================================================
-- 4. Security boundary
-- ============================================================

revoke all
on function
  public.set_settlement_round_point_promotion(
    uuid,text,text,numeric,text,jsonb,text
  )
from public, anon, authenticated;

grant execute
on function
  public.set_settlement_round_point_promotion(
    uuid,text,text,numeric,text,jsonb,text
  )
to service_role;

revoke all
on function
  public.delete_settlement_round_point_promotion(
    uuid,text,text,text
  )
from public, anon, authenticated;

grant execute
on function
  public.delete_settlement_round_point_promotion(
    uuid,text,text,text
  )
to service_role;

revoke all
on function
  public.replace_settlement_round_actual_special_codes(
    uuid,jsonb,text
  )
from public, anon, authenticated;

grant execute
on function
  public.replace_settlement_round_actual_special_codes(
    uuid,jsonb,text
  )
to service_role;

commit;
