-- Phase 2C1 hardening:
-- deterministic historical transfer-cut lineage recovery
--
-- Resolution priority:
--   1. item.line_group_id
--   2. batch.line_group_id
--   3. unique active-Round source LINE Group, only when
--      missing cut <= source quantity
--
-- Ambiguous/no-source historical lineage remains unresolved.
-- No historical business data is mutated.
-- Shadow-only; production views/API/parser remain untouched.
--

-- Phase 2C1 hardening: match production reserve-ranking precision
--
-- The first shadow migration intentionally kept raw exposure values so mixed
-- Promotion factors could be rolled up exactly. Production reserve ranking,
-- however, ranks by the already rounded 2-decimal Point exposure fields.
-- Ranking by raw values can reorder codes that differ only below 0.01.
--
-- Keep raw values for arithmetic, but use round(..., 2) only as the ranking
-- key so ALL-scope Promotion can remain production-parity compatible.
--
-- Shadow-only: no active API, Dashboard, Accounting, Risk, Allocation,
-- mutation RPC, canonical order or parser cutover.

begin;

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
missing_lineage_cut_totals as (
  select
    b.settlement_session_id,
    b.business_date,
    b.summary_group_id,
    i.category,
    i.code,
    sum(i.quantity)::bigint
      as missing_cut_quantity
  from
    public.settlement_transfer_batches b
  join
    public.settlement_transfer_batch_items i
    on i.batch_id = b.id
  where
    i.line_group_id is null
    and b.line_group_id is null
  group by
    b.settlement_session_id,
    b.business_date,
    b.summary_group_id,
    i.category,
    i.code
),

source_line_group_resolution as (
  select
    cb.settlement_session_id,
    cb.business_date,
    cb.summary_group_id,
    cb.category,
    cb.code,
    count(*)::integer
      as source_line_group_count,
    min(cb.line_group_id)
      as unique_line_group_id,
    sum(cb.order_total)::bigint
      as source_order_total
  from code_base cb
  group by
    cb.settlement_session_id,
    cb.business_date,
    cb.summary_group_id,
    cb.category,
    cb.code
),

resolved_line_cut_items as (
  select
    b.settlement_session_id,
    b.summary_group_id,
    i.category,
    i.code,
    i.quantity,
    case
      when i.line_group_id is not null
        then i.line_group_id
      when b.line_group_id is not null
        then b.line_group_id
      when
        sgr.source_line_group_count = 1
        and ml.missing_cut_quantity <= sgr.source_order_total
      then sgr.unique_line_group_id
      else null
    end as resolved_line_group_id
  from
    public.settlement_transfer_batches b
  join
    public.settlement_transfer_batch_items i
    on i.batch_id = b.id
  left join missing_lineage_cut_totals ml
    on ml.settlement_session_id = b.settlement_session_id
   and ml.business_date = b.business_date
   and ml.summary_group_id = b.summary_group_id
   and ml.category = i.category
   and ml.code = i.code
  left join source_line_group_resolution sgr
    on sgr.settlement_session_id = b.settlement_session_id
   and sgr.business_date = b.business_date
   and sgr.summary_group_id = b.summary_group_id
   and sgr.category = i.category
   and sgr.code = i.code
),

line_cuts as (
  select
    rlci.settlement_session_id,
    rlci.summary_group_id,
    rlci.resolved_line_group_id as line_group_id,
    rlci.category,
    rlci.code,
    sum(rlci.quantity)::bigint as confirmed_cut
  from resolved_line_cut_items rlci
  where rlci.resolved_line_group_id is not null
  group by
    rlci.settlement_session_id,
    rlci.summary_group_id,
    rlci.resolved_line_group_id,
    rlci.category,
    rlci.code
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
          round(
            c.point_exposure_raw,
            2
          ),
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
          round(
            e.retained_point_exposure_raw,
            2
          ),
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

commit;
