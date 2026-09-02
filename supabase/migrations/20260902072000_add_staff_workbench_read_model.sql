-- R2D1B
-- Assigned Workbench Read Model + Order Totals
--
-- Goals:
-- 1. Scope Staff workbench to assigned LINE Groups.
-- 2. Use settlement_line_group_config as the session snapshot.
-- 3. Use the latest Summary Group Round in the current settlement.
-- 4. Calculate totals from canonical active order_items only.
-- 5. Return bounded OPEN Review work items without loading the full ledger.

create or replace function public.staff_workbench_summary(
  p_settlement_session_id uuid,
  p_line_group_ids text[],
  p_summary_group_id text default null
)
returns table (
  summary_group_id text,
  summary_group_name text,
  line_group_id text,
  line_group_name text,
  summary_group_round_id uuid,
  round_no integer,
  round_status text,
  order_total bigint,
  open_review_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_config as (
    select
      cfg.settlement_session_id,
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,
      sg.name as summary_group_name
    from public.settlement_line_group_config cfg
    join public.summary_groups sg
      on sg.id = cfg.summary_group_id
    where
      cfg.settlement_session_id =
        p_settlement_session_id
      and cfg.line_group_id =
        any(
          coalesce(
            p_line_group_ids,
            array[]::text[]
          )
        )
      and (
        nullif(
          trim(p_summary_group_id),
          ''
        ) is null
        or cfg.summary_group_id =
          trim(p_summary_group_id)
      )
  ),

  requested_summary_groups as (
    select distinct
      summary_group_id
    from requested_config
  ),

  latest_round as (
    select distinct on (
      r.summary_group_id
    )
      r.id,
      r.summary_group_id,
      r.round_no,
      r.status
    from public.settlement_summary_group_rounds r
    join requested_summary_groups requested
      on requested.summary_group_id =
         r.summary_group_id
    where
      r.settlement_session_id =
        p_settlement_session_id
    order by
      r.summary_group_id,
      r.round_no desc
  ),

  order_totals as (
    select
      oi.line_group_id,
      oi.summary_group_round_id,
      sum(oi.quantity)::bigint
        as order_total
    from public.order_items oi
    join latest_round round_state
      on round_state.id =
         oi.summary_group_round_id
    join requested_config cfg
      on cfg.line_group_id =
         oi.line_group_id
      and cfg.summary_group_id =
         round_state.summary_group_id
    where
      oi.unsent_flag = false
    group by
      oi.line_group_id,
      oi.summary_group_round_id
  ),

  review_counts as (
    select
      m.line_group_id,
      m.summary_group_round_id,
      count(*)::bigint
        as open_review_count
    from public.review_items review
    join public.messages m
      on m.id =
         review.message_record_id
    join latest_round round_state
      on round_state.id =
         m.summary_group_round_id
    join requested_config cfg
      on cfg.line_group_id =
         m.line_group_id
      and cfg.summary_group_id =
         round_state.summary_group_id
    where
      review.status = 'OPEN'
      and m.unsent = false
    group by
      m.line_group_id,
      m.summary_group_round_id
  )

  select
    cfg.summary_group_id,
    cfg.summary_group_name,
    cfg.line_group_id,
    cfg.line_group_name,

    round_state.id
      as summary_group_round_id,

    round_state.round_no,

    coalesce(
      round_state.status,
      'NOT_STARTED'
    ) as round_status,

    coalesce(
      totals.order_total,
      0
    )::bigint as order_total,

    coalesce(
      reviews.open_review_count,
      0
    )::bigint as open_review_count

  from requested_config cfg

  left join latest_round round_state
    on round_state.summary_group_id =
       cfg.summary_group_id

  left join order_totals totals
    on totals.line_group_id =
       cfg.line_group_id
    and totals.summary_group_round_id =
        round_state.id

  left join review_counts reviews
    on reviews.line_group_id =
       cfg.line_group_id
    and reviews.summary_group_round_id =
        round_state.id

  order by
    cfg.summary_group_name,
    cfg.line_group_name,
    cfg.line_group_id;
$$;


create or replace function public.staff_workbench_open_reviews(
  p_settlement_session_id uuid,
  p_line_group_ids text[],
  p_summary_group_id text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  review_id bigint,
  message_record_id uuid,

  summary_group_id text,
  summary_group_name text,

  line_group_id text,
  line_group_name text,

  summary_group_round_id uuid,
  round_no integer,
  round_status text,

  event_timestamp timestamptz,
  message_created_at timestamptz,
  review_created_at timestamptz,

  user_id text,
  message_type text,

  raw_text text,
  normalized_text text,
  ocr_text text,
  display_text text,

  parse_status text,
  parser_version text,

  reason_codes jsonb,
  warnings jsonb,

  has_image_evidence boolean,

  message_order_total bigint,
  items jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_config as (
    select
      cfg.settlement_session_id,
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,
      sg.name as summary_group_name
    from public.settlement_line_group_config cfg
    join public.summary_groups sg
      on sg.id =
         cfg.summary_group_id
    where
      cfg.settlement_session_id =
        p_settlement_session_id
      and cfg.line_group_id =
        any(
          coalesce(
            p_line_group_ids,
            array[]::text[]
          )
        )
      and (
        nullif(
          trim(p_summary_group_id),
          ''
        ) is null
        or cfg.summary_group_id =
          trim(p_summary_group_id)
      )
  ),

  requested_summary_groups as (
    select distinct
      summary_group_id
    from requested_config
  ),

  latest_round as (
    select distinct on (
      r.summary_group_id
    )
      r.id,
      r.summary_group_id,
      r.round_no,
      r.status
    from public.settlement_summary_group_rounds r
    join requested_summary_groups requested
      on requested.summary_group_id =
         r.summary_group_id
    where
      r.settlement_session_id =
        p_settlement_session_id
    order by
      r.summary_group_id,
      r.round_no desc
  )

  select
    review.id
      as review_id,

    m.id
      as message_record_id,

    cfg.summary_group_id,
    cfg.summary_group_name,

    cfg.line_group_id,
    cfg.line_group_name,

    round_state.id
      as summary_group_round_id,

    round_state.round_no,
    round_state.status
      as round_status,

    m.event_timestamp,
    m.created_at
      as message_created_at,

    review.created_at
      as review_created_at,

    m.user_id,
    m.message_type,

    m.raw_text,
    m.normalized_text,
    m.ocr_text,

    coalesce(
      m.normalized_text,
      m.ocr_text,
      m.raw_text,
      ''
    ) as display_text,

    m.parse_status,
    m.parser_version,

    review.reason_codes,
    review.warnings,

    (
      m.image_storage_path
      is not null
    ) as has_image_evidence,

    coalesce(
      item_agg.message_order_total,
      0
    )::bigint
      as message_order_total,

    coalesce(
      item_agg.items,
      '[]'::jsonb
    ) as items

  from public.review_items review

  join public.messages m
    on m.id =
       review.message_record_id

  join requested_config cfg
    on cfg.line_group_id =
       m.line_group_id

  join latest_round round_state
    on round_state.id =
       m.summary_group_round_id
    and round_state.summary_group_id =
        cfg.summary_group_id

  left join lateral (
    select
      sum(oi.quantity)::bigint
        as message_order_total,

      jsonb_agg(
        jsonb_build_object(
          'category',
            oi.category,
          'code',
            oi.code,
          'quantity',
            oi.quantity
        )
        order by
          oi.category,
          oi.code
      ) as items

    from public.order_items oi

    where
      oi.message_record_id =
        m.id
      and oi.unsent_flag = false
  ) item_agg
    on true

  where
    review.status = 'OPEN'
    and m.unsent = false

  order by
    review.created_at asc,
    review.id asc

  limit greatest(
    1,
    least(
      coalesce(
        p_limit,
        100
      ),
      200
    )
  )

  offset greatest(
    coalesce(
      p_offset,
      0
    ),
    0
  );
$$;


revoke all
on function public.staff_workbench_summary(
  uuid,
  text[],
  text
)
from public, anon, authenticated;

grant execute
on function public.staff_workbench_summary(
  uuid,
  text[],
  text
)
to service_role;


revoke all
on function public.staff_workbench_open_reviews(
  uuid,
  text[],
  text,
  integer,
  integer
)
from public, anon, authenticated;

grant execute
on function public.staff_workbench_open_reviews(
  uuid,
  text[],
  text,
  integer,
  integer
)
to service_role;
