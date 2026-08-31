-- P1A
-- Scope % Point Promotion by:
-- settlement + Summary Group + category + code.
--
-- Production preflight established zero existing Point
-- Promotion rows. Migration aborts if unexpected legacy rows
-- exist rather than guessing their Summary Group scope.

begin;

-- Production preflight confirmed that this table has
-- no legacy Point Promotion rows. Do not guess how to scope
-- unexpected legacy data: abort instead.
do $$
begin
  if exists (
    select 1
    from public.settlement_point_promotions
  ) then
    raise exception
      'LEGACY_POINT_PROMOTIONS_EXIST';
  end if;
end;
$$;


alter table public.settlement_point_promotions
  add column summary_group_id text;

alter table public.settlement_point_promotions
  add column updated_at timestamptz;

alter table public.settlement_point_promotions
  add column updated_by text;

alter table public.settlement_point_promotions
  drop constraint settlement_point_promotions_pkey;

alter table public.settlement_point_promotions
  alter column summary_group_id set not null;

alter table public.settlement_point_promotions
  alter column updated_at set default now();

alter table public.settlement_point_promotions
  alter column updated_at set not null;

alter table public.settlement_point_promotions
  add constraint
    settlement_point_promotions_summary_group_id_fkey
  foreign key (summary_group_id)
  references public.summary_groups(id);

alter table public.settlement_point_promotions
  add primary key (
    settlement_session_id,
    summary_group_id,
    category,
    code
  );


create table
  public.settlement_point_promotion_events (
    id bigint generated always as identity
      primary key,

    settlement_session_id uuid not null
      references public.settlement_sessions(id)
      on delete cascade,

    summary_group_id text not null
      references public.summary_groups(id),

    category text not null
      check (
        category in (
          'A','B','E','F','G','H','L'
        )
      ),

    code text not null,

    action text not null
      check (action in ('ADD','UPDATE','DELETE')),

    previous_point_factor_pct numeric(7,3)
      check (
        previous_point_factor_pct is null
        or (
          previous_point_factor_pct >= 0
          and previous_point_factor_pct <= 100
        )
      ),

    new_point_factor_pct numeric(7,3)
      check (
        new_point_factor_pct is null
        or (
          new_point_factor_pct >= 0
          and new_point_factor_pct <= 100
        )
      ),

    changed_at timestamptz not null default now(),
    changed_by text
  );

create index
  settlement_point_promotion_events_lookup_idx
on public.settlement_point_promotion_events (
  settlement_session_id,
  summary_group_id,
  changed_at desc
);

alter table
  public.settlement_point_promotion_events
enable row level security;

revoke all
on public.settlement_point_promotion_events
from public, anon, authenticated;

grant select, insert
on public.settlement_point_promotion_events
to service_role;

grant usage, select
on sequence
  public.settlement_point_promotion_events_id_seq
to service_role;

grant select, insert, update, delete
on public.settlement_point_promotions
to service_role;


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


revoke all
on function
  public.set_settlement_summary_group_point_promotion(
    uuid,text,text,text,numeric,text
  )
from public, anon, authenticated;

grant execute
on function
  public.set_settlement_summary_group_point_promotion(
    uuid,text,text,text,numeric,text
  )
to service_role;

revoke all
on function
  public.delete_settlement_summary_group_point_promotion(
    uuid,text,text,text,text
  )
from public, anon, authenticated;

grant execute
on function
  public.delete_settlement_summary_group_point_promotion(
    uuid,text,text,text,text
  )
to service_role;


-- Keep the existing OPEN API signature for zero-downtime
-- deployment, but new Promotion rows are Summary-Group scoped.
create or replace function
  public.open_settlement_session(
    p_business_date date,
    p_promotions jsonb default '[]'::jsonb,
    p_opened_by text default 'DASHBOARD'
  )
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_summary text;
  v_category text;
  v_code text;
  v_factor numeric;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );

  if exists (
    select 1
    from public.settlement_sessions
    where status = 'OPEN'
  ) then
    raise exception 'SETTLEMENT_ALREADY_OPEN';
  end if;

  if
    p_promotions is null
    or jsonb_typeof(p_promotions) <> 'array'
  then
    raise exception 'INVALID_PROMOTIONS';
  end if;

  insert into public.settlement_sessions (
    business_date,
    status,
    opened_by
  )
  values (
    p_business_date,
    'OPEN',
    p_opened_by
  )
  returning id into v_id;

  insert into public.settlement_line_group_config (
    settlement_session_id,
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct
  )
  select
    v_id,
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct
  from public.line_groups
  where enabled = true;

  insert into public.settlement_allocation_rules (
    settlement_session_id,
    summary_group_id,
    category,
    threshold,
    destination
  )
  select
    v_id,
    summary_group_id,
    category,
    threshold,
    destination
  from public.allocation_rules
  where enabled = true;

  insert into public.settlement_point_profiles (
    settlement_session_id,
    category,
    special_multiplier,
    max_special_codes
  )
  select
    v_id,
    category,
    special_multiplier,
    max_special_codes
  from public.point_category_profiles
  on conflict (
    settlement_session_id,
    category
  )
  do nothing;

  for v_item in
    select value
    from jsonb_array_elements(p_promotions)
  loop
    v_summary :=
      nullif(
        trim(v_item->>'summary_group_id'),
        ''
      );

    v_category :=
      upper(trim(v_item->>'category'));

    v_code :=
      trim(v_item->>'code');

    begin
      v_factor :=
        (v_item->>'point_factor_pct')::numeric;
    exception when others then
      raise exception
        'INVALID_PROMOTION_FACTOR';
    end;

    if
      v_category not in (
        'A','B','E','F','G','H','L'
      )
      or coalesce(v_code, '') = ''
      or v_factor < 0
      or v_factor > 100
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

    if v_summary is not null then
      if not exists (
        select 1
        from public.settlement_line_group_config cfg
        where
          cfg.settlement_session_id = v_id
          and cfg.summary_group_id =
            v_summary
          and cfg.enabled = true
      ) then
        raise exception
          'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
      end if;

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
        v_id,
        v_summary,
        v_category,
        v_code,
        v_factor,
        now(),
        p_opened_by
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
    else
      -- Backward compatibility during deployment:
      -- an old UI draft without Summary Group preserves
      -- the previous global behavior by copying to all
      -- Summary Groups in this new settlement.
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
      select distinct
        v_id,
        cfg.summary_group_id,
        v_category,
        v_code,
        v_factor,
        now(),
        p_opened_by
      from public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id = v_id
        and cfg.enabled = true
        and cfg.summary_group_id is not null
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
    end if;
  end loop;

  return v_id;
end;
$$;

revoke all
on function
  public.open_settlement_session(
    date,jsonb,text
  )
from public, anon, authenticated;

grant execute
on function
  public.open_settlement_session(
    date,jsonb,text
  )
to service_role;




-- Summary-level risk: Promotion must match Summary Group.
create or replace view public.session_code_risk_state as
with code_base as (
  select
    oi.settlement_session_id,
    oi.business_date,
    cfg.summary_group_id,
    oi.category,
    oi.code,
    sum(oi.quantity)::bigint as order_total,
    sum(oi.quantity::numeric * (1 - cfg.reduction_pct / 100.0)) as adjusted_total
  from public.order_items oi
  join public.settlement_line_group_config cfg
    on cfg.settlement_session_id=oi.settlement_session_id
   and cfg.line_group_id=oi.line_group_id
  where oi.settlement_session_id is not null
  group by oi.settlement_session_id,oi.business_date,cfg.summary_group_id,oi.category,oi.code
), code_cuts as (
  select
    b.settlement_session_id,b.summary_group_id,i.category,i.code,
    sum(i.quantity)::bigint as confirmed_cut
  from public.settlement_transfer_batches b
  join public.settlement_transfer_batch_items i on i.batch_id=b.id
  group by b.settlement_session_id,b.summary_group_id,i.category,i.code
), enriched as (
  select
    cb.*,
    pp.special_multiplier,
    pp.max_special_codes,
    coalesce(pm.point_factor_pct,100)::numeric(7,3) as promotion_factor_pct,
    round(pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,3) as effective_multiplier,
    round(cb.order_total::numeric * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as point_exposure,
    (sp.code is not null) as actual_special_point,
    coalesce(cc.confirmed_cut,0)::bigint as confirmed_cut,
    greatest(0,cb.order_total-coalesce(cc.confirmed_cut,0))::bigint as retained_quantity,
    round(greatest(0,cb.order_total-coalesce(cc.confirmed_cut,0))::numeric
      * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as retained_point_exposure
  from code_base cb
  join public.settlement_point_profiles pp
    on pp.settlement_session_id=cb.settlement_session_id and pp.category=cb.category
  left join public.settlement_point_promotions pm
    on pm.settlement_session_id=cb.settlement_session_id and pm.summary_group_id = cb.summary_group_id
    and pm.category=cb.category and pm.code=cb.code
  left join public.settlement_actual_special_point_codes sp
    on sp.settlement_session_id=cb.settlement_session_id and sp.category=cb.category and sp.code=cb.code
  left join code_cuts cc
    on cc.settlement_session_id=cb.settlement_session_id
   and cc.summary_group_id=cb.summary_group_id
   and cc.category=cb.category
   and cc.code=cb.code
), ranked as (
  select
    e.*,
    row_number() over(
      partition by e.settlement_session_id,e.summary_group_id,e.category
      order by e.retained_point_exposure desc,e.retained_quantity desc,e.code asc
    ) as reserve_rank
  from enriched e
)
select
  r.settlement_session_id,
  r.business_date,
  r.summary_group_id,
  r.category,
  r.code,
  r.order_total,
  r.adjusted_total,
  r.special_multiplier,
  r.max_special_codes,
  r.promotion_factor_pct,
  r.effective_multiplier,
  r.point_exposure,
  r.actual_special_point,
  r.reserve_rank,
  (r.reserve_rank <= r.max_special_codes and r.retained_quantity > 0) as reserve_candidate,
  case when r.actual_special_point then r.point_exposure else 0::numeric end as actual_point,
  r.confirmed_cut,
  r.retained_quantity as available_to_cut,
  r.retained_quantity,
  r.retained_point_exposure
from ranked r;

-- LINE-group risk inherits its parent Summary Group Promotion.
create or replace view public.session_line_group_code_risk_state as
with code_base as (
  select
    oi.settlement_session_id,
    oi.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    oi.category,
    oi.code,
    sum(oi.quantity)::bigint as order_total
  from public.order_items oi
  join public.settlement_line_group_config cfg
    on cfg.settlement_session_id = oi.settlement_session_id
   and cfg.line_group_id = oi.line_group_id
  where oi.settlement_session_id is not null
  group by
    oi.settlement_session_id,
    oi.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    oi.category,
    oi.code
),
enriched as (
  select
    cb.*,

    pp.special_multiplier,
    pp.max_special_codes,

    (
      pp.special_multiplier is not null
      and pp.special_multiplier > 0
      and pp.max_special_codes is not null
      and pp.max_special_codes > 0
    ) as multiplier_configured,

    coalesce(
      pm.point_factor_pct,
      100
    )::numeric(7,3) as promotion_factor_pct,

    case
      when pp.special_multiplier is not null
       and pp.special_multiplier > 0
      then round(
        pp.special_multiplier
        * coalesce(pm.point_factor_pct, 100)
        / 100.0,
        3
      )
      else null
    end::numeric(12,3) as effective_multiplier,

    case
      when pp.special_multiplier is not null
       and pp.special_multiplier > 0
      then round(
        cb.order_total::numeric
        * pp.special_multiplier
        * coalesce(pm.point_factor_pct, 100)
        / 100.0,
        2
      )
      else null
    end::numeric(18,2) as point_exposure

  from code_base cb

  left join public.settlement_point_profiles pp
    on pp.settlement_session_id = cb.settlement_session_id
   and pp.category = cb.category

  left join public.settlement_point_promotions pm
    on pm.settlement_session_id = cb.settlement_session_id
   and pm.summary_group_id = cb.summary_group_id
    and pm.category = cb.category
   and pm.code = cb.code
),
ranked as (
  select
    e.*,

    row_number() over (
      partition by
        e.settlement_session_id,
        e.line_group_id,
        e.category

      order by
        coalesce(e.point_exposure, 0) desc,
        e.order_total desc,
        e.code asc
    ) as reserve_rank

  from enriched e
)
select
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,
  r.category,
  r.code,
  r.order_total,
  r.special_multiplier,
  r.max_special_codes,
  r.multiplier_configured,
  r.promotion_factor_pct,
  r.effective_multiplier,
  r.point_exposure,
  r.reserve_rank,

  (
    r.multiplier_configured
    and r.order_total > 0
    and r.reserve_rank <= r.max_special_codes
  ) as reserve_candidate

from ranked r;

commit;
