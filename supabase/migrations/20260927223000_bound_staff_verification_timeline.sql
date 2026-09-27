-- Review Timeline page-first performance repair
--
-- Performance-only change:
--   - select RECENT message page before enrichment
--   - enrich only the requested page
--   - index exact post-close archive message lookup
--
-- No parser, Review, claim, Human Truth or canonical
-- mutation semantics are changed.

begin;

create index if not exists
  post_close_review_archive_source_message_recent_idx
on public.post_close_review_archive (
  source_message_record_id,
  archived_at desc,
  id desc
);

create or replace function
  public.staff_workbench_verification_timeline(
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

  paged_messages as (
    select
      m.*
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

    order by
      m.event_timestamp desc nulls last,
      m.created_at desc,
      m.id desc

    limit greatest(
      1,
      least(
        coalesce(p_limit, 100),
        250
      )
    )

    offset greatest(
      coalesce(p_offset, 0),
      0
    )
  ),

  source_rows as (
    select
      m.id as message_record_id,

      review.id as review_id,

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
      m.ocr_text,

      coalesce(
        post_close.post_close_normalized_text,
        verification.verified_normalized_text,
        m.normalized_text
      ) as effective_normalized_text,

      m.normalized_text
        as source_normalized_text,

      m.parse_status,

      coalesce(
        post_close.post_close_parser_version,
        verification.verified_parser_version,
        m.parser_version
      ) as effective_parser_version,

      m.image_storage_path,
      m.unsent,

      review.status
        as review_status,
      review.resolution_type
        as review_resolution_type,
      review.reason_codes,
      review.warnings,

      verification.message_record_id
        as verification_message_record_id,
      verification.verification_mode,
      verification.verified_order_items,

      post_close.source_resolution_type
        as archived_source_resolution_type,
      post_close.post_close_resolution_type,
      post_close.post_close_items,

      coalesce(
        item_agg.items,
        '[]'::jsonb
      ) as canonical_items

    from paged_messages m

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
        r.status,
        r.resolution_type,
        r.reason_codes,
        r.warnings
      from public.review_items r
      where
        r.message_record_id =
          m.id
      order by
        r.id desc
      limit 1
    ) review
      on true

    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'category', oi.category,
            'code', oi.code,
            'quantity', oi.quantity
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

    left join lateral (
      select
        archive.source_resolution_type,
        archive.post_close_resolution_type,
        archive.post_close_normalized_text,
        archive.post_close_parser_version,
        archive.post_close_items
      from public.post_close_review_archive archive
      where
        archive.source_message_record_id =
          m.id
      order by
        archive.archived_at desc,
        archive.id desc
      limit 1
    ) post_close
      on true
  ),

  classified as (
    select
      source_rows.*,

      case
        when source_rows.unsent = true
          then 'UNSENT'

        when source_rows.post_close_resolution_type =
          'CORRECTED'
          then 'HUMAN_CORRECTED'

        when source_rows.post_close_resolution_type =
          'IGNORED'
          then 'HUMAN_IGNORED'

        when source_rows.verification_mode =
          'CORRECTED'
          then 'HUMAN_CORRECTED'

        when source_rows.review_resolution_type =
          'CORRECTED'
          and source_rows.review_status =
            'RESOLVED'
          then 'HUMAN_CORRECTED'

        when source_rows.archived_source_resolution_type =
          'CORRECTED'
          then 'HUMAN_CORRECTED'

        when source_rows.verification_message_record_id
          is not null
          then 'HUMAN_VERIFIED'

        when source_rows.review_resolution_type =
          'IGNORED'
          and source_rows.review_status in (
            'IGNORED',
            'RESOLVED'
          )
          then 'HUMAN_IGNORED'

        when source_rows.archived_source_resolution_type =
          'IGNORED'
          then 'HUMAN_IGNORED'

        else 'PENDING'
      end as final_verification_status,

      case
        when source_rows.post_close_resolution_type =
          'IGNORED'
          then '[]'::jsonb

        when source_rows.review_resolution_type =
          'IGNORED'
          and source_rows.review_status in (
            'IGNORED',
            'RESOLVED'
          )
          then '[]'::jsonb

        when source_rows.post_close_resolution_type =
          'CORRECTED'
          and jsonb_typeof(
            source_rows.post_close_items
          ) = 'array'
          then source_rows.post_close_items

        when source_rows.verification_message_record_id
          is not null
          and jsonb_typeof(
            source_rows.verified_order_items
          ) = 'array'
          then source_rows.verified_order_items

        else source_rows.canonical_items
      end as effective_items

    from source_rows
  ),

  timeline as (
    select
      classified.message_record_id,
      classified.review_id,
      classified.summary_group_id,
      classified.summary_group_name,
      classified.line_group_id,
      classified.line_group_name,
      classified.summary_group_round_id,
      classified.round_no,
      classified.round_status,
      classified.event_timestamp,
      classified.message_created_at,
      classified.review_created_at,
      classified.user_id,
      classified.message_type,
      classified.raw_text,

      classified.effective_normalized_text
        as normalized_text,

      classified.ocr_text,

      coalesce(
        classified.source_normalized_text,
        classified.ocr_text,
        classified.raw_text,
        ''
      ) as display_text,

      classified.parse_status,

      classified.effective_parser_version
        as parser_version,

      coalesce(
        classified.reason_codes,
        '[]'::jsonb
      ) as reason_codes,

      coalesce(
        classified.warnings,
        '[]'::jsonb
      ) as warnings,

      (
        classified.image_storage_path
        is not null
      ) as has_image_evidence,

      coalesce(
        (
          select
            sum(
              coalesce(
                nullif(
                  item.value ->> 'quantity',
                  ''
                ),
                '0'
              )::bigint
            )
          from jsonb_array_elements(
            coalesce(
              classified.effective_items,
              '[]'::jsonb
            )
          ) item(value)
        ),
        0
      )::bigint
        as message_order_total,

      coalesce(
        classified.effective_items,
        '[]'::jsonb
      ) as items,

      classified.final_verification_status
        as verification_status,

      case
        when classified.final_verification_status
          <> 'PENDING'
          then false

        else (
          classified.parse_status
            is distinct from 'PARSED'
          or jsonb_array_length(
            coalesce(
              classified.effective_items,
              '[]'::jsonb
            )
          ) = 0
        )
      end as needs_interpretation

    from classified
  )

  select
    timeline.*
  from timeline
  where
    upper(
      coalesce(
        nullif(
          trim(p_sort_mode),
          ''
        ),
        'RECENT'
      )
    ) = 'RECENT'
  order by
    timeline.event_timestamp desc nulls last,
    timeline.message_created_at desc,
    timeline.message_record_id desc;
$$;

comment on function
  public.staff_workbench_verification_timeline(
    uuid,
    text[],
    text,
    text,
    integer,
    integer
  )
is
  'Read-only current Working Round Timeline. RECENT messages are paged before Review, Human Truth, order-item and archive enrichment.';

commit;
