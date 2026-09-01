-- v9.20A2b
-- Cut active Risk read models over to Summary Group-scoped Actual Point.
--
-- Scope:
-- - session_code_risk_state
-- - session_category_risk_state
-- - session_risk_pool_state
--
-- Not changed:
-- - canonical orders
-- - transfer/cut history
-- - transfer confirmation RPCs
-- - session_line_group_code_risk_state ranking
-- - legacy Actual Point table
--
-- session_overall_risk_state already reads session_risk_pool_state,
-- therefore it inherits the new Summary Group readiness automatically.

begin;


-- =========================================================
-- Code Risk
--
-- A Point code is actual only inside its own Summary Group.
-- =========================================================

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
  left join public.settlement_summary_group_actual_special_point_codes sp
    on sp.settlement_session_id=cb.settlement_session_id
   and sp.summary_group_id=cb.summary_group_id
   and sp.category=cb.category
   and sp.code=cb.code
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


-- =========================================================
-- Category Risk
--
-- Actual Point selected count is also Summary Group-scoped.
-- =========================================================

create or replace view public.session_category_risk_state as
with actual_counts as (
  select
    settlement_session_id,
    summary_group_id,
    category,
    count(*)::integer as actual_selected_count
  from public.settlement_summary_group_actual_special_point_codes
  group by
    settlement_session_id,
    summary_group_id,
    category
)
select
  c.settlement_session_id,
  c.business_date,
  c.summary_group_id,
  c.category,
  max(c.special_multiplier) as special_multiplier,
  max(c.max_special_codes) as max_special_codes,
  coalesce(max(ac.actual_selected_count),0)::integer as actual_selected_count,
  sum(c.order_total)::bigint as order_total,
  round(sum(c.adjusted_total),2) as adjusted_total,
  round(sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end),2) as point_reserve,
  round(sum(c.actual_point),2) as actual_point,
  round(sum(c.adjusted_total)-sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end),2) as reserve_safe_capacity,
  case when sum(c.adjusted_total)>0
    then round(sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end)/sum(c.adjusted_total)*100,2)
    when sum(case when c.reserve_candidate then c.retained_point_exposure else 0 end)>0 then 100::numeric
    else 0::numeric end as reserve_risk_pct
from public.session_code_risk_state c
left join actual_counts ac
  on ac.settlement_session_id=c.settlement_session_id
 and ac.summary_group_id=c.summary_group_id
 and ac.category=c.category
group by c.settlement_session_id,c.business_date,c.summary_group_id,c.category;

-- Preserve every existing v6/v6.5 column in the same order/type, then append the
-- v6.6 Risk Budget fields. The v6.5 Risk->Cut% columns remain only for migration
-- compatibility and are neutralized; they no longer authorize transfers.


-- =========================================================
-- Risk Pool
--
-- Point readiness is evaluated independently by Summary Group.
-- =========================================================

create or replace view public.session_risk_pool_state as
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
  from public.session_category_risk_state c
  join public.category_definitions d on d.category=c.category and d.enabled=true
  group by c.settlement_session_id,c.business_date,c.summary_group_id,d.risk_pool
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
    coalesce(st.actual_codes_ready,false) as actual_codes_ready,
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
  left join public.session_summary_group_actual_point_status st
    on st.settlement_session_id=g.settlement_session_id
   and st.summary_group_id=g.summary_group_id
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
from final f;


commit;
