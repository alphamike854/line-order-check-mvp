create or replace function public.accounting_report_line_group_summary(
  p_session_id uuid,
  p_summary_group_id text default null
)
returns table (
  line_group_id text,
  line_group_name text,
  summary_group_id text,
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
  with configured_groups as (
    select
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,
      cfg.reduction_pct::numeric as reduction_pct
    from public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id = p_session_id
      and (
        p_summary_group_id is null
        or cfg.summary_group_id = p_summary_group_id
      )
  ),

  item_values as (
    select
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,
      cfg.reduction_pct,

      oi.message_record_id,

      coalesce(
        oi.quantity::numeric,
        0
      ) as quantity,

      case
        when actual_code.code is null then
          0::numeric

        else
          round(
            coalesce(
              oi.quantity::numeric,
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

    left join public.order_items oi
      on oi.settlement_session_id =
           p_session_id
      and oi.line_group_id =
           cfg.line_group_id

    left join public.settlement_point_profiles profile
      on profile.settlement_session_id =
           p_session_id
      and profile.category =
           oi.category

    left join public.settlement_point_promotions promotion
      on promotion.settlement_session_id =
           p_session_id
      and promotion.summary_group_id =
           cfg.summary_group_id
      and promotion.category =
           oi.category
      and promotion.code =
           oi.code

    left join
      public.settlement_summary_group_actual_special_point_codes
        actual_code
      on actual_code.settlement_session_id =
           p_session_id
      and actual_code.summary_group_id =
           cfg.summary_group_id
      and actual_code.category =
           oi.category
      and actual_code.code =
           oi.code
  ),

  aggregates as (
    select
      iv.line_group_id,
      iv.line_group_name,
      iv.summary_group_id,
      iv.reduction_pct,

      count(
        distinct iv.message_record_id
      ) as message_count,

      coalesce(
        sum(iv.quantity),
        0
      )::numeric as received_total,

      round(
        coalesce(
          sum(iv.special_point),
          0
        ),
        2
      )::numeric as special_point_total

    from item_values iv

    group by
      iv.line_group_id,
      iv.line_group_name,
      iv.summary_group_id,
      iv.reduction_pct
  ),

  reduced as (
    select
      a.*,

      round(
        a.received_total
        *
        (
          1
          - coalesce(a.reduction_pct, 0)
            / 100
        ),
        2
      )::numeric as after_reduction

    from aggregates a
  )

  select
    r.line_group_id,
    r.line_group_name,
    r.summary_group_id,
    r.reduction_pct,
    r.message_count,
    r.received_total,
    r.after_reduction,

    round(
      r.received_total
      - r.after_reduction,
      2
    )::numeric as reduction_amount,

    r.special_point_total,

    round(
      r.after_reduction
      - r.special_point_total,
      2
    )::numeric as reconciliation_total

  from reduced r

  order by
    r.line_group_name;
$$;


revoke all
on function
  public.accounting_report_line_group_summary(uuid,text)
from public, anon, authenticated;

grant execute
on function
  public.accounting_report_line_group_summary(uuid,text)
to service_role;
