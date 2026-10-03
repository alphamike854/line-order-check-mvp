-- Reduce Accounting Point readiness scan scope to the LINE Groups
-- owned by the selected Rounds.
--
-- Invariants preserved:
-- - same function signature
-- - same Round / Summary Group semantics
-- - same Point readiness rules
-- - same Human Truth precedence
-- - same UNSEND exclusion
-- - service_role-only execution

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

  selected_line_groups as (
    select distinct
      cfg.line_group_id

    from selected_rounds round_scope

    join public.settlement_line_group_round_config cfg
      on cfg.round_id =
           round_scope.round_id

    where cfg.line_group_id
      is not null
  ),

  effective_items as (
    select *
    from public.accounting_effective_order_items_rounds(
      p_session_id,
      p_round_ids,
      array(
        select
          scoped.line_group_id
        from selected_line_groups scoped
        order by
          scoped.line_group_id
      )::text[]
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
  'Round-scoped Accounting Point readiness. Effective-item evaluation is constrained to LINE Groups owned by the selected Rounds while preserving Point readiness and Human Truth semantics.';
