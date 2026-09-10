begin;

create or replace view
  public.settlement_summary_group_point_promotions_current
with (
  security_invoker = true
)
as
with ranked_rounds as (
  select
    r.*,
    row_number() over (
      partition by
        r.settlement_session_id,
        r.summary_group_id
      order by
        r.round_no desc
    ) as rn
  from public.settlement_summary_group_rounds r
  where r.status in (
    'OPEN',
    'CLOSED'
  )
),
current_rounds as (
  select r.*
  from ranked_rounds r
  where
    r.rn = 1
    and not exists (
      select 1
      from public.settlement_summary_group_round_snapshots s
      where s.round_id = r.id
    )
),
target_sets as (
  select
    t.promotion_id,
    jsonb_agg(
      t.line_group_id
      order by t.line_group_id
    ) as line_group_ids
  from
    public.settlement_round_point_promotion_line_groups t
  group by
    t.promotion_id
)
select
  r.settlement_session_id,
  r.summary_group_id,
  r.id as round_id,
  r.round_no,
  r.status as round_status,

  p.id as promotion_id,
  p.category,
  p.code,
  p.point_factor_pct,
  p.target_scope,

  coalesce(
    targets.line_group_ids,
    '[]'::jsonb
  ) as line_group_ids,

  p.updated_at,
  p.updated_by

from current_rounds r

join public.settlement_round_point_promotions p
  on p.round_id = r.id

left join target_sets targets
  on targets.promotion_id = p.id;

revoke all on
  public.settlement_summary_group_point_promotions_current
from
  public,
  anon,
  authenticated,
  service_role;

grant select on
  public.settlement_summary_group_point_promotions_current
to service_role;

commit;
