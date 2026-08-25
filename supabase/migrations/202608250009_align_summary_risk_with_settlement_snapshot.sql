-- Dashboard v6.1: keep Summary / Risk views aligned with the settlement snapshot.
-- Accounting reports already resolve Summary Group through settlement_line_group_config.
-- Risk views previously trusted order_items.summary_group_id directly, which could diverge
-- from the frozen settlement mapping. The settlement snapshot is now the source of truth.

-- Repair already-recorded session-scoped rows first.
update public.order_items oi
set summary_group_id = cfg.summary_group_id
from public.settlement_line_group_config cfg
where oi.settlement_session_id is not null
  and cfg.settlement_session_id = oi.settlement_session_id
  and cfg.line_group_id = oi.line_group_id
  and oi.summary_group_id is distinct from cfg.summary_group_id;

-- Risk state must derive Summary Group from the same frozen config used by the daily report.
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
), enriched as (
  select
    cb.*,
    pp.special_multiplier,
    pp.max_special_codes,
    coalesce(pm.point_factor_pct,100)::numeric(7,3) as promotion_factor_pct,
    round(pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,3) as effective_multiplier,
    round(cb.order_total::numeric * pp.special_multiplier * coalesce(pm.point_factor_pct,100) / 100.0,2) as point_exposure,
    (sp.code is not null) as actual_special_point
  from code_base cb
  join public.settlement_point_profiles pp
    on pp.settlement_session_id=cb.settlement_session_id and pp.category=cb.category
  left join public.settlement_point_promotions pm
    on pm.settlement_session_id=cb.settlement_session_id and pm.category=cb.category and pm.code=cb.code
  left join public.settlement_actual_special_point_codes sp
    on sp.settlement_session_id=cb.settlement_session_id and sp.category=cb.category and sp.code=cb.code
), ranked as (
  select
    e.*,
    row_number() over(
      partition by e.settlement_session_id,e.summary_group_id,e.category
      order by e.point_exposure desc,e.order_total desc,e.code asc
    ) as reserve_rank
  from enriched e
), code_cuts as (
  select
    b.settlement_session_id,b.summary_group_id,i.category,i.code,
    sum(i.quantity)::bigint as confirmed_cut
  from public.settlement_transfer_batches b
  join public.settlement_transfer_batch_items i on i.batch_id=b.id
  group by b.settlement_session_id,b.summary_group_id,i.category,i.code
)
select
  r.*,
  (r.reserve_rank <= r.max_special_codes) as reserve_candidate,
  case when r.actual_special_point then r.point_exposure else 0::numeric end as actual_point,
  coalesce(cc.confirmed_cut,0)::bigint as confirmed_cut,
  greatest(0,r.order_total-coalesce(cc.confirmed_cut,0))::bigint as available_to_cut
from ranked r
left join code_cuts cc
  on cc.settlement_session_id=r.settlement_session_id
 and cc.summary_group_id=r.summary_group_id
 and cc.category=r.category
 and cc.code=r.code;

revoke all on public.session_code_risk_state from anon,authenticated;
