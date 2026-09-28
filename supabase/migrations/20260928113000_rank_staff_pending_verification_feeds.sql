-- Workbench Pending Verification Rank-First Read Model
--
-- Performance-only forward migration.
--
-- Preserve:
--   - latest Summary Group Round ownership
--   - pending Human Verification semantics
--   - durable Human IGNORE exclusion
--   - PRIORITY ordering
--   - HIGH_TOTAL >= 500 per category+code
--   - RECENT ordering
--   - exact RPC signature / privileges
--
-- Change:
--   1. identify candidate messages
--   2. calculate only numeric ranking aggregates
--   3. rank + LIMIT/OFFSET
--   4. enrich only the selected page with Review + JSON items
--
-- No parser, canonical order, Review, claim or Human Truth mutation.

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

  -- Keep this boundary deliberately lean.
  -- Large text, Review metadata and JSON item payloads are not
  -- materialized until the requested page has been selected.
  candidate_messages as materialized (
    select
      m.id as message_record_id,

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

    left join public.message_verifications verification
      on verification.message_record_id =
        m.id

    where
      m.unsent = false

      and verification.message_record_id
        is null

      -- Preserve durable Human IGNORE exclusion.
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

  -- Materialize the small canonical item projection once.
  -- Both PRIORITY and HIGH_TOTAL ranking use these rows.
  order_rows as materialized (
    select
      candidate.message_record_id,
      oi.category,
      oi.code,
      oi.quantity
    from candidate_messages candidate
    join public.order_items oi
      on oi.message_record_id =
        candidate.message_record_id
  ),

  item_totals as (
    select
      rows.message_record_id,
      count(*)::bigint
        as item_count,
      sum(rows.quantity)::bigint
        as message_order_total
    from order_rows rows
    group by
      rows.message_record_id
  ),

  -- Preserve the HIGH_TOTAL definition exactly:
  -- category + code total, then largest code total per message.
  code_totals as (
    select
      rows.message_record_id,
      upper(
        trim(rows.category)
      ) as category,
      trim(rows.code)
        as code,
      sum(rows.quantity)::bigint
        as code_total
    from order_rows rows
    group by
      rows.message_record_id,
      upper(
        trim(rows.category)
      ),
      trim(rows.code)
  ),

  code_max as (
    select
      totals.message_record_id,
      max(
        totals.code_total
      )::bigint
        as max_code_total
    from code_totals totals
    group by
      totals.message_record_id
  ),

  rankable as (
    select
      candidate.*,

      coalesce(
        totals.item_count,
        0
      )::bigint
        as item_count,

      coalesce(
        totals.message_order_total,
        0
      )::bigint
        as message_order_total,

      coalesce(
        code_max.max_code_total,
        0
      )::bigint
        as max_code_total,

      (
        candidate.parse_status
          is distinct from 'PARSED'
        or coalesce(
          totals.item_count,
          0
        ) = 0
      ) as needs_interpretation

    from candidate_messages candidate

    left join item_totals totals
      on totals.message_record_id =
        candidate.message_record_id

    left join code_max
      on code_max.message_record_id =
        candidate.message_record_id
  ),

  -- Ranking and pagination happen before expensive presentation
  -- enrichment.
  ranked_page as materialized (
    select
      ranked.*
    from rankable ranked

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

        or (
          ranked.needs_interpretation =
            false
          and ranked.max_code_total >=
            500
        )
      )

    order by
      -- HIGH_TOTAL:
      -- largest category+code total first.
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
        then ranked.max_code_total
        else null
      end desc,

      -- PRIORITY:
      -- unsafe interpretation first.
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
            when ranked.needs_interpretation
            then 0
            else 1
          end
        else null
      end asc,

      -- Then largest provisional whole-message total.
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
        then ranked.message_order_total
        else null
      end desc,

      ranked.event_timestamp desc,
      ranked.message_record_id desc

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

      page.message_order_total,

      coalesce(
        item_agg.items,
        '[]'::jsonb
      ) as items,

      page.needs_interpretation,
      page.max_code_total

    from ranked_page page

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

    -- JSON construction is now page-scoped.
    left join lateral (
      select
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

    'PENDING'::text
      as verification_status,

    enriched.needs_interpretation

  from enriched

  order by
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
      then enriched.max_code_total
      else null
    end desc,

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
          when enriched.needs_interpretation
          then 0
          else 1
        end
      else null
    end asc,

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
      then enriched.message_order_total
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
