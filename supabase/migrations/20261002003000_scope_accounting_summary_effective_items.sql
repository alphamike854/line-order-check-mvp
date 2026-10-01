-- Accounting Report performance optimization.
--
-- Preserve existing Round/Human Truth/Point semantics while
-- constraining the effective-item read model to LINE Groups
-- already selected by configured_groups.
--
-- Source definition:
--   supabase/migrations/20260915050000_cut_historical_read_attribution_to_round_lineage.sql
--
-- DATA MUTATION: NONE
-- SCHEMA EFFECT:
--   CREATE OR REPLACE FUNCTION ONLY
--
-- Previous behavior:
--   accounting_effective_order_items_rounds(
--     p_session_id,
--     p_round_ids,
--     null::text[]
--   )
--
-- New behavior:
--   pass the exact configured LINE Group IDs for this report scope.

CREATE OR REPLACE FUNCTION public.accounting_report_line_group_summary_rounds(p_session_id uuid, p_round_ids uuid[], p_summary_group_id text DEFAULT NULL::text)
 RETURNS TABLE(line_group_id text, line_group_name text, summary_group_id text, round_id uuid, business_date date, daily_round_no integer, round_no integer, round_status text, reduction_pct numeric, message_count bigint, received_total numeric, after_reduction numeric, reduction_amount numeric, special_point_total numeric, reconciliation_total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      round_scope.summary_group_id
        as summary_group_id,
      round_scope.round_id,
      round_scope.business_date,
      round_scope.daily_round_no,
      round_scope.round_no,
      round_scope.round_status,
      cfg.reduction_pct::numeric
        as reduction_pct
    from
      selected_rounds round_scope
    join
      public.settlement_line_group_round_config cfg
        on cfg.round_id =
           round_scope.round_id
    where
      p_summary_group_id is null
      or round_scope.summary_group_id =
         p_summary_group_id
  ),
  effective_items as (
    select *
    from public.accounting_effective_order_items_rounds(
      p_session_id,
      p_round_ids,
      array(
        select distinct
          scoped.line_group_id
        from configured_groups scoped
        where scoped.line_group_id
          is not null
        order by
          scoped.line_group_id
      )::text[]
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
     and exists (
       select 1
       from public.messages source_message
       where
         source_message.id =
           item.message_record_id
         and source_message.settlement_session_id =
           p_session_id
         and source_message.summary_group_round_id =
           cfg.round_id
     )

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
$function$;
