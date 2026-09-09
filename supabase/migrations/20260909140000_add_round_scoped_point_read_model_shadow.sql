-- Phase 2C1: Round-scoped Point/Risk shadow read model
--
-- Purpose:
-- - Prove Round-scoped Promotion / Actual Point semantics without cutting over
--   any active API, Dashboard, Accounting Report, Risk or Allocation consumer.
-- - Preserve LINE Group provenance until Promotion has been applied.
-- - Roll up to Summary Group only after the effective Promotion factor is known.
-- - Use the latest non-archived Round per Settlement + Summary Group.
-- - Preserve existing canonical orders, parser, mutation RPCs and production views.
--
-- These shadow views are intentionally service-role only.

begin;

-- ============================================================
-- 1. LINE Group / code Point state
-- ============================================================

create or replace view
  public.session_round_line_group_code_risk_shadow
as
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
line_cuts as (
  select
    b.settlement_session_id,
    b.summary_group_id,
    i.line_group_id,
    i.category,
    i.code,
    sum(i.quantity)::bigint
      as confirmed_cut
  from
    public.settlement_transfer_batches b
  join
    public.settlement_transfer_batch_items i
    on i.batch_id = b.id
  where
    i.line_group_id is not null
  group by
    b.settlement_session_id,
    b.summary_group_id,
    i.line_group_id,
    i.category,
    i.code
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
          c.point_exposure_raw,
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
from ranked r;

-- ============================================================
-- 2. Summary Group / code shadow
--
-- Promotion has already been applied at LINE Group level above.
-- Weighted Promotion factor is descriptive only; Point totals are
-- rolled up from raw LINE Group exposure, so SELECTED semantics
-- cannot be lost during Summary Group aggregation.
-- ============================================================

create or replace view
  public.session_round_code_risk_shadow
as
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
    public.session_round_line_group_code_risk_shadow lg
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
          e.retained_point_exposure_raw,
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
from ranked r;

-- ============================================================
-- 3. Category shadow
-- ============================================================

create or replace view
  public.session_round_category_risk_shadow
as
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
  public.session_round_code_risk_shadow c
left join actual_counts ac
  on ac.round_id = c.round_id
 and ac.category = c.category
group by
  c.round_id,
  c.settlement_session_id,
  c.business_date,
  c.summary_group_id,
  c.category;

-- ============================================================
-- 4. Security boundary
-- ============================================================

revoke all
on public.session_round_line_group_code_risk_shadow
from public, anon, authenticated;

grant select
on public.session_round_line_group_code_risk_shadow
to service_role;

revoke all
on public.session_round_code_risk_shadow
from public, anon, authenticated;

grant select
on public.session_round_code_risk_shadow
to service_role;

revoke all
on public.session_round_category_risk_shadow
from public, anon, authenticated;

grant select
on public.session_round_category_risk_shadow
to service_role;

commit;
