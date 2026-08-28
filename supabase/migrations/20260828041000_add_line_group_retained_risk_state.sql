-- v8.9.4 Phase 2B
-- LINE Group retained state after attributed CATEGORY_RETENTION transfers.
-- Read-only only: no legacy attribution, no data mutation.

create or replace view public.session_line_group_confirmed_cut_state as
select
  b.settlement_session_id,
  b.business_date,
  i.line_group_id,
  i.category,
  i.code,
  sum(i.quantity)::bigint as confirmed_cut,
  count(distinct b.id)::integer as confirmed_batch_count,
  max(b.confirmed_at) as last_confirmed_at
from public.settlement_transfer_batches b
join public.settlement_transfer_batch_items i
  on i.batch_id = b.id
where b.line_group_id is not null
  and i.line_group_id is not null
  and i.line_group_id = b.line_group_id
  and b.risk_model = 'CATEGORY_RETENTION'
group by
  b.settlement_session_id,
  b.business_date,
  i.line_group_id,
  i.category,
  i.code;


create or replace view public.session_line_group_code_retention_state as
with prepared as (
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
      when c.category in ('A','B') then 2
      else c.max_special_codes
    end::integer as budget_divisor,

    coalesce(x.confirmed_cut,0)::bigint as confirmed_cut,

    greatest(
      c.order_total - coalesce(x.confirmed_cut,0),
      0
    )::bigint as retained_quantity,

    (
      coalesce(x.confirmed_cut,0) > c.order_total
    ) as confirmed_cut_exceeds_order_total,

    coalesce(x.confirmed_batch_count,0)::integer
      as confirmed_batch_count,

    x.last_confirmed_at

  from public.session_line_group_code_risk_state c

  join public.session_line_group_risk_band_state b
    on b.settlement_session_id = c.settlement_session_id
   and b.line_group_id = c.line_group_id

  left join public.session_line_group_confirmed_cut_state x
    on x.settlement_session_id = c.settlement_session_id
   and x.line_group_id = c.line_group_id
   and x.category = c.category
   and x.code = c.code
),
limits as (
  select
    p.*,
    case
      when not p.enabled then null::bigint
      when p.calculation_status <> 'READY' then null::bigint
      when not p.multiplier_configured then null::bigint
      when coalesce(p.effective_multiplier,0) <= 0 then null::bigint
      else floor(
        p.risk_budget
        / p.effective_multiplier
        / p.budget_divisor
      )::bigint
    end as retention_limit
  from prepared p
)
select
  l.settlement_session_id,
  l.business_date,
  l.line_group_id,
  l.line_group_name,
  l.summary_group_id,

  l.reduction_pct,
  l.enabled,
  l.gross_received,
  l.calculation_band,
  l.risk_budget_pct,
  l.risk_budget,
  l.calculation_status,

  l.category,
  l.code,
  l.order_total,

  l.special_multiplier,
  l.max_special_codes,
  l.multiplier_configured,
  l.promotion_factor_pct,
  l.effective_multiplier,

  l.budget_divisor,
  l.retention_limit,

  case
    when not l.enabled then 0::bigint
    when l.calculation_status <> 'READY' then 0::bigint
    when not l.multiplier_configured then 0::bigint
    when coalesce(l.effective_multiplier,0) <= 0 then 0::bigint
    when l.confirmed_cut_exceeds_order_total then 0::bigint
    else greatest(
      0,
      l.retained_quantity - l.retention_limit
    )
  end::bigint as recommended_cut,

  case
    when not l.enabled then l.retained_quantity
    when l.calculation_status <> 'READY' then l.retained_quantity
    when not l.multiplier_configured then l.retained_quantity
    when coalesce(l.effective_multiplier,0) <= 0 then l.retained_quantity
    when l.confirmed_cut_exceeds_order_total then l.retained_quantity
    else least(
      l.retained_quantity,
      l.retention_limit
    )
  end::bigint as projected_retained,

  case
    when not l.enabled then null::numeric
    when l.calculation_status <> 'READY' then null::numeric
    when not l.multiplier_configured then null::numeric
    when coalesce(l.effective_multiplier,0) <= 0 then null::numeric
    when l.confirmed_cut_exceeds_order_total then null::numeric
    else round(
      least(
        l.retained_quantity,
        l.retention_limit
      )::numeric * l.effective_multiplier,
      2
    )
  end::numeric(18,2) as projected_point_exposure,

  case
    when not l.enabled then 0::numeric
    when l.calculation_status <> 'READY' then 0::numeric
    when not l.multiplier_configured then 0::numeric
    when coalesce(l.effective_multiplier,0) <= 0 then 0::numeric
    when l.confirmed_cut_exceeds_order_total then 0::numeric
    else round(
      greatest(
        0,
        l.retained_quantity - l.retention_limit
      )::numeric * l.effective_multiplier,
      2
    )
  end::numeric(18,2) as recommended_point_reduction,

  case
    when not l.enabled then 'DISABLED'
    when l.confirmed_cut_exceeds_order_total then 'DATA_INTEGRITY_ERROR'
    when l.calculation_status <> 'READY' then 'WAITING_FIRST_BAND'
    when not l.multiplier_configured
      or coalesce(l.effective_multiplier,0) <= 0
      then 'UNCONFIGURED'
    when l.retained_quantity > l.retention_limit
      then 'CUT_REQUIRED'
    else 'SAFE'
  end::text as retention_status,

  l.confirmed_cut,
  l.retained_quantity,
  l.confirmed_cut_exceeds_order_total,
  l.confirmed_batch_count,
  l.last_confirmed_at

from limits l;


create or replace view public.session_line_group_category_retention_state as
select
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,

  max(r.reduction_pct) as reduction_pct,
  bool_and(r.enabled) as enabled,
  max(r.gross_received) as gross_received,
  max(r.calculation_band) as calculation_band,
  max(r.risk_budget_pct) as risk_budget_pct,
  max(r.risk_budget) as risk_budget,

  r.category,

  bool_and(r.multiplier_configured) as multiplier_configured,
  max(r.special_multiplier) as special_multiplier,
  max(r.max_special_codes) as max_special_codes,
  max(r.budget_divisor) as budget_divisor,

  sum(r.order_total)::bigint as order_total,
  min(r.retention_limit) as minimum_retention_limit,
  max(r.retention_limit) as maximum_retention_limit,

  count(*) filter (
    where r.retention_status = 'CUT_REQUIRED'
  )::integer as over_limit_code_count,

  sum(r.recommended_cut)::bigint as recommended_cut_total,

  round(
    sum(r.recommended_point_reduction),
    2
  )::numeric(18,2) as recommended_point_reduction,

  sum(r.confirmed_cut)::bigint as confirmed_cut_total,
  sum(r.retained_quantity)::bigint as retained_total,

  count(*) filter (
    where r.retention_status = 'DATA_INTEGRITY_ERROR'
  )::integer as over_cut_code_count

from public.session_line_group_code_retention_state r
group by
  r.settlement_session_id,
  r.business_date,
  r.line_group_id,
  r.line_group_name,
  r.summary_group_id,
  r.category;


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
    )::numeric(18,2) as point_reserve_total
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

from public.session_line_group_risk_band_state b
left join retention r
  on r.settlement_session_id = b.settlement_session_id
 and r.line_group_id = b.line_group_id
left join diagnostic d
  on d.settlement_session_id = b.settlement_session_id
 and d.line_group_id = b.line_group_id;


revoke all
on public.session_line_group_confirmed_cut_state
from public, anon, authenticated;

grant select
on public.session_line_group_confirmed_cut_state
to service_role;

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
