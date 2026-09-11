-- Dashboard performance blocker:
-- avoid repeated nested expansion of session_line_group_risk_band_state
-- inside the per-code retention model.
--
-- Business rules, output columns, typmods, ACL and downstream views
-- remain unchanged.
--
-- session_line_group_risk_band_state itself remains authoritative and
-- unchanged for the LINE-group summary model, including zero-order groups.
-- This optimization applies only to the per-code retention view, whose
-- canonical row base is session_line_group_code_risk_state.

create or replace view public.session_line_group_code_retention_state as
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
  from public.session_line_group_code_risk_state c
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
from limits l;

revoke all
on public.session_line_group_code_retention_state
from public, anon, authenticated;

grant select
on public.session_line_group_code_retention_state
to service_role;

comment on view public.session_line_group_code_retention_state
is
  'Per-code LINE-group retention risk state. Optimized to derive the LINE-group band from the canonical code-risk row set and avoid nested expansion of session_line_group_risk_band_state.';
