-- Dashboard risk snapshot read projection.
--
-- PERFORMANCE PURPOSE
-- -------------------
-- The production Dashboard previously opened multiple heavy risk views
-- concurrently. Those views expand the same Round-scoped canonical data
-- repeatedly and can contend for PostgreSQL resources until one statement
-- exceeds statement_timeout.
--
-- This RPC preserves the existing risk semantics but evaluates one
-- request-scoped canonical Round rowset and derives Dashboard projections
-- from that shared materialized base.
--
-- Existing public risk views remain authoritative for all other callers.
-- This migration does NOT replace or alter those views.
--
-- Generated from locked baseline:
--   bf2dbe7d5626075d1ada88d08465849cfb88b604
--
-- Effective source migrations:
--   session_round_line_group_code_risk_shadow: supabase/migrations/20260909143000_harden_round_scoped_point_shadow_historical_cut_lineage.sql
--   session_line_group_code_risk_state: supabase/migrations/20260910163000_cut_over_production_risk_base_to_round.sql
--   session_round_code_risk_shadow: supabase/migrations/20260909143000_harden_round_scoped_point_shadow_historical_cut_lineage.sql
--   session_round_category_risk_shadow: supabase/migrations/20260909140000_add_round_scoped_point_read_model_shadow.sql
--   session_risk_pool_state: supabase/migrations/20260901032000_scope_actual_point_readiness_by_risk_pool.sql
--   session_overall_risk_state: supabase/migrations/202608260019_add_one_digit_hl_risk_pools.sql
--   session_line_group_code_retention_state: supabase/migrations/20260911003000_optimize_line_group_retention_state.sql
--   session_line_group_risk_band_state: supabase/migrations/20260828033000_add_line_group_risk_band_state.sql
--   session_line_group_risk_state: supabase/migrations/20260828041000_add_line_group_retained_risk_state.sql

create or replace function public.dashboard_risk_snapshot(
  p_settlement_session_id uuid,
  p_summary_group_id text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$

with

canonical_line_code as materialized (
select *
from (
with round_ranked as (
  select
    r.*,
    row_number() over (
      partition by
        r.settlement_session_id,
        r.summary_group_id
      order by
        r.round_no desc
    ) as latest_rank
  from
    public.settlement_summary_group_rounds r
  where
    r.status in ('OPEN','CLOSED')
),
active_rounds as (
  select
    rr.id as round_id,
    rr.settlement_session_id,
    rr.summary_group_id,
    rr.round_no,
    rr.status as round_status
  from round_ranked rr
  where
    rr.latest_rank = 1
    and not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots s
      where
        s.round_id = rr.id
    )
),
code_base as (
  select
    ar.round_id,
    ar.round_no,
    ar.round_status,
    oi.settlement_session_id,
    oi.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    cfg.reduction_pct,
    oi.category,
    oi.code,
    sum(oi.quantity)::bigint
      as order_total,
    sum(
      oi.quantity::numeric
      * (
        1
        - cfg.reduction_pct
          / 100.0
      )
    ) as adjusted_total
  from
    public.order_items oi
  join active_rounds ar
    on ar.round_id =
      oi.summary_group_round_id
   and ar.settlement_session_id =
      oi.settlement_session_id
  join
    public.settlement_line_group_config cfg
    on cfg.settlement_session_id =
      oi.settlement_session_id
   and cfg.line_group_id =
      oi.line_group_id
   and cfg.summary_group_id =
      ar.summary_group_id
  where
    oi.settlement_session_id
      is not null
  group by
    ar.round_id,
    ar.round_no,
    ar.round_status,
    oi.settlement_session_id,
    oi.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    cfg.reduction_pct,
    oi.category,
    oi.code
),
missing_lineage_cut_totals as (
  select
    b.settlement_session_id,
    b.business_date,
    b.summary_group_id,
    i.category,
    i.code,
    sum(i.quantity)::bigint
      as missing_cut_quantity
  from
    public.settlement_transfer_batches b
  join
    public.settlement_transfer_batch_items i
    on i.batch_id = b.id
  where
    i.line_group_id is null
    and b.line_group_id is null
  group by
    b.settlement_session_id,
    b.business_date,
    b.summary_group_id,
    i.category,
    i.code
),

source_line_group_resolution as (
  select
    cb.settlement_session_id,
    cb.business_date,
    cb.summary_group_id,
    cb.category,
    cb.code,
    count(*)::integer
      as source_line_group_count,
    min(cb.line_group_id)
      as unique_line_group_id,
    sum(cb.order_total)::bigint
      as source_order_total
  from code_base cb
  group by
    cb.settlement_session_id,
    cb.business_date,
    cb.summary_group_id,
    cb.category,
    cb.code
),

resolved_line_cut_items as (
  select
    b.settlement_session_id,
    b.summary_group_id,
    i.category,
    i.code,
    i.quantity,
    case
      when i.line_group_id is not null
        then i.line_group_id
      when b.line_group_id is not null
        then b.line_group_id
      when
        sgr.source_line_group_count = 1
        and ml.missing_cut_quantity <= sgr.source_order_total
      then sgr.unique_line_group_id
      else null
    end as resolved_line_group_id
  from
    public.settlement_transfer_batches b
  join
    public.settlement_transfer_batch_items i
    on i.batch_id = b.id
  left join missing_lineage_cut_totals ml
    on ml.settlement_session_id = b.settlement_session_id
   and ml.business_date = b.business_date
   and ml.summary_group_id = b.summary_group_id
   and ml.category = i.category
   and ml.code = i.code
  left join source_line_group_resolution sgr
    on sgr.settlement_session_id = b.settlement_session_id
   and sgr.business_date = b.business_date
   and sgr.summary_group_id = b.summary_group_id
   and sgr.category = i.category
   and sgr.code = i.code
),

line_cuts as (
  select
    rlci.settlement_session_id,
    rlci.summary_group_id,
    rlci.resolved_line_group_id as line_group_id,
    rlci.category,
    rlci.code,
    sum(rlci.quantity)::bigint as confirmed_cut
  from resolved_line_cut_items rlci
  where rlci.resolved_line_group_id is not null
  group by
    rlci.settlement_session_id,
    rlci.summary_group_id,
    rlci.resolved_line_group_id,
    rlci.category,
    rlci.code
),

promotion_resolved as (
  select
    cb.*,
    pp.special_multiplier,
    pp.max_special_codes,
    (
      pp.special_multiplier
        is not null
      and pp.special_multiplier > 0
      and pp.max_special_codes
        is not null
      and pp.max_special_codes > 0
    ) as multiplier_configured,
    rp.id as promotion_id,
    rp.target_scope,
    case
      when rp.id is null
        then 100::numeric
      when rp.target_scope = 'ALL'
        then rp.point_factor_pct
      when
        rp.target_scope = 'SELECTED'
        and exists (
          select 1
          from
            public.settlement_round_point_promotion_line_groups
              plg
          where
            plg.promotion_id = rp.id
            and plg.line_group_id =
              cb.line_group_id
        )
        then rp.point_factor_pct
      else 100::numeric
    end::numeric(7,3)
      as promotion_factor_pct,
    coalesce(
      lc.confirmed_cut,
      0
    )::bigint
      as confirmed_cut
  from code_base cb
  left join
    public.settlement_point_profiles pp
    on pp.settlement_session_id =
      cb.settlement_session_id
   and pp.category =
      cb.category
  left join
    public.settlement_round_point_promotions rp
    on rp.round_id =
      cb.round_id
   and rp.category =
      cb.category
   and rp.code =
      cb.code
  left join line_cuts lc
    on lc.settlement_session_id =
      cb.settlement_session_id
   and lc.summary_group_id =
      cb.summary_group_id
   and lc.line_group_id =
      cb.line_group_id
   and lc.category =
      cb.category
   and lc.code =
      cb.code
),
calculated as (
  select
    pr.*,
    case
      when
        pr.special_multiplier
          is not null
        and pr.special_multiplier > 0
      then
        pr.special_multiplier
        * pr.promotion_factor_pct
        / 100.0
      else null
    end as effective_multiplier_raw,
    case
      when
        pr.special_multiplier
          is not null
        and pr.special_multiplier > 0
      then
        pr.order_total::numeric
        * pr.special_multiplier
        * pr.promotion_factor_pct
        / 100.0
      else null
    end as point_exposure_raw,
    greatest(
      0,
      pr.order_total
      - pr.confirmed_cut
    )::bigint
      as retained_quantity
  from promotion_resolved pr
),
ranked as (
  select
    c.*,
    case
      when
        c.special_multiplier
          is not null
        and c.special_multiplier > 0
      then
        c.retained_quantity::numeric
        * c.special_multiplier
        * c.promotion_factor_pct
        / 100.0
      else null
    end as retained_point_exposure_raw,
    row_number() over (
      partition by
        c.round_id,
        c.line_group_id,
        c.category
      order by
        coalesce(
          round(
            c.point_exposure_raw,
            2
          ),
          0
        ) desc,
        c.order_total desc,
        c.code asc
    ) as reserve_rank
  from calculated c
)
select
  r.round_id,
  r.round_no,
  r.round_status,
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,
  r.reduction_pct,
  r.category,
  r.code,
  r.order_total,
  r.adjusted_total,
  r.special_multiplier,
  r.max_special_codes,
  r.multiplier_configured,
  r.promotion_factor_pct,
  round(
    r.effective_multiplier_raw,
    3
  )::numeric(12,3)
    as effective_multiplier,
  round(
    r.point_exposure_raw,
    2
  )::numeric(18,2)
    as point_exposure,
  r.point_exposure_raw,
  r.confirmed_cut,
  r.retained_quantity,
  round(
    r.retained_point_exposure_raw,
    2
  )::numeric(18,2)
    as retained_point_exposure,
  r.retained_point_exposure_raw,
  r.reserve_rank,
  (
    r.multiplier_configured
    and r.order_total > 0
    and r.reserve_rank
      <= r.max_special_codes
  ) as reserve_candidate
from ranked r
) __canonical
where
  __canonical.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __canonical.summary_group_id =
       p_summary_group_id
  )
),

line_code_risk as materialized (
select *
from (
select
  settlement_session_id,
  business_date,
  line_group_id,
  line_group_name,
  summary_group_id,
  category,
  code,
  order_total,
  special_multiplier,
  max_special_codes,
  multiplier_configured,
  promotion_factor_pct,
  effective_multiplier,
  point_exposure,
  reserve_rank,
  reserve_candidate
from canonical_line_code
) __line_code
where
  __line_code.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __line_code.summary_group_id =
       p_summary_group_id
  )
),

code_risk as materialized (
select *
from (
with rolled as (
  select
    lg.round_id,
    max(lg.round_no)::integer
      as round_no,
    max(lg.round_status)
      as round_status,
    lg.settlement_session_id,
    lg.business_date,
    lg.summary_group_id,
    lg.category,
    lg.code,
    sum(lg.order_total)::bigint
      as order_total,
    sum(lg.adjusted_total)
      as adjusted_total,
    max(lg.special_multiplier)
      as special_multiplier,
    max(lg.max_special_codes)::integer
      as max_special_codes,
    case
      when
        sum(lg.order_total) > 0
      then
        round(
          sum(
            lg.order_total::numeric
            * lg.promotion_factor_pct
          )
          / sum(lg.order_total)::numeric,
          3
        )
      else 100::numeric
    end::numeric(7,3)
      as promotion_factor_pct,
    sum(lg.point_exposure_raw)
      as point_exposure_raw,
    sum(lg.confirmed_cut)::bigint
      as confirmed_cut,
    sum(lg.retained_quantity)::bigint
      as retained_quantity,
    sum(lg.retained_point_exposure_raw)
      as retained_point_exposure_raw
  from
    canonical_line_code lg
  group by
    lg.round_id,
    lg.settlement_session_id,
    lg.business_date,
    lg.summary_group_id,
    lg.category,
    lg.code
),
enriched as (
  select
    r.*,
    case
      when
        r.order_total > 0
        and r.special_multiplier
          is not null
      then
        r.point_exposure_raw
        / r.order_total::numeric
      else null
    end as effective_multiplier_raw,
    exists (
      select 1
      from
        public.settlement_round_actual_special_point_codes sp
      where
        sp.round_id = r.round_id
        and sp.category = r.category
        and sp.code = r.code
    ) as actual_special_point
  from rolled r
),
ranked as (
  select
    e.*,
    row_number() over (
      partition by
        e.round_id,
        e.summary_group_id,
        e.category
      order by
        coalesce(
          round(
            e.retained_point_exposure_raw,
            2
          ),
          0
        ) desc,
        e.retained_quantity desc,
        e.code asc
    ) as reserve_rank
  from enriched e
)
select
  r.round_id,
  r.round_no,
  r.round_status,
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
  round(
    r.effective_multiplier_raw,
    3
  )::numeric(12,3)
    as effective_multiplier,
  round(
    r.point_exposure_raw,
    2
  )::numeric(18,2)
    as point_exposure,
  r.actual_special_point,
  r.reserve_rank,
  (
    r.reserve_rank
      <= r.max_special_codes
    and r.retained_quantity > 0
  ) as reserve_candidate,
  case
    when r.actual_special_point
      then round(
        r.point_exposure_raw,
        2
      )
    else 0::numeric
  end::numeric(18,2)
    as actual_point,
  r.confirmed_cut,
  r.retained_quantity
    as available_to_cut,
  r.retained_quantity,
  round(
    r.retained_point_exposure_raw,
    2
  )::numeric(18,2)
    as retained_point_exposure
from ranked r
) __code
where
  __code.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __code.summary_group_id =
       p_summary_group_id
  )
),

category_risk as materialized (
select *
from (
with actual_counts as (
  select
    sp.round_id,
    sp.category,
    count(*)::integer
      as actual_selected_count
  from
    public.settlement_round_actual_special_point_codes sp
  group by
    sp.round_id,
    sp.category
)
select
  c.round_id,
  max(c.round_no)::integer
    as round_no,
  max(c.round_status)
    as round_status,
  c.settlement_session_id,
  c.business_date,
  c.summary_group_id,
  c.category,
  max(c.special_multiplier)
    as special_multiplier,
  max(c.max_special_codes)::integer
    as max_special_codes,
  coalesce(
    max(ac.actual_selected_count),
    0
  )::integer
    as actual_selected_count,
  sum(c.order_total)::bigint
    as order_total,
  round(
    sum(c.adjusted_total),
    2
  ) as adjusted_total,
  round(
    sum(
      case
        when c.reserve_candidate
          then c.retained_point_exposure
        else 0
      end
    ),
    2
  ) as point_reserve,
  round(
    sum(c.actual_point),
    2
  ) as actual_point,
  round(
    sum(c.adjusted_total)
    - sum(
      case
        when c.reserve_candidate
          then c.retained_point_exposure
        else 0
      end
    ),
    2
  ) as reserve_safe_capacity,
  case
    when sum(c.adjusted_total) > 0
    then round(
      sum(
        case
          when c.reserve_candidate
            then c.retained_point_exposure
          else 0
        end
      )
      / sum(c.adjusted_total)
      * 100,
      2
    )
    when sum(
      case
        when c.reserve_candidate
          then c.retained_point_exposure
        else 0
      end
    ) > 0
      then 100::numeric
    else 0::numeric
  end as reserve_risk_pct
from
  code_risk c
left join actual_counts ac
  on ac.round_id = c.round_id
 and ac.category = c.category
group by
  c.round_id,
  c.settlement_session_id,
  c.business_date,
  c.summary_group_id,
  c.category
) __category
where
  __category.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __category.summary_group_id =
       p_summary_group_id
  )
),

risk_pool as materialized (
select *
from (
with groups as (
  select distinct cfg.settlement_session_id,s.business_date,cfg.summary_group_id
  from public.settlement_line_group_config cfg
  join public.settlement_sessions s on s.id=cfg.settlement_session_id
), pools as (
  select unnest(array['MAIN'::text,'H'::text,'L'::text]) as risk_pool
), cat as (
  select
    c.settlement_session_id,c.business_date,c.summary_group_id,d.risk_pool,
    sum(c.order_total)::bigint as gross_received,
    round(sum(c.adjusted_total),2)::numeric(18,2) as adjusted_received,
    round(sum(c.point_reserve),2)::numeric(18,2) as point_reserve_total,
    round(sum(c.actual_point),2)::numeric(18,2) as actual_point_total,
    bool_and(case when c.order_total>0 then c.special_multiplier>0 else true end) as multiplier_configured
  from category_risk c
  join public.category_definitions d on d.category=c.category and d.enabled=true
  group by c.settlement_session_id,c.business_date,c.summary_group_id,d.risk_pool
), pool_readiness as (
  select
    c.settlement_session_id,
    c.summary_group_id,
    d.risk_pool,
    bool_and(
      case
        when c.order_total <= 0 then true
        when c.category in ('A','B','E')
          then c.actual_selected_count = 1
        when c.category in ('G','H','L')
          then c.actual_selected_count = c.max_special_codes
        when c.category = 'F'
          then c.actual_selected_count between 0 and c.max_special_codes
        else false
      end
    ) as actual_codes_ready
  from category_risk c
  join public.category_definitions d
    on d.category = c.category
   and d.enabled = true
  group by
    c.settlement_session_id,
    c.summary_group_id,
    d.risk_pool
), cuts as (
  select settlement_session_id,summary_group_id,risk_pool,round(sum(cut_total),2)::numeric(18,2) as confirmed_cut_total
  from public.settlement_transfer_batches
  group by settlement_session_id,summary_group_id,risk_pool
), base as (
  select
    g.settlement_session_id,g.business_date,g.summary_group_id,p.risk_pool,
    coalesce(c.gross_received,0)::bigint as gross_received,
    coalesce(c.adjusted_received,0)::numeric(18,2) as adjusted_received,
    coalesce(c.point_reserve_total,0)::numeric(18,2) as point_reserve_total,
    coalesce(c.actual_point_total,0)::numeric(18,2) as actual_point_total,
    coalesce(c.multiplier_configured,true) as multiplier_configured,
    coalesce(pr.actual_codes_ready,true) as actual_codes_ready,
    'RESERVE'::text as risk_mode,
    coalesce(c.point_reserve_total,0)::numeric(18,2) as risk_point_total,
    round(coalesce(c.adjusted_received,0)-coalesce(c.point_reserve_total,0),2)::numeric(18,2) as safety_margin,
    coalesce(x.confirmed_cut_total,0)::numeric(18,2) as confirmed_cut_total,
    coalesce(rs.point_loss_tolerance,case when p.risk_pool='MAIN' then 10 else 0 end)::numeric(18,2) as point_loss_tolerance,
    case when coalesce(c.adjusted_received,0)>0
      then round(coalesce(c.point_reserve_total,0)/c.adjusted_received*100,2)
      when coalesce(c.point_reserve_total,0)>0 then 100::numeric
      else 0::numeric end as risk_pct
  from groups g
  cross join pools p
  left join cat c
    on c.settlement_session_id=g.settlement_session_id
   and c.summary_group_id=g.summary_group_id
   and c.risk_pool=p.risk_pool
  left join cuts x
    on x.settlement_session_id=g.settlement_session_id
   and x.summary_group_id=g.summary_group_id
   and x.risk_pool=p.risk_pool
  left join pool_readiness pr
    on pr.settlement_session_id=g.settlement_session_id
   and pr.summary_group_id=g.summary_group_id
   and pr.risk_pool=p.risk_pool
  left join public.summary_group_risk_pool_settings rs
    on rs.summary_group_id=g.summary_group_id and rs.risk_pool=p.risk_pool
), final as (
  select b.*,
    round(b.adjusted_received+b.point_loss_tolerance,2)::numeric(18,2) as risk_budget,
    case when b.multiplier_configured
      then greatest(0,round(b.risk_point_total-(b.adjusted_received+b.point_loss_tolerance),2))::numeric(18,2)
      else 0::numeric(18,2) end as excess_point_risk
  from base b
)
select
  f.*,
  round(f.risk_budget-f.risk_point_total,2)::numeric(18,2) as risk_budget_margin
from final f
) __pool
where
  __pool.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __pool.summary_group_id =
       p_summary_group_id
  )
),

overall_risk as materialized (
select *
from (
select
  f.settlement_session_id,
  f.business_date,
  f.summary_group_id,
  f.gross_received,
  f.adjusted_received,
  f.point_reserve_total,
  f.actual_point_total,
  f.actual_codes_ready,
  f.risk_mode,
  f.risk_point_total,
  round(f.safety_margin,2) as net_safe_capacity,
  f.confirmed_cut_total,
  greatest(0,round(f.safety_margin,2))::numeric(18,2) as remaining_safe_capacity,
  greatest(0,round(-f.safety_margin,2))::numeric(18,2) as over_safe_amount,
  f.risk_pct,
  f.safety_margin,
  case when f.adjusted_received>0 then round(f.safety_margin/f.adjusted_received*100,2) else 0::numeric end as safety_margin_pct,
  null::smallint as risk_policy_band_id,
  'ใช้ Risk Budget'::text as risk_level_label,
  0::numeric(7,3) as recommended_cut_pct,
  0::numeric(18,2) as recommended_cut_total,
  0::numeric(18,2) as remaining_recommended_cut,
  0::numeric(18,2) as over_recommended_cut,
  f.point_loss_tolerance,
  f.risk_budget,
  f.risk_budget_margin,
  f.excess_point_risk
from risk_pool f
where f.risk_pool='MAIN'
) __overall
where
  __overall.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __overall.summary_group_id =
       p_summary_group_id
  )
),

retention as materialized (
select *
from (
with code_base as (
  select
    c.settlement_session_id,
    c.business_date,
    c.line_group_id,
    c.line_group_name,
    c.summary_group_id,
    cfg.reduction_pct::numeric(7,3)
      as reduction_pct,
    cfg.enabled,
    (
      sum(c.order_total) over (
        partition by
          c.settlement_session_id,
          c.line_group_id
      )
    )::bigint
      as gross_received,
    c.category,
    c.code,
    c.order_total,
    c.special_multiplier,
    c.max_special_codes,
    c.multiplier_configured,
    c.promotion_factor_pct,
    c.effective_multiplier
  from line_code_risk c
  join public.settlement_line_group_config cfg
    on cfg.settlement_session_id =
       c.settlement_session_id
   and cfg.line_group_id =
       c.line_group_id
),
banded as (
  select
    cb.*,
    (
      floor(
        cb.gross_received::numeric
        / 100000::numeric
      )
      * 100000::numeric
    )::bigint
      as calculation_band
  from code_base cb
),
budgeted as (
  select
    b.*,
    round(
      100::numeric - b.reduction_pct,
      3
    )::numeric(7,3)
      as risk_budget_pct,
    round(
      b.calculation_band::numeric
      * (
        100::numeric - b.reduction_pct
      )
      / 100.0,
      2
    )::numeric(18,2)
      as risk_budget,
    case
      when b.calculation_band = 0
        then 'WAITING_FIRST_BAND'::text
      else 'READY'::text
    end
      as calculation_status
  from banded b
),
prepared as (
  select
    b.settlement_session_id,
    b.business_date,
    b.line_group_id,
    b.line_group_name,
    b.summary_group_id,
    b.reduction_pct,
    b.enabled,
    b.gross_received,
    b.calculation_band,
    b.risk_budget_pct,
    b.risk_budget,
    b.calculation_status,
    b.category,
    b.code,
    b.order_total,
    b.special_multiplier,
    b.max_special_codes,
    b.multiplier_configured,
    b.promotion_factor_pct,
    b.effective_multiplier,
    case
      when b.category in ('A','B')
        then 2
      else b.max_special_codes
    end::integer
      as budget_divisor,
    coalesce(
      x.confirmed_cut,
      0::bigint
    )::bigint
      as confirmed_cut,
    greatest(
      b.order_total
      - coalesce(
          x.confirmed_cut,
          0::bigint
        ),
      0::bigint
    )::bigint
      as retained_quantity,
    (
      coalesce(
        x.confirmed_cut,
        0::bigint
      ) > b.order_total
    )
      as confirmed_cut_exceeds_order_total,
    coalesce(
      x.confirmed_batch_count,
      0
    )::integer
      as confirmed_batch_count,
    x.last_confirmed_at
  from budgeted b
  left join lateral (
    select
      sum(i.quantity)::bigint
        as confirmed_cut,
      count(distinct tb.id)::integer
        as confirmed_batch_count,
      max(tb.confirmed_at)
        as last_confirmed_at
    from public.settlement_transfer_batches tb
    join public.settlement_transfer_batch_items i
      on i.batch_id = tb.id
    where tb.settlement_session_id =
          b.settlement_session_id
      and tb.line_group_id =
          b.line_group_id
      and tb.line_group_id is not null
      and i.line_group_id is not null
      and i.line_group_id =
          tb.line_group_id
      and i.category =
          b.category
      and i.code =
          b.code
      and tb.risk_model =
          'CATEGORY_RETENTION'
    group by tb.business_date
  ) x
    on true
),
limits as (
  select
    p.*,
    case
      when not p.enabled
        then null::bigint
      when p.calculation_status <> 'READY'
        then null::bigint
      when not p.multiplier_configured
        then null::bigint
      when coalesce(
        p.effective_multiplier,
        0::numeric
      ) <= 0::numeric
        then null::bigint
      else floor(
        p.risk_budget
        / p.effective_multiplier
        / p.budget_divisor::numeric
      )::bigint
    end
      as retention_limit
  from prepared p
)
select
  l.settlement_session_id::uuid
    as settlement_session_id,
  l.business_date::date
    as business_date,
  l.line_group_id::text
    as line_group_id,
  l.line_group_name::text
    as line_group_name,
  l.summary_group_id::text
    as summary_group_id,
  l.reduction_pct::numeric(7,3)
    as reduction_pct,
  l.enabled::boolean
    as enabled,
  l.gross_received::bigint
    as gross_received,
  l.calculation_band::bigint
    as calculation_band,
  l.risk_budget_pct::numeric(7,3)
    as risk_budget_pct,
  l.risk_budget::numeric(18,2)
    as risk_budget,
  l.calculation_status::text
    as calculation_status,
  l.category::text
    as category,
  l.code::text
    as code,
  l.order_total::bigint
    as order_total,
  l.special_multiplier::numeric(12,3)
    as special_multiplier,
  l.max_special_codes::integer
    as max_special_codes,
  l.multiplier_configured::boolean
    as multiplier_configured,
  l.promotion_factor_pct::numeric(7,3)
    as promotion_factor_pct,
  l.effective_multiplier::numeric(12,3)
    as effective_multiplier,
  l.budget_divisor::integer
    as budget_divisor,
  l.retention_limit::bigint
    as retention_limit,
  case
    when not l.enabled
      then 0::bigint
    when l.calculation_status <> 'READY'
      then 0::bigint
    when not l.multiplier_configured
      then 0::bigint
    when coalesce(
      l.effective_multiplier,
      0::numeric
    ) <= 0::numeric
      then 0::bigint
    when l.confirmed_cut_exceeds_order_total
      then 0::bigint
    else greatest(
      0::bigint,
      l.retained_quantity
      - l.retention_limit
    )
  end::bigint
    as recommended_cut,
  case
    when not l.enabled
      then l.retained_quantity
    when l.calculation_status <> 'READY'
      then l.retained_quantity
    when not l.multiplier_configured
      then l.retained_quantity
    when coalesce(
      l.effective_multiplier,
      0::numeric
    ) <= 0::numeric
      then l.retained_quantity
    when l.confirmed_cut_exceeds_order_total
      then l.retained_quantity
    else least(
      l.retained_quantity,
      l.retention_limit
    )
  end::bigint
    as projected_retained,
  case
    when not l.enabled
      then null::numeric
    when l.calculation_status <> 'READY'
      then null::numeric
    when not l.multiplier_configured
      then null::numeric
    when coalesce(
      l.effective_multiplier,
      0::numeric
    ) <= 0::numeric
      then null::numeric
    when l.confirmed_cut_exceeds_order_total
      then null::numeric
    else round(
      least(
        l.retained_quantity,
        l.retention_limit
      )::numeric
      * l.effective_multiplier,
      2
    )
  end::numeric(18,2)
    as projected_point_exposure,
  case
    when not l.enabled
      then 0::numeric
    when l.calculation_status <> 'READY'
      then 0::numeric
    when not l.multiplier_configured
      then 0::numeric
    when coalesce(
      l.effective_multiplier,
      0::numeric
    ) <= 0::numeric
      then 0::numeric
    when l.confirmed_cut_exceeds_order_total
      then 0::numeric
    else round(
      greatest(
        0::bigint,
        l.retained_quantity
        - l.retention_limit
      )::numeric
      * l.effective_multiplier,
      2
    )
  end::numeric(18,2)
    as recommended_point_reduction,
  case
    when not l.enabled
      then 'DISABLED'::text
    when l.confirmed_cut_exceeds_order_total
      then 'DATA_INTEGRITY_ERROR'::text
    when l.calculation_status <> 'READY'
      then 'WAITING_FIRST_BAND'::text
    when not l.multiplier_configured
      or coalesce(
        l.effective_multiplier,
        0::numeric
      ) <= 0::numeric
      then 'UNCONFIGURED'::text
    when l.retained_quantity >
         l.retention_limit
      then 'CUT_REQUIRED'::text
    else 'SAFE'::text
  end
    as retention_status,
  l.confirmed_cut::bigint
    as confirmed_cut,
  l.retained_quantity::bigint
    as retained_quantity,
  l.confirmed_cut_exceeds_order_total::boolean
    as confirmed_cut_exceeds_order_total,
  l.confirmed_batch_count::integer
    as confirmed_batch_count,
  l.last_confirmed_at::timestamptz
    as last_confirmed_at
from limits l
) __retention
where
  __retention.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __retention.summary_group_id =
       p_summary_group_id
  )
),

risk_band as materialized (
select *
from (
with totals as (
  select
    cfg.settlement_session_id,
    s.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    cfg.reduction_pct,
    cfg.enabled,
    coalesce(sum(oi.quantity), 0)::bigint as gross_received
  from public.settlement_line_group_config cfg
  join public.settlement_sessions s
    on s.id = cfg.settlement_session_id
  left join public.order_items oi
    on oi.settlement_session_id = cfg.settlement_session_id
   and oi.line_group_id = cfg.line_group_id
  group by
    cfg.settlement_session_id,
    s.business_date,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.summary_group_id,
    cfg.reduction_pct,
    cfg.enabled
),
banded as (
  select
    t.*,
    (
      floor(t.gross_received::numeric / 100000)
      * 100000
    )::bigint as calculation_band
  from totals t
)
select
  b.settlement_session_id,
  b.business_date,
  b.line_group_id,
  b.line_group_name,
  b.summary_group_id,
  b.reduction_pct,
  b.enabled,
  b.gross_received,
  b.calculation_band,

  round(
    b.calculation_band::numeric
    * (100 - b.reduction_pct)
    / 100.0,
    2
  )::numeric(18,2) as risk_budget,

  round(
    100 - b.reduction_pct,
    3
  )::numeric(7,3) as risk_budget_pct,

  case
    when b.calculation_band = 0
      then 'WAITING_FIRST_BAND'
    else 'READY'
  end::text as calculation_status,

  (
    case
      when b.calculation_band = 0
        then 100000 - b.gross_received
      else b.calculation_band + 100000 - b.gross_received
    end
  )::bigint as amount_to_next_band

from banded b
) __band
where
  __band.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __band.summary_group_id =
       p_summary_group_id
  )
),

line_group_risk as materialized (
select *
from (
with retention as (
  select
    r.settlement_session_id,
    r.business_date,
    r.line_group_id,
    r.summary_group_id,

    bool_and(r.multiplier_configured)
      as multiplier_configured,

    count(*) filter (
      where r.retention_status = 'CUT_REQUIRED'
    )::integer as over_limit_code_count,

    coalesce(
      sum(r.recommended_cut),
      0
    )::bigint as recommended_cut_total,

    round(
      coalesce(sum(r.recommended_point_reduction),0),
      2
    )::numeric(18,2) as recommended_point_reduction,

    coalesce(sum(r.confirmed_cut),0)::bigint
      as confirmed_cut_total,

    coalesce(sum(r.retained_quantity),0)::bigint
      as retained_total,

    count(*) filter (
      where r.retention_status = 'DATA_INTEGRITY_ERROR'
    )::integer as over_cut_code_count

  from retention r
  group by
    r.settlement_session_id,
    r.business_date,
    r.line_group_id,
    r.summary_group_id
),
diagnostic as (
  select
    c.settlement_session_id,
    c.line_group_id,
    round(
      sum(
        case
          when c.reserve_candidate
            then coalesce(c.point_exposure,0)
          else 0
        end
      ),
      2
    )::numeric(18,2) as point_reserve_total
  from line_code_risk c
  group by
    c.settlement_session_id,
    c.line_group_id
)
select
  b.settlement_session_id,
  b.business_date,
  b.line_group_id,
  b.line_group_name,
  b.summary_group_id,
  b.reduction_pct,
  b.enabled,

  b.gross_received,
  b.calculation_band,
  b.risk_budget_pct,
  b.risk_budget,
  b.amount_to_next_band,
  b.calculation_status,

  coalesce(r.multiplier_configured,true)
    as multiplier_configured,

  coalesce(d.point_reserve_total,0)::numeric(18,2)
    as point_reserve_total,

  (
    b.enabled
    and b.calculation_status = 'READY'
    and coalesce(r.multiplier_configured,true)
    and coalesce(r.over_cut_code_count,0) = 0
  ) as risk_calculation_ready,

  case
    when not b.enabled
      then 'DISABLED'
    when coalesce(r.over_cut_code_count,0) > 0
      then 'DATA_INTEGRITY_ERROR'
    when b.gross_received > 0
      and not coalesce(r.multiplier_configured,true)
      then 'UNCONFIGURED'
    when b.calculation_status <> 'READY'
      then 'WAITING_FIRST_BAND'
    when coalesce(r.recommended_cut_total,0) > 0
      then 'CUT_REQUIRED'
    else 'SAFE'
  end::text as risk_status,

  case
    when not b.enabled then null::numeric
    when coalesce(r.over_cut_code_count,0) > 0 then null::numeric
    when b.calculation_status <> 'READY' then null::numeric
    when not coalesce(r.multiplier_configured,true) then null::numeric
    else coalesce(r.recommended_point_reduction,0)
  end::numeric(18,2) as excess_point_risk,

  (
    b.enabled
    and b.calculation_status = 'READY'
    and coalesce(r.multiplier_configured,true)
    and coalesce(r.over_cut_code_count,0) = 0
    and coalesce(r.recommended_cut_total,0) > 0
  ) as cut_required,

  'CATEGORY_RETENTION'::text as risk_model,

  coalesce(r.over_limit_code_count,0)::integer
    as over_limit_code_count,

  coalesce(r.recommended_cut_total,0)::bigint
    as recommended_cut_total,

  case
    when not b.enabled then null::numeric
    when coalesce(r.over_cut_code_count,0) > 0 then null::numeric
    when b.calculation_status <> 'READY' then null::numeric
    when not coalesce(r.multiplier_configured,true) then null::numeric
    else coalesce(r.recommended_point_reduction,0)
  end::numeric(18,2) as recommended_point_reduction,

  coalesce(r.confirmed_cut_total,0)::bigint
    as confirmed_cut_total,

  coalesce(r.retained_total,0)::bigint
    as retained_total,

  coalesce(r.over_cut_code_count,0)::integer
    as over_cut_code_count

from risk_band b
left join retention r
  on r.settlement_session_id = b.settlement_session_id
 and r.line_group_id = b.line_group_id
left join diagnostic d
  on d.settlement_session_id = b.settlement_session_id
 and d.line_group_id = b.line_group_id
) __line_risk
where
  __line_risk.settlement_session_id =
    p_settlement_session_id
  and (
    p_summary_group_id is null
    or __line_risk.summary_group_id =
       p_summary_group_id
  )
),

risk_codes_projected as (
  select
    settlement_session_id,
    business_date,
    summary_group_id,
    category,
    code,
    order_total,
    adjusted_total,
    special_multiplier,
    max_special_codes,
    promotion_factor_pct,
    effective_multiplier,
    point_exposure,
    reserve_rank,
    reserve_candidate,
    actual_special_point,
    actual_point,
    confirmed_cut,
    available_to_cut,
    retained_quantity,
    retained_point_exposure
  from code_risk
),

category_risk_projected as (
  select
    settlement_session_id,
    business_date,
    summary_group_id,
    category,
    special_multiplier,
    max_special_codes,
    actual_selected_count,
    order_total,
    adjusted_total,
    point_reserve,
    actual_point,
    reserve_safe_capacity,
    reserve_risk_pct
  from category_risk
),

overall_risk_projected as (
  select
    settlement_session_id,
    business_date,
    summary_group_id,
    gross_received,
    adjusted_received,
    point_reserve_total,
    actual_point_total,
    actual_codes_ready,
    risk_mode,
    risk_point_total,
    net_safe_capacity,
    confirmed_cut_total,
    remaining_safe_capacity,
    over_safe_amount,
    risk_pct,
    safety_margin,
    safety_margin_pct,
    point_loss_tolerance,
    risk_budget,
    risk_budget_margin,
    excess_point_risk
  from overall_risk
),

risk_pools_projected as (
  select
    settlement_session_id,
    business_date,
    summary_group_id,
    risk_pool,
    gross_received,
    adjusted_received,
    point_reserve_total,
    actual_point_total,
    multiplier_configured,
    actual_codes_ready,
    risk_mode,
    risk_point_total,
    safety_margin,
    confirmed_cut_total,
    point_loss_tolerance,
    risk_pct,
    risk_budget,
    excess_point_risk,
    risk_budget_margin
  from risk_pool
),

line_group_risk_projected as (
  select
    settlement_session_id,
    business_date,
    line_group_id,
    line_group_name,
    summary_group_id,
    reduction_pct,
    enabled,
    gross_received,
    calculation_band,
    risk_budget_pct,
    risk_budget,
    amount_to_next_band,
    calculation_status,
    multiplier_configured,
    risk_calculation_ready,
    risk_status,
    cut_required,
    risk_model,
    over_limit_code_count,
    recommended_cut_total,
    recommended_point_reduction,
    confirmed_cut_total,
    retained_total,
    over_cut_code_count
  from line_group_risk
),

line_group_risk_codes_projected as (
  select
    settlement_session_id,
    line_group_id,
    summary_group_id,
    category,
    code,
    order_total,
    confirmed_cut,
    retained_quantity,
    effective_multiplier,
    retention_limit,
    recommended_cut,
    projected_retained,
    recommended_point_reduction,
    retention_status,
    confirmed_cut_exceeds_order_total
  from retention
)

select jsonb_build_object(

  'risk_codes',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id,
          r.category,
          r.order_total desc,
          r.code
      )
      from risk_codes_projected r
    ),
    '[]'::jsonb
  ),

  'category_risk',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id,
          r.category
      )
      from category_risk_projected r
    ),
    '[]'::jsonb
  ),

  'overall_risk',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id
      )
      from overall_risk_projected r
    ),
    '[]'::jsonb
  ),

  'risk_pools',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id,
          r.risk_pool
      )
      from risk_pools_projected r
    ),
    '[]'::jsonb
  ),

  'line_group_risk',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id,
          coalesce(
            r.line_group_name,
            r.line_group_id
          ),
          r.line_group_id
      )
      from line_group_risk_projected r
    ),
    '[]'::jsonb
  ),

  'line_group_risk_codes',
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(r)
        order by
          r.summary_group_id,
          r.line_group_id,
          r.category,
          r.order_total desc,
          r.code
      )
      from line_group_risk_codes_projected r
    ),
    '[]'::jsonb
  )

);

$function$;

revoke all
on function public.dashboard_risk_snapshot(uuid,text)
from public, anon, authenticated;

grant execute
on function public.dashboard_risk_snapshot(uuid,text)
to service_role;

comment on function
  public.dashboard_risk_snapshot(uuid,text)
is
  'Dashboard-only Round-scoped risk snapshot. '
  'Shares one canonical computation per request to avoid '
  'concurrent duplicate expansion of risk/retention views.';
