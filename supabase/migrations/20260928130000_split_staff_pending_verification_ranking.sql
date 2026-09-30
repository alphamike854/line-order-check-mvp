-- Workbench Pending Verification V2
--
-- Split ranking paths before presentation enrichment:
--   RECENT:     time/id only
--   PRIORITY:   item_count + whole-message total only
--   HIGH_TOTAL: direct canonical category+code aggregation
--
-- Latest OPEN Review metadata and items JSON are built only after
-- LIMIT/OFFSET page selection.
--
-- No canonical data mutation.

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
mode as materialized (
    select
      upper(
        coalesce(
          nullif(
            trim(p_sort_mode),
            ''
          ),
          'RECENT'
        )
      )::text as sort_mode
  ),

  candidate_messages as materialized (
    select
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
      m.parse_status

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

    cross join mode

    left join public.message_verifications verification
      on verification.message_record_id =
        m.id

    where
      mode.sort_mode in (
        'RECENT',
        'PRIORITY',
        'HIGH_TOTAL'
      )

      and m.unsent =
        false

      and verification.message_record_id
        is null

      -- Preserve durable Human Ignore eligibility semantics.
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
  ),

  candidate_keys as materialized (
    select distinct
      message_record_id

    from candidate_messages
  ),

  -- PRIORITY requires only whole-message item count and total.
  -- It must not calculate category+code totals.
  priority_totals as materialized (
    select
      oi.message_record_id,

      count(*)::bigint
        as item_count,

      sum(oi.quantity)::bigint
        as message_order_total

    from public.order_items oi

    join candidate_keys candidate
      on candidate.message_record_id =
        oi.message_record_id

    cross join mode

    where
      mode.sort_mode =
        'PRIORITY'

    group by
      oi.message_record_id
  ),

  priority_page as materialized (
    select
      candidate.message_record_id,

      candidate.summary_group_id,
      candidate.summary_group_name,

      candidate.line_group_id,
      candidate.line_group_name,

      candidate.summary_group_round_id,
      candidate.round_no,
      candidate.round_status,

      candidate.event_timestamp,
      candidate.parse_status,

      mode.sort_mode,

      null::bigint
        as high_total_rank,

      (
        candidate.parse_status
          is distinct from 'PARSED'

        or coalesce(
          totals.item_count,
          0
        ) = 0
      ) as priority_needs_interpretation,

      coalesce(
        totals.message_order_total,
        0
      )::bigint
        as priority_message_order_total

    from candidate_messages candidate

    cross join mode

    left join priority_totals totals
      on totals.message_record_id =
        candidate.message_record_id

    where
      mode.sort_mode =
        'PRIORITY'

    order by
      case
        when (
          candidate.parse_status
            is distinct from 'PARSED'

          or coalesce(
            totals.item_count,
            0
          ) = 0
        )
        then 0
        else 1
      end asc,

      coalesce(
        totals.message_order_total,
        0
      ) desc,

      candidate.event_timestamp desc,
      candidate.message_record_id desc

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
    )
  ),

  -- HIGH_TOTAL performs the only category+code aggregation.
  -- Aggregate directly from canonical order_items; do not build/reparse JSON.
  -- HIGH_TOTAL fast path:
  -- canonical order_items are unique by message/category/code,
  -- so max(quantity) is equivalent to the historical normalized
  -- per-code max while rows remain canonical.
  --
  -- If any future row is not canonical, that message alone falls
  -- back to the historical normalized category+code aggregation.
  -- HIGH_TOTAL candidates carry all ranking/page metadata.
  -- This avoids joining the 12k-message stats result back to the
  -- materialized candidate CTE after aggregation.
  high_candidate_messages as materialized (
    select
      candidate.message_record_id,

      candidate.summary_group_id,
      candidate.summary_group_name,

      candidate.line_group_id,
      candidate.line_group_name,

      candidate.summary_group_round_id,
      candidate.round_no,
      candidate.round_status,

      candidate.event_timestamp,
      candidate.parse_status

    from candidate_messages candidate

    cross join mode

    where
      mode.sort_mode =
        'HIGH_TOTAL'

      and candidate.parse_status =
        'PARSED'
  ),

  -- Canonical fast path: one row per message/category/code is
  -- enforced by order_items uniqueness. Metadata stays attached
  -- to each message aggregate so no later candidate rejoin exists.
  high_message_stats as materialized (
    select
      candidate.message_record_id,

      candidate.summary_group_id,
      candidate.summary_group_name,

      candidate.line_group_id,
      candidate.line_group_name,

      candidate.summary_group_round_id,
      candidate.round_no,
      candidate.round_status,

      candidate.event_timestamp,
      candidate.parse_status,

      count(*)::bigint
        as item_count,

      sum(oi.quantity)::bigint
        as message_order_total,

      max(oi.quantity)::bigint
        as fast_max_code_total,

      bool_or(
        oi.category
          is distinct from
          upper(
            trim(oi.category)
          )

        or oi.code
          is distinct from
          trim(oi.code)
      )
        as needs_normalized_fallback

    from high_candidate_messages candidate

    join public.order_items oi
      on oi.message_record_id =
        candidate.message_record_id

    group by
      candidate.message_record_id,

      candidate.summary_group_id,
      candidate.summary_group_name,

      candidate.line_group_id,
      candidate.line_group_name,

      candidate.summary_group_round_id,
      candidate.round_no,
      candidate.round_status,

      candidate.event_timestamp,
      candidate.parse_status
  ),

  -- Fail-safe historical normalization only for anomalous messages.
  high_anomaly_code_totals as materialized (
    select
      oi.message_record_id,

      upper(
        trim(oi.category)
      ) as category_key,

      trim(oi.code)
        as code_key,

      sum(oi.quantity)::bigint
        as code_total

    from public.order_items oi

    join high_message_stats stats
      on stats.message_record_id =
        oi.message_record_id

      and stats.needs_normalized_fallback

    group by
      oi.message_record_id,

      upper(
        trim(oi.category)
      ),

      trim(oi.code)
  ),

  high_anomaly_max as materialized (
    select
      message_record_id,

      max(code_total)::bigint
        as max_code_total

    from high_anomaly_code_totals

    group by
      message_record_id
  ),

  high_stats as materialized (
    select
      stats.message_record_id,

      stats.summary_group_id,
      stats.summary_group_name,

      stats.line_group_id,
      stats.line_group_name,

      stats.summary_group_round_id,
      stats.round_no,
      stats.round_status,

      stats.event_timestamp,
      stats.parse_status,

      stats.item_count,
      stats.message_order_total,

      case
        when stats.needs_normalized_fallback
        then coalesce(
          anomaly.max_code_total,
          0
        )::bigint

        else stats.fast_max_code_total
      end
        as max_code_total

    from high_message_stats stats

    left join high_anomaly_max anomaly
      on anomaly.message_record_id =
        stats.message_record_id
  ),

  high_total_page as materialized (
    select
      stats.message_record_id,

      stats.summary_group_id,
      stats.summary_group_name,

      stats.line_group_id,
      stats.line_group_name,

      stats.summary_group_round_id,
      stats.round_no,
      stats.round_status,

      stats.event_timestamp,
      stats.parse_status,

      'HIGH_TOTAL'::text
        as sort_mode,

      stats.max_code_total
        as high_total_rank,

      null::boolean
        as priority_needs_interpretation,

      null::bigint
        as priority_message_order_total

    from high_stats stats

    where
      stats.item_count > 0

      and stats.max_code_total >= 500

    order by
      stats.max_code_total desc,

      stats.event_timestamp desc,
      stats.message_record_id desc

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
    )
  ),

  -- RECENT does not need order_items at all for ranking.
  recent_page as materialized (
    select
      candidate.message_record_id,

      candidate.summary_group_id,
      candidate.summary_group_name,

      candidate.line_group_id,
      candidate.line_group_name,

      candidate.summary_group_round_id,
      candidate.round_no,
      candidate.round_status,

      candidate.event_timestamp,
      candidate.parse_status,

      mode.sort_mode,

      null::bigint
        as high_total_rank,

      null::boolean
        as priority_needs_interpretation,

      null::bigint
        as priority_message_order_total

    from candidate_messages candidate

    cross join mode

    where
      mode.sort_mode =
        'RECENT'

    order by
      candidate.event_timestamp desc,
      candidate.message_record_id desc

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
    )
  ),

  selected_page as materialized (
    select *
    from recent_page

    union all

    select *
    from priority_page

    union all

    select *
    from high_total_page
  ),

  -- Presentation enrichment happens only for the selected page.
  enriched as (
    select
      page.message_record_id,

      review.id
        as review_id,

      page.summary_group_id,
      page.summary_group_name,

      page.line_group_id,
      page.line_group_name,

      page.summary_group_round_id,
      page.round_no,
      page.round_status,

      page.event_timestamp,

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
      ) as needs_interpretation,

      page.sort_mode,
      page.high_total_rank,
      page.priority_needs_interpretation,
      page.priority_message_order_total

    from selected_page page

    join public.messages m
      on m.id =
        page.message_record_id

    left join lateral (
      select
        r.id,
        r.created_at,
        r.reason_codes,
        r.warnings

      from public.review_items r

      where
        r.message_record_id =
          page.message_record_id

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
          page.message_record_id
    ) item_agg
      on true
  )

  select
    enriched.message_record_id,
    enriched.review_id,

    enriched.summary_group_id,
    enriched.summary_group_name,

    enriched.line_group_id,
    enriched.line_group_name,

    enriched.summary_group_round_id,
    enriched.round_no,
    enriched.round_status,

    enriched.event_timestamp,
    enriched.message_created_at,
    enriched.review_created_at,

    enriched.user_id,
    enriched.message_type,

    enriched.raw_text,
    enriched.normalized_text,
    enriched.ocr_text,
    enriched.display_text,

    enriched.parse_status,
    enriched.parser_version,

    enriched.reason_codes,
    enriched.warnings,

    enriched.has_image_evidence,

    enriched.message_order_total,
    enriched.items,

    enriched.verification_status,
    enriched.needs_interpretation

  from enriched

  order by
    case
      when enriched.sort_mode =
        'HIGH_TOTAL'
      then enriched.high_total_rank
      else null
    end desc,

    case
      when enriched.sort_mode =
        'PRIORITY'
      then
        case
          when enriched.priority_needs_interpretation
          then 0
          else 1
        end
      else null
    end asc,

    case
      when enriched.sort_mode =
        'PRIORITY'
      then enriched.priority_message_order_total
      else null
    end desc,

    enriched.event_timestamp desc,
    enriched.message_record_id desc;
$$;

revoke all
on function
  public.staff_workbench_pending_verifications(
    uuid,
    text[],
    text,
    text,
    integer,
    integer
  )
from public, anon, authenticated;

grant execute
on function
  public.staff_workbench_pending_verifications(
    uuid,
    text[],
    text,
    text,
    integer,
    integer
  )
to service_role;
