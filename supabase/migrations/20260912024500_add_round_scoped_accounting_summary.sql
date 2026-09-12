-- DR1D-D1B1B1
-- Round-scoped Accounting summary + Point readiness.
--
-- Invariants:
--   * one current Round per selected Summary Group
--   * Accounting truth comes only from selected Round IDs
--   * Actual special Point codes belong to exact Round
--   * Promotion belongs to exact Round
--   * SELECTED Promotion applies only to its LINE Groups
--   * no legacy Point/Promotion fallback
--   * existing legacy Accounting RPCs remain unchanged


-- ============================================================
-- 1. Round-scoped Point readiness
--
-- Mirrors the established operator contract:
--   A/B/E: active category requires exactly 1 selected code
--   G/H/L: active category requires max_special_codes
--   F:     active category may contain 0..max_special_codes
--
-- A category is active only when the selected Round has
-- effective Accounting truth in that category.
-- ============================================================

create or replace function
  public.accounting_round_point_status(
    p_session_id uuid,
    p_round_ids uuid[]
  )
returns table (
  summary_group_id text,
  round_id uuid,
  business_date date,
  daily_round_no integer,
  round_no integer,
  round_status text,
  actual_codes_ready boolean,
  category_counts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_rounds as (
    select *
    from public.accounting_round_scope(
      p_session_id,
      p_round_ids
    )
  ),

  effective_items as (
    select *
    from public.accounting_effective_order_items_rounds(
      p_session_id,
      p_round_ids,
      null::text[]
    )
  ),

  active_categories as (
    select distinct
      item.summary_group_id,
      item.category
    from effective_items item
    where item.category is not null
  ),

  actual_counts as (
    select
      round_scope.summary_group_id,
      actual.category,
      count(*)::integer
        as actual_count
    from selected_rounds round_scope
    join
      public.settlement_summary_group_actual_special_point_codes_current
        actual
      on actual.round_id =
           round_scope.round_id
     and actual.summary_group_id =
           round_scope.summary_group_id
     and actual.settlement_session_id =
           p_session_id
    group by
      round_scope.summary_group_id,
      actual.category
  ),

  profile_status as (
    select
      round_scope.summary_group_id,
      round_scope.round_id,
      round_scope.business_date,
      round_scope.daily_round_no,
      round_scope.round_no,
      round_scope.round_status,

      profile.category,
      profile.max_special_codes::integer
        as max_special_codes,

      (
        active.category is not null
      ) as active,

      coalesce(
        actual.actual_count,
        0
      )::integer
        as actual_count,

      case
        when active.category is null then
          true

        when profile.category in (
          'A',
          'B',
          'E'
        ) then
          coalesce(
            actual.actual_count,
            0
          ) = 1

        when profile.category in (
          'G',
          'H',
          'L'
        ) then
          coalesce(
            actual.actual_count,
            0
          ) =
          coalesce(
            profile.max_special_codes,
            0
          )

        when profile.category = 'F' then
          coalesce(
            actual.actual_count,
            0
          ) <=
          coalesce(
            profile.max_special_codes,
            0
          )

        else
          coalesce(
            actual.actual_count,
            0
          ) <=
          coalesce(
            profile.max_special_codes,
            0
          )
      end as category_ready

    from selected_rounds round_scope

    join public.settlement_point_profiles profile
      on profile.settlement_session_id =
           p_session_id

    left join active_categories active
      on active.summary_group_id =
           round_scope.summary_group_id
     and active.category =
           profile.category

    left join actual_counts actual
      on actual.summary_group_id =
           round_scope.summary_group_id
     and actual.category =
           profile.category
  )

  select
    round_scope.summary_group_id,
    round_scope.round_id,
    round_scope.business_date,
    round_scope.daily_round_no,
    round_scope.round_no,
    round_scope.round_status,

    (
      count(profile.category) > 0
      and coalesce(
        bool_and(
          profile.category_ready
        ),
        false
      )
    ) as actual_codes_ready,

    coalesce(
      jsonb_object_agg(
        profile.category,
        jsonb_build_object(
          'active',
            profile.active,
          'count',
            profile.actual_count,
          'max_special_codes',
            profile.max_special_codes,
          'ready',
            profile.category_ready
        )
        order by profile.category
      )
      filter (
        where profile.category
          is not null
      ),
      '{}'::jsonb
    ) as category_counts

  from selected_rounds round_scope

  left join profile_status profile
    on profile.round_id =
         round_scope.round_id

  group by
    round_scope.summary_group_id,
    round_scope.round_id,
    round_scope.business_date,
    round_scope.daily_round_no,
    round_scope.round_no,
    round_scope.round_status

  order by
    round_scope.summary_group_id;
$$;


revoke all
on function
  public.accounting_round_point_status(
    uuid,
    uuid[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_round_point_status(
    uuid,
    uuid[]
  )
to service_role;


comment on function
  public.accounting_round_point_status(
    uuid,
    uuid[]
  )
is
  'Round-scoped Accounting Point readiness. Selected actual Point codes never cross Round ownership.';


-- ============================================================
-- 2. Round-scoped Accounting summary fast path
-- ============================================================

create or replace function
  public.accounting_report_line_group_summary_rounds(
    p_session_id uuid,
    p_round_ids uuid[],
    p_summary_group_id text default null
  )
returns table (
  line_group_id text,
  line_group_name text,
  summary_group_id text,

  round_id uuid,
  business_date date,
  daily_round_no integer,
  round_no integer,
  round_status text,

  reduction_pct numeric,
  message_count bigint,
  received_total numeric,
  after_reduction numeric,
  reduction_amount numeric,
  special_point_total numeric,
  reconciliation_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_rounds as (
    select *
    from public.accounting_round_scope(
      p_session_id,
      p_round_ids
    )
  ),

  configured_groups as (
    select
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,

      round_scope.round_id,
      round_scope.business_date,
      round_scope.daily_round_no,
      round_scope.round_no,
      round_scope.round_status,

      cfg.reduction_pct::numeric
        as reduction_pct

    from public.settlement_line_group_config cfg

    join selected_rounds round_scope
      on round_scope.summary_group_id =
           cfg.summary_group_id

    where
      cfg.settlement_session_id =
        p_session_id

      and (
        p_summary_group_id is null
        or cfg.summary_group_id =
             p_summary_group_id
      )
  ),

  effective_items as (
    select *
    from public.accounting_effective_order_items_rounds(
      p_session_id,
      p_round_ids,
      null::text[]
    )
  ),

  item_values as (
    select
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,

      cfg.round_id,
      cfg.business_date,
      cfg.daily_round_no,
      cfg.round_no,
      cfg.round_status,

      cfg.reduction_pct,

      item.message_record_id,

      coalesce(
        item.quantity::numeric,
        0
      ) as quantity,

      case
        when actual_code.code is null then
          0::numeric

        else
          round(
            coalesce(
              item.quantity::numeric,
              0
            )
            *
            round(
              coalesce(
                profile.special_multiplier,
                0
              )::numeric
              *
              coalesce(
                promotion.point_factor_pct,
                100
              )::numeric
              / 100,
              2
            ),
            2
          )
      end as special_point

    from configured_groups cfg

    left join effective_items item
      on item.line_group_id =
           cfg.line_group_id
     and item.summary_group_id =
           cfg.summary_group_id

    left join public.settlement_point_profiles profile
      on profile.settlement_session_id =
           p_session_id
     and profile.category =
           item.category

    left join
      public.settlement_summary_group_point_promotions_current
        promotion
      on promotion.settlement_session_id =
           p_session_id
     and promotion.round_id =
           cfg.round_id
     and promotion.summary_group_id =
           cfg.summary_group_id
     and promotion.category =
           item.category
     and promotion.code =
           item.code
     and (
       coalesce(
         promotion.target_scope,
         'ALL'
       ) = 'ALL'

       or (
         promotion.target_scope =
           'SELECTED'

         and (
          coalesce(
            promotion.line_group_ids,
            '[]'::jsonb
          ) ? cfg.line_group_id
        )
       )
     )

    left join
      public.settlement_summary_group_actual_special_point_codes_current
        actual_code
      on actual_code.settlement_session_id =
           p_session_id
     and actual_code.round_id =
           cfg.round_id
     and actual_code.summary_group_id =
           cfg.summary_group_id
     and actual_code.category =
           item.category
     and actual_code.code =
           item.code
  ),

  aggregates as (
    select
      item.line_group_id,
      item.line_group_name,
      item.summary_group_id,

      item.round_id,
      item.business_date,
      item.daily_round_no,
      item.round_no,
      item.round_status,

      item.reduction_pct,

      count(
        distinct item.message_record_id
      ) as message_count,

      coalesce(
        sum(item.quantity),
        0
      )::numeric
        as received_total,

      round(
        coalesce(
          sum(item.special_point),
          0
        ),
        2
      )::numeric
        as special_point_total

    from item_values item

    group by
      item.line_group_id,
      item.line_group_name,
      item.summary_group_id,

      item.round_id,
      item.business_date,
      item.daily_round_no,
      item.round_no,
      item.round_status,

      item.reduction_pct
  ),

  reduced as (
    select
      aggregate.*,

      round(
        aggregate.received_total
        *
        (
          1
          - coalesce(
              aggregate.reduction_pct,
              0
            )
            / 100
        ),
        2
      )::numeric
        as after_reduction

    from aggregates aggregate
  )

  select
    reduced.line_group_id,
    reduced.line_group_name,
    reduced.summary_group_id,

    reduced.round_id,
    reduced.business_date,
    reduced.daily_round_no,
    reduced.round_no,
    reduced.round_status,

    reduced.reduction_pct,
    reduced.message_count,
    reduced.received_total,
    reduced.after_reduction,

    round(
      reduced.received_total
      - reduced.after_reduction,
      2
    )::numeric
      as reduction_amount,

    reduced.special_point_total,

    round(
      reduced.after_reduction
      - reduced.special_point_total,
      2
    )::numeric
      as reconciliation_total

  from reduced

  order by
    reduced.line_group_name;
$$;


revoke all
on function
  public.accounting_report_line_group_summary_rounds(
    uuid,
    uuid[],
    text
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_report_line_group_summary_rounds(
    uuid,
    uuid[],
    text
  )
to service_role;


comment on function
  public.accounting_report_line_group_summary_rounds(
    uuid,
    uuid[],
    text
  )
is
  'Round-scoped Accounting summary fast path using exact Round truth, Actual Point and Promotion ownership.';
