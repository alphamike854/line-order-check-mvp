create or replace view public.session_line_group_code_risk_state as
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
from public.session_round_line_group_code_risk_shadow;

create or replace view public.session_code_risk_state as
select
  settlement_session_id,
  business_date,
  summary_group_id,
  category,
  code,
  order_total,
  adjusted_total,
  special_multiplier::numeric(12,3)
    as special_multiplier,
  max_special_codes,
  promotion_factor_pct,
  effective_multiplier::numeric
    as effective_multiplier,
  point_exposure::numeric
    as point_exposure,
  actual_special_point,
  reserve_rank,
  reserve_candidate,
  actual_point::numeric
    as actual_point,
  confirmed_cut,
  available_to_cut,
  retained_quantity,
  retained_point_exposure::numeric
    as retained_point_exposure
from public.session_round_code_risk_shadow;

create or replace view public.session_category_risk_state as
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
from public.session_round_category_risk_shadow;
