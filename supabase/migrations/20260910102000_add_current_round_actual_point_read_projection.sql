begin;

create or replace view
  public.settlement_summary_group_actual_special_point_codes_current
with (security_invoker = true)
as
with ranked_rounds as (
  select
    r.*,
    row_number() over (
      partition by
        r.settlement_session_id,
        r.summary_group_id
      order by r.round_no desc
    ) as latest_rank
  from public.settlement_summary_group_rounds r
  where r.status in ('OPEN', 'CLOSED')
),
current_rounds as (
  select r.*
  from ranked_rounds r
  where
    r.latest_rank = 1
    and not exists (
      select 1
      from public.settlement_summary_group_round_snapshots s
      where s.round_id = r.id
    )
)
select
  r.settlement_session_id,
  r.summary_group_id,
  r.id as round_id,
  r.round_no,
  r.status as round_status,
  a.category,
  a.code,
  a.created_at,
  a.updated_at,
  a.updated_by
from current_rounds r
join public.settlement_round_actual_special_point_codes a
  on a.round_id = r.id;

create or replace view
  public.session_summary_group_actual_point_status_current
with (security_invoker = true)
as
with ranked_rounds as (
  select
    r.*,
    row_number() over (
      partition by
        r.settlement_session_id,
        r.summary_group_id
      order by r.round_no desc
    ) as latest_rank
  from public.settlement_summary_group_rounds r
  where r.status in ('OPEN', 'CLOSED')
),
current_rounds as (
  select r.*
  from ranked_rounds r
  where
    r.latest_rank = 1
    and not exists (
      select 1
      from public.settlement_summary_group_round_snapshots s
      where s.round_id = r.id
    )
),
counts as (
  select
    r.settlement_session_id,
    r.summary_group_id,
    r.id as round_id,
    r.round_no,
    r.status as round_status,
    p.category,
    p.max_special_codes,
    exists (
      select 1
      from public.order_items oi
      where
        oi.settlement_session_id =
          r.settlement_session_id
        and oi.summary_group_round_id = r.id
        and oi.category = p.category
    ) as has_orders,
    count(a.code)::integer as selected_count
  from current_rounds r
  join public.settlement_point_profiles p
    on p.settlement_session_id =
       r.settlement_session_id
  left join
    public.settlement_round_actual_special_point_codes a
    on a.round_id = r.id
   and a.category = p.category
  group by
    r.settlement_session_id,
    r.summary_group_id,
    r.id,
    r.round_no,
    r.status,
    p.category,
    p.max_special_codes
)
select
  settlement_session_id,
  summary_group_id,
  round_id,
  round_no,
  round_status,
  bool_and(
    case
      when not has_orders then true
      when category in ('A', 'B', 'E')
        then selected_count = 1
      when category in ('G', 'H', 'L')
        then selected_count = max_special_codes
      when category = 'F'
        then selected_count
          between 0 and max_special_codes
      else false
    end
  ) as actual_codes_ready,
  jsonb_object_agg(
    category,
    jsonb_build_object(
      'selected', selected_count,
      'max', max_special_codes,
      'active', has_orders
    )
    order by category
  ) as category_counts
from counts
group by
  settlement_session_id,
  summary_group_id,
  round_id,
  round_no,
  round_status;

revoke all on table
  public.settlement_summary_group_actual_special_point_codes_current
from public, anon, authenticated;

grant select on table
  public.settlement_summary_group_actual_special_point_codes_current
to service_role;

revoke all on table
  public.session_summary_group_actual_point_status_current
from public, anon, authenticated;

grant select on table
  public.session_summary_group_actual_point_status_current
to service_role;

comment on view
  public.settlement_summary_group_actual_special_point_codes_current
is
  'Latest non-archived Round Actual Point codes by Settlement and Summary Group.';

comment on view
  public.session_summary_group_actual_point_status_current
is
  'Latest non-archived Round Actual Point readiness by Settlement and Summary Group.';

commit;
