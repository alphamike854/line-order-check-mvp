-- v9.20A2c
-- Risk Pool Actual Point readiness must be independent.
--
-- MAIN = A/B/E/F/G
-- H    = H only
-- L    = L only
--
-- A missing H Point must not make MAIN unready.
-- Empty pools remain ready.

begin;

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
  from public.session_category_risk_state c
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
from final f;

commit;
