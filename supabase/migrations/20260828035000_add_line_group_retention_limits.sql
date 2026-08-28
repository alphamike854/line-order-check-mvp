-- v8.9.3 Phase 1E
-- Correct LINE Group risk interpretation from one combined Point budget
-- to category-specific retention limits.
--
-- This remains a READ-ONLY recommendation model.
-- It does not modify distribution confirmation, transfer batches,
-- settlement history, or canonical order_items.
--
-- Category policy:
--
--   A: Risk Budget / effective multiplier / 2
--   B: Risk Budget / effective multiplier / 2
--   E: Risk Budget / effective multiplier / max_special_codes (=1)
--   F: Risk Budget / effective multiplier / max_special_codes (=6)
--   G: Risk Budget / effective multiplier / max_special_codes (=4)
--   H: Risk Budget / effective multiplier / max_special_codes (=3)
--   L: Risk Budget / effective multiplier / max_special_codes (=2)
--
-- Retention limits are floored to whole quantity units.
--
-- Promotions remain part of risk calculation through effective_multiplier.
--
-- WAITING_FIRST_BAND / UNCONFIGURED / DISABLED never authorize a cut.

create or replace view public.session_line_group_code_retention_state as
select
  c.settlement_session_id,
  c.business_date,
  c.line_group_id,
  c.line_group_name,
  c.summary_group_id,

  b.reduction_pct,
  b.enabled,
  b.gross_received,
  b.calculation_band,
  b.risk_budget_pct,
  b.risk_budget,
  b.calculation_status,

  c.category,
  c.code,
  c.order_total,

  c.special_multiplier,
  c.max_special_codes,
  c.multiplier_configured,
  c.promotion_factor_pct,
  c.effective_multiplier,

  case
    when c.category in ('A','B')
      then 2
    else c.max_special_codes
  end::integer as budget_divisor,

  case
    when not b.enabled
      then null::bigint

    when b.calculation_status <> 'READY'
      then null::bigint

    when not c.multiplier_configured
      then null::bigint

    when coalesce(c.effective_multiplier,0) <= 0
      then null::bigint

    else floor(
      b.risk_budget
      / c.effective_multiplier
      / case
          when c.category in ('A','B')
            then 2
          else c.max_special_codes
        end
    )::bigint
  end as retention_limit,

  case
    when not b.enabled
      then 0::bigint

    when b.calculation_status <> 'READY'
      then 0::bigint

    when not c.multiplier_configured
      then 0::bigint

    when coalesce(c.effective_multiplier,0) <= 0
      then 0::bigint

    else greatest(
      0,
      c.order_total
      - floor(
          b.risk_budget
          / c.effective_multiplier
          / case
              when c.category in ('A','B')
                then 2
              else c.max_special_codes
            end
        )::bigint
    )
  end::bigint as recommended_cut,

  case
    when not b.enabled
      then c.order_total

    when b.calculation_status <> 'READY'
      then c.order_total

    when not c.multiplier_configured
      then c.order_total

    when coalesce(c.effective_multiplier,0) <= 0
      then c.order_total

    else least(
      c.order_total,
      floor(
        b.risk_budget
        / c.effective_multiplier
        / case
            when c.category in ('A','B')
              then 2
            else c.max_special_codes
          end
      )::bigint
    )
  end::bigint as projected_retained,

  case
    when not b.enabled
      then null::numeric

    when b.calculation_status <> 'READY'
      then null::numeric

    when not c.multiplier_configured
      then null::numeric

    when coalesce(c.effective_multiplier,0) <= 0
      then null::numeric

    else round(
      least(
        c.order_total,
        floor(
          b.risk_budget
          / c.effective_multiplier
          / case
              when c.category in ('A','B')
                then 2
              else c.max_special_codes
            end
        )::bigint
      )::numeric
      * c.effective_multiplier,
      2
    )
  end::numeric(18,2) as projected_point_exposure,

  case
    when not b.enabled
      then 0::numeric

    when b.calculation_status <> 'READY'
      then 0::numeric

    when not c.multiplier_configured
      then 0::numeric

    when coalesce(c.effective_multiplier,0) <= 0
      then 0::numeric

    else round(
      greatest(
        0,
        c.order_total
        - floor(
            b.risk_budget
            / c.effective_multiplier
            / case
                when c.category in ('A','B')
                  then 2
                else c.max_special_codes
              end
          )::bigint
      )::numeric
      * c.effective_multiplier,
      2
    )
  end::numeric(18,2) as recommended_point_reduction,

  case
    when not b.enabled
      then 'DISABLED'

    when b.calculation_status <> 'READY'
      then 'WAITING_FIRST_BAND'

    when not c.multiplier_configured
      or coalesce(c.effective_multiplier,0) <= 0
      then 'UNCONFIGURED'

    when c.order_total >
      floor(
        b.risk_budget
        / c.effective_multiplier
        / case
            when c.category in ('A','B')
              then 2
            else c.max_special_codes
          end
      )::bigint
      then 'CUT_REQUIRED'

    else 'SAFE'
  end::text as retention_status

from public.session_line_group_code_risk_state c

join public.session_line_group_risk_band_state b
  on b.settlement_session_id = c.settlement_session_id
 and b.line_group_id = c.line_group_id;


create or replace view public.session_line_group_category_retention_state as
select
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,

  max(r.reduction_pct)
    as reduction_pct,

  bool_and(r.enabled)
    as enabled,

  max(r.gross_received)
    as gross_received,

  max(r.calculation_band)
    as calculation_band,

  max(r.risk_budget_pct)
    as risk_budget_pct,

  max(r.risk_budget)
    as risk_budget,

  r.category,

  bool_and(r.multiplier_configured)
    as multiplier_configured,

  max(r.special_multiplier)
    as special_multiplier,

  max(r.max_special_codes)
    as max_special_codes,

  max(r.budget_divisor)
    as budget_divisor,

  sum(r.order_total)::bigint
    as order_total,

  min(r.retention_limit)
    as minimum_retention_limit,

  max(r.retention_limit)
    as maximum_retention_limit,

  count(*) filter (
    where r.retention_status = 'CUT_REQUIRED'
  )::integer
    as over_limit_code_count,

  sum(r.recommended_cut)::bigint
    as recommended_cut_total,

  round(
    sum(r.recommended_point_reduction),
    2
  )::numeric(18,2)
    as recommended_point_reduction

from public.session_line_group_code_retention_state r

group by
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,
  r.category;


-- Replace only the new v8.9.3 read-only LINE Group summary view.
-- Existing Summary Group risk views remain untouched.
create or replace view public.session_line_group_risk_state as
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
    )::integer
      as over_limit_code_count,

    coalesce(
      sum(r.recommended_cut),
      0
    )::bigint
      as recommended_cut_total,

    round(
      coalesce(
        sum(r.recommended_point_reduction),
        0
      ),
      2
    )::numeric(18,2)
      as recommended_point_reduction

  from public.session_line_group_code_retention_state r

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
    )::numeric(18,2)
      as point_reserve_total

  from public.session_line_group_code_risk_state c

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

  coalesce(
    r.multiplier_configured,
    true
  ) as multiplier_configured,

  coalesce(
    d.point_reserve_total,
    0
  )::numeric(18,2)
    as point_reserve_total,

  (
    b.enabled
    and b.calculation_status = 'READY'
    and coalesce(r.multiplier_configured,true)
  ) as risk_calculation_ready,

  case
    when not b.enabled
      then 'DISABLED'

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
    when not b.enabled
      then null::numeric

    when b.calculation_status <> 'READY'
      then null::numeric

    when not coalesce(r.multiplier_configured,true)
      then null::numeric

    else coalesce(
      r.recommended_point_reduction,
      0
    )
  end::numeric(18,2)
    as excess_point_risk,

  (
    b.enabled
    and b.calculation_status = 'READY'
    and coalesce(r.multiplier_configured,true)
    and coalesce(r.recommended_cut_total,0) > 0
  ) as cut_required,

  'CATEGORY_RETENTION'::text
    as risk_model,

  coalesce(
    r.over_limit_code_count,
    0
  )::integer
    as over_limit_code_count,

  coalesce(
    r.recommended_cut_total,
    0
  )::bigint
    as recommended_cut_total,

  case
    when not b.enabled
      then null::numeric

    when b.calculation_status <> 'READY'
      then null::numeric

    when not coalesce(r.multiplier_configured,true)
      then null::numeric

    else coalesce(
      r.recommended_point_reduction,
      0
    )
  end::numeric(18,2)
    as recommended_point_reduction

from public.session_line_group_risk_band_state b

left join retention r
  on r.settlement_session_id = b.settlement_session_id
 and r.line_group_id = b.line_group_id

left join diagnostic d
  on d.settlement_session_id = b.settlement_session_id
 and d.line_group_id = b.line_group_id;


revoke all
on public.session_line_group_code_retention_state
from public, anon, authenticated;

revoke all
on public.session_line_group_category_retention_state
from public, anon, authenticated;

revoke all
on public.session_line_group_risk_state
from public, anon, authenticated;


grant select
on public.session_line_group_code_retention_state
to service_role;

grant select
on public.session_line_group_category_retention_state
to service_role;

grant select
on public.session_line_group_risk_state
to service_role;
