-- P0-2C1
-- Dedicated HIGH_TOTAL Human Verification read ordering.
--
-- RECENT:
--   newest pending verification work.
--
-- PRIORITY:
--   interpretation / attention work first.
--
-- HIGH_TOTAL:
--   only safely interpreted pending orders,
--   largest provisional canonical message total first.
--
-- Read-model only.
-- No canonical order, Review, claim, message, or
-- verification mutation is introduced here.

create or replace function
  public.staff_workbench_pending_verifications(
    p_settlement_session_id uuid,
    p_line_group_ids text[],
    p_summary_group_id text default null,
    p_sort_mode text default 'RECENT',
    p_limit integer default 100,
    p_offset integer default 0
  )
returns table (
  message_record_id uuid,

  review_id bigint,

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
  items jsonb,

  verification_status text,
  needs_interpretation boolean
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
  ),

  pending as (
    select
      m.id
        as message_record_id,

      review.id
        as review_id,

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

      coalesce(
        review.reason_codes,
        '[]'::jsonb
      ) as reason_codes,

      coalesce(
        review.warnings,
        '[]'::jsonb
      ) as warnings,

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
      ) as items,

      'PENDING'::text
        as verification_status,

      (
        m.parse_status
          is distinct from 'PARSED'

        or coalesce(
          item_agg.item_count,
          0
        ) = 0
      ) as needs_interpretation

    from public.messages m

    join requested_config cfg
      on cfg.line_group_id =
        m.line_group_id

      and cfg.summary_group_id =
        m.summary_group_id

    join latest_round round_state
      on round_state.id =
        m.summary_group_round_id

      and round_state.summary_group_id =
        cfg.summary_group_id

    left join public.message_verifications verification
      on verification.message_record_id =
        m.id

    left join lateral (
      select
        r.id,
        r.created_at,
        r.reason_codes,
        r.warnings

      from public.review_items r

      where
        r.message_record_id =
          m.id

        and r.status =
          'OPEN'

      order by
        r.id desc

      limit 1
    ) review
      on true

    left join lateral (
      select
        count(*)::bigint
          as item_count,

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
            oi.code,
            oi.quantity
        ) as items

      from public.order_items oi

      where
        oi.message_record_id =
          m.id
    ) item_agg
      on true

    where
      m.unsent =
        false

      and verification.message_record_id
        is null

      -- A human-resolved Review IGNORE is durable evidence that
      -- Staff explicitly classified this message as not an order.
      -- It must not return to the Human Verification queue.
      and not exists (
        select 1

        from public.review_items human_ignore

        where
          human_ignore.message_record_id =
            m.id

          and human_ignore.resolution_type =
            'IGNORED'

          and human_ignore.status in (
            'IGNORED',
            'RESOLVED'
          )
      )
  )

  select
    pending.*

  from pending

  where
    upper(
      coalesce(
        nullif(
          trim(p_sort_mode),
          ''
        ),
        'RECENT'
      )
    ) in (
      'RECENT',
      'PRIORITY',
      'HIGH_TOTAL'
    )


    -- HIGH_TOTAL is intentionally a parseable-order queue.
    -- Interpretation work remains in PRIORITY.
    and (
      upper(
        coalesce(
          nullif(
            trim(p_sort_mode),
            ''
          ),
          'RECENT'
        )
      ) <> 'HIGH_TOTAL'

      or needs_interpretation = false
    )

  order by


    -- HIGH_TOTAL:
    -- largest provisional canonical order first.
    case
      when upper(
        coalesce(
          nullif(
            trim(p_sort_mode),
            ''
          ),
          'RECENT'
        )
      ) = 'HIGH_TOTAL'
      then message_order_total
      else null
    end desc,

    -- PRIORITY:
    -- unreadable / unsafe interpretation comes first.
    case
      when upper(
        coalesce(
          nullif(
            trim(p_sort_mode),
            ''
          ),
          'RECENT'
        )
      ) = 'PRIORITY'
      then
        case
          when needs_interpretation
          then 0
          else 1
        end
      else null
    end asc,

    -- Then largest provisional parser total.
    case
      when upper(
        coalesce(
          nullif(
            trim(p_sort_mode),
            ''
          ),
          'RECENT'
        )
      ) = 'PRIORITY'
      then message_order_total
      else null
    end desc,

    event_timestamp desc,
    message_record_id desc

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

revoke all on function
  public.staff_workbench_pending_verifications(
    uuid,
    text[],
    text,
    text,
    integer,
    integer
  )
from
  public,
  anon,
  authenticated;

grant execute on function
  public.staff_workbench_pending_verifications(
    uuid,
    text[],
    text,
    text,
    integer,
    integer
  )
to service_role;
