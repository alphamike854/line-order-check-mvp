-- v8.9.3 Phase 1D
-- Read-only Point exposure state calculated independently per LINE group.
--
-- This migration deliberately does NOT change:
--   - settlement transfer confirmation
--   - distribution runs
--   - transfer batches
--   - legacy Summary Group risk views
--
-- Confirmed cuts are intentionally not subtracted here yet because legacy
-- transfer items do not attribute a cut to line_group_id.
--
-- Worst-case Point exposure per category:
--   A = highest 1 code
--   B = highest 1 code
--   E = highest 1 code
--   F = highest 6 codes
--   G = highest 4 codes
--   H = highest 3 codes
--   L = highest 2 codes
--
-- Multipliers and max code counts come from settlement_point_profiles,
-- never from application fallback values.

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


create or replace view public.session_line_group_category_risk_state as
select
  c.settlement_session_id,
  c.business_date,
  c.line_group_id,
  c.line_group_name,
  c.summary_group_id,
  c.category,

  bool_and(c.multiplier_configured)
    as multiplier_configured,

  max(c.special_multiplier)
    as special_multiplier,

  max(c.max_special_codes)
    as max_special_codes,

  sum(c.order_total)::bigint
    as order_total,

  count(*) filter (
    where c.reserve_candidate
  )::integer
    as reserve_selected_count,

  round(
    sum(
      case
        when c.reserve_candidate
          then coalesce(c.point_exposure, 0)
        else 0
      end
    ),
    2
  )::numeric(18,2)
    as point_reserve

from public.session_line_group_code_risk_state c

group by
  c.settlement_session_id,
  c.business_date,
  c.line_group_id,
  c.line_group_name,
  c.summary_group_id,
  c.category;


create or replace view public.session_line_group_risk_state as
with category_totals as (
  select
    c.settlement_session_id,
    c.business_date,
    c.line_group_id,
    c.summary_group_id,

    bool_and(c.multiplier_configured)
      as multiplier_configured,

    round(
      sum(c.point_reserve),
      2
    )::numeric(18,2)
      as point_reserve_total

  from public.session_line_group_category_risk_state c

  group by
    c.settlement_session_id,
    c.business_date,
    c.line_group_id,
    c.summary_group_id
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

  coalesce(
    ct.multiplier_configured,
    true
  ) as multiplier_configured,

  coalesce(
    ct.point_reserve_total,
    0
  )::numeric(18,2)
    as point_reserve_total,

  (
    b.calculation_status = 'READY'
    and coalesce(ct.multiplier_configured, true)
  ) as risk_calculation_ready,

  case
    when b.gross_received > 0
     and not coalesce(ct.multiplier_configured, true)
      then 'UNCONFIGURED'

    when b.calculation_status <> 'READY'
      then 'WAITING_FIRST_BAND'

    when coalesce(ct.point_reserve_total, 0) > b.risk_budget
      then 'CUT_REQUIRED'

    else 'SAFE'
  end::text
    as risk_status,

  case
    when b.calculation_status <> 'READY'
      then null::numeric

    when not coalesce(ct.multiplier_configured, true)
      then null::numeric

    else greatest(
      0,
      round(
        coalesce(ct.point_reserve_total, 0)
        - b.risk_budget,
        2
      )
    )
  end::numeric(18,2)
    as excess_point_risk,

  (
    b.calculation_status = 'READY'
    and coalesce(ct.multiplier_configured, true)
    and coalesce(ct.point_reserve_total, 0) > b.risk_budget
  ) as cut_required

from public.session_line_group_risk_band_state b

left join category_totals ct
  on ct.settlement_session_id = b.settlement_session_id
 and ct.line_group_id = b.line_group_id;


revoke all
on public.session_line_group_code_risk_state
from public, anon, authenticated;

revoke all
on public.session_line_group_category_risk_state
from public, anon, authenticated;

revoke all
on public.session_line_group_risk_state
from public, anon, authenticated;


grant select
on public.session_line_group_code_risk_state
to service_role;

grant select
on public.session_line_group_category_risk_state
to service_role;

grant select
on public.session_line_group_risk_state
to service_role;
