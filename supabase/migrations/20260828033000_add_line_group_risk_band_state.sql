-- v8.9.3 Phase 1
-- Read-only LINE Group Risk Band foundation.
--
-- Risk is calculated independently for each LINE group.
-- The calculation base advances only in 100,000-unit bands.
--
--   calculation_band
--     = floor(gross_received / 100000) * 100000
--
--   risk_budget
--     = calculation_band * (100 - reduction_pct) / 100
--
-- A group below the first 100,000 band is WAITING_FIRST_BAND and
-- must not authorize an automatic risk cut.
--
-- This phase deliberately does not change transfer confirmation.
-- Existing transfer records do not yet attribute cuts to line_group_id.

create or replace view public.session_line_group_risk_band_state as
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

from banded b;

revoke all
on public.session_line_group_risk_band_state
from public, anon, authenticated;

grant select
on public.session_line_group_risk_band_state
to service_role;
