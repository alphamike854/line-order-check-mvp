-- ============================================================
-- Durable accounting timestamp for Human Verification
--
-- verified_at is the Staff decision time, not the original
-- order/message event time. Preserve the original timestamp before
-- operational messages can later be purged.
-- ============================================================

alter table public.message_verifications
  add column if not exists
    source_event_timestamp timestamptz;


update public.message_verifications verification
set
  source_event_timestamp =
    message.event_timestamp
from public.messages message
where
  message.id =
    verification.message_record_id
  and verification.source_event_timestamp
      is null;


-- ============================================================
-- One-time legacy Human Verification timestamp recovery.
--
-- These four original LINE event timestamps were captured by the
-- Phase 5F production SELECT-only audit before the corresponding
-- operational messages were purged.
--
-- Never substitute verified_at: it is Staff decision time, not
-- original order/message time.
-- ============================================================

with legacy_verification_event_timestamp (
  message_record_id,
  event_timestamp
) as (
  values
    (
      '09e7f802-c6f8-49bf-88bd-7eb46965c806'::uuid,
      timestamptz '2026-09-07 09:05:21.179+00'
    ),
    (
      '26c8441f-0588-461a-8863-0b8c2596b462'::uuid,
      timestamptz '2026-09-07 09:22:32.370+00'
    ),
    (
      '713ab863-84a4-455f-ad2e-5da23db13e56'::uuid,
      timestamptz '2026-09-07 09:27:34.906+00'
    ),
    (
      'c80c78ac-c1f3-42e9-8f7a-468124bc1fc8'::uuid,
      timestamptz '2026-09-07 09:44:07.990+00'
    )
)

update public.message_verifications verification

set
  source_event_timestamp =
    legacy.event_timestamp

from legacy_verification_event_timestamp legacy

where
  verification.message_record_id =
    legacy.message_record_id

  and verification.source_event_timestamp
      is null;


do $$
begin
  if exists (
    select 1
    from public.message_verifications
    where source_event_timestamp
          is null
  ) then
    raise exception
      'MESSAGE_VERIFICATION_EVENT_TIMESTAMP_BACKFILL_FAILED';
  end if;
end
$$;


alter table public.message_verifications
  alter column source_event_timestamp
    set not null;


comment on column
  public.message_verifications.source_event_timestamp
is
  'Original LINE message event timestamp preserved as durable Human Truth metadata. This is intentionally distinct from verified_at.';


create or replace function
  public.populate_message_verification_durable_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message
    public.messages%rowtype;
begin
  if new.message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      new.message_record_id;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id is null
    or v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
    or v_message.line_group_id is null
    or v_message.business_date is null
    or v_message.event_timestamp is null
  then
    raise exception
      'MESSAGE_VERIFICATION_CONTEXT_REQUIRED';
  end if;


  new.settlement_session_id :=
    v_message.settlement_session_id;

  new.summary_group_id :=
    v_message.summary_group_id;

  new.summary_group_round_id :=
    v_message.summary_group_round_id;

  new.line_group_id :=
    v_message.line_group_id;

  new.business_date :=
    v_message.business_date;

  new.source_event_timestamp :=
    v_message.event_timestamp;


  if new.verified_first_order_code is null then
    new.verified_first_order_code :=
      v_message.first_order_code;
  end if;


  return new;
end;
$$;


-- Reporting-only Human Truth overlay.
--
-- Operational order_items belonging to CLOSED Rounds remain immutable.
-- Risk / transfer / settlement state continues to consume operational
-- canonical order_items.
--
-- Accounting precedence:
--
--   1. resolved post-close review
--        CORRECTED -> post_close_items
--        IGNORED   -> zero rows
--
--   2. message verification
--        CONFIRMED / CORRECTED -> verified_order_items
--
--   3. otherwise
--        canonical order_items
--
-- Resolved post-close truth deliberately wins if both durable truth
-- sources ever coexist for one message.

create or replace function
  public.accounting_effective_order_items(
    p_session_id uuid,
    p_line_group_ids text[] default null
  )
returns table (
  message_record_id uuid,
  line_group_id text,
  summary_group_id text,
  category text,
  code text,
  quantity bigint,
  truth_source text
)
language sql
stable
security definer
set search_path = public
as $$
  with resolved_post_close as (
    select distinct on (
      archive.source_message_record_id
    )
      archive.source_message_record_id
        as message_record_id,

      archive.line_group_id,
      archive.summary_group_id,

      archive.post_close_resolution_type,
      archive.post_close_items

    from public.post_close_review_archive archive

    where
      archive.settlement_session_id =
        p_session_id

      and archive.post_close_resolution_type
          is not null

      and (
        p_line_group_ids is null
        or archive.line_group_id =
           any(p_line_group_ids)
      )

    order by
      archive.source_message_record_id,
      archive.post_close_resolved_at
        desc nulls last,
      archive.updated_at desc,
      archive.id desc
  ),

  verification_truth as (
    select
      verification.message_record_id,
      verification.line_group_id,
      verification.summary_group_id,
      verification.verification_mode,
      verification.verified_order_items

    from public.message_verifications verification

    where
      verification.settlement_session_id =
        p_session_id

      and (
        p_line_group_ids is null
        or verification.line_group_id =
           any(p_line_group_ids)
      )
  )


  -- ----------------------------------------------------------
  -- Highest precedence:
  -- resolved post-close CORRECTED Human Truth.
  --
  -- IGNORED deliberately emits zero rows, while the existence
  -- of its resolved archive suppresses every lower source.
  -- ----------------------------------------------------------
  select
    post_close.message_record_id,
    post_close.line_group_id,
    post_close.summary_group_id,

    upper(
      btrim(
        item.value ->> 'category'
      )
    ) as category,

    btrim(
      item.value ->> 'code'
    ) as code,

    (
      item.value ->> 'quantity'
    )::bigint
      as quantity,

    'POST_CLOSE_CORRECTED'::text
      as truth_source

  from resolved_post_close post_close

  cross join lateral
    jsonb_array_elements(
      post_close.post_close_items
    ) item(value)

  where
    post_close.post_close_resolution_type =
      'CORRECTED'


  union all


  -- ----------------------------------------------------------
  -- Verification Human Truth.
  --
  -- Durable verification identity is independent of the
  -- operational messages table after creation.
  -- ----------------------------------------------------------
  select
    verification.message_record_id,
    verification.line_group_id,
    verification.summary_group_id,

    upper(
      btrim(
        item.value ->> 'category'
      )
    ) as category,

    btrim(
      item.value ->> 'code'
    ) as code,

    (
      item.value ->> 'quantity'
    )::bigint
      as quantity,

    (
      'VERIFICATION_'
      || verification.verification_mode
    )::text
      as truth_source

  from verification_truth verification

  cross join lateral
    jsonb_array_elements(
      verification.verified_order_items
    ) item(value)

  where not exists (
    select 1
    from resolved_post_close post_close
    where
      post_close.message_record_id =
        verification.message_record_id
  )


  union all


  -- ----------------------------------------------------------
  -- Lowest precedence:
  -- operational canonical order_items.
  --
  -- This branch also requires no messages scan. order_items
  -- already carry settlement and LINE Group ownership.
  -- ----------------------------------------------------------
  select
    item.message_record_id,
    item.line_group_id,
    item.summary_group_id,
    item.category,
    item.code,
    item.quantity::bigint,
    'CANONICAL'::text
      as truth_source

  from public.order_items item

  where
    item.settlement_session_id =
      p_session_id

    and (
      p_line_group_ids is null
      or item.line_group_id =
         any(p_line_group_ids)
    )

    and not exists (
      select 1
      from resolved_post_close post_close
      where
        post_close.message_record_id =
          item.message_record_id
    )

    and not exists (
      select 1
      from verification_truth verification
      where
        verification.message_record_id =
          item.message_record_id
    );
$$;


revoke all
on function
  public.accounting_effective_order_items(
    uuid,
    text[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_effective_order_items(
    uuid,
    text[]
  )
to service_role;


-- ============================================================
-- Durable accounting message projection
--
-- Full ledger metadata follows the same Human Truth precedence
-- as accounting_effective_order_items().
--
-- Post-close and Verification branches do not require the
-- operational messages row to continue existing.
--
-- Canonical rows continue to use messages for original metadata.
-- ============================================================

create or replace function
  public.accounting_effective_order_messages(
    p_session_id uuid,
    p_line_group_ids text[] default null
  )
returns table (
  id uuid,
  line_group_id text,
  event_timestamp timestamptz,
  raw_text text,
  normalized_text text,
  ocr_text text,
  first_order_code text,
  message_truth_source text
)
language sql
stable
security definer
set search_path = public
as $$
  with resolved_post_close as (
    select distinct on (
      archive.source_message_record_id
    )
      archive.source_message_record_id
        as message_record_id,

      archive.line_group_id,
      archive.event_timestamp,
      archive.raw_text,
      archive.normalized_text,
      archive.ocr_text,

      archive.post_close_resolution_type,
      archive.post_close_corrected_text,
      archive.post_close_normalized_text

    from public.post_close_review_archive archive

    where
      archive.settlement_session_id =
        p_session_id

      and archive.post_close_resolution_type
          is not null

      and (
        p_line_group_ids is null
        or archive.line_group_id =
           any(p_line_group_ids)
      )

    order by
      archive.source_message_record_id,
      archive.post_close_resolved_at
        desc nulls last,
      archive.updated_at desc,
      archive.id desc
  ),

  verification_truth as (
    select
      verification.message_record_id,
      verification.line_group_id,

      verification.source_event_timestamp,
      verification.verification_mode,

      verification.corrected_text,
      verification.verified_normalized_text,
      verification.verified_first_order_code

    from public.message_verifications verification

    where
      verification.settlement_session_id =
        p_session_id

      and (
        p_line_group_ids is null
        or verification.line_group_id =
           any(p_line_group_ids)
      )
  ),

  effective_message_ids as (
    select distinct
      item.message_record_id,
      item.line_group_id

    from public.accounting_effective_order_items(
      p_session_id,
      p_line_group_ids
    ) item
  )


  -- ----------------------------------------------------------
  -- Highest precedence:
  -- resolved post-close CORRECTED metadata.
  --
  -- IGNORED has no effective item rows and therefore cannot
  -- enter the accounting ledger.
  -- ----------------------------------------------------------
  select
    post_close.message_record_id
      as id,

    post_close.line_group_id,

    post_close.event_timestamp,

    coalesce(
      post_close.post_close_corrected_text,
      post_close.raw_text
    ) as raw_text,

    coalesce(
      post_close.post_close_normalized_text,
      post_close.normalized_text
    ) as normalized_text,

    post_close.ocr_text,

    null::text
      as first_order_code,

    'POST_CLOSE_CORRECTED'::text
      as message_truth_source

  from resolved_post_close post_close

  join effective_message_ids effective
    on effective.message_record_id =
       post_close.message_record_id
    and effective.line_group_id =
        post_close.line_group_id

  where
    post_close.post_close_resolution_type =
      'CORRECTED'


  union all


  -- ----------------------------------------------------------
  -- Verification Human Truth metadata.
  --
  -- source_event_timestamp is the original order/message time.
  -- verified_at must never substitute for this value.
  -- ----------------------------------------------------------
  select
    verification.message_record_id
      as id,

    verification.line_group_id,

    verification.source_event_timestamp
      as event_timestamp,

    verification.corrected_text
      as raw_text,

    verification.verified_normalized_text
      as normalized_text,

    null::text
      as ocr_text,

    verification.verified_first_order_code
      as first_order_code,

    (
      'VERIFICATION_'
      || verification.verification_mode
    )::text
      as message_truth_source

  from verification_truth verification

  join effective_message_ids effective
    on effective.message_record_id =
       verification.message_record_id
    and effective.line_group_id =
        verification.line_group_id

  where
    not exists (
      select 1
      from resolved_post_close post_close
      where
        post_close.message_record_id =
          verification.message_record_id
    )


  union all


  -- ----------------------------------------------------------
  -- Canonical fallback.
  --
  -- Operational messages remain the authoritative source for
  -- metadata while no Human Truth supersedes the message.
  -- ----------------------------------------------------------
  select
    message.id,
    message.line_group_id,
    message.event_timestamp,
    message.raw_text,
    message.normalized_text,
    message.ocr_text,
    message.first_order_code,
    'CANONICAL'::text
      as message_truth_source

  from public.messages message

  join effective_message_ids effective
    on effective.message_record_id =
       message.id
    and effective.line_group_id =
        message.line_group_id

  where
    message.settlement_session_id =
      p_session_id

    and (
      p_line_group_ids is null
      or message.line_group_id =
         any(p_line_group_ids)
    )

    and not exists (
      select 1
      from resolved_post_close post_close
      where
        post_close.message_record_id =
          message.id
    )

    and not exists (
      select 1
      from verification_truth verification
      where
        verification.message_record_id =
          message.id
    );
$$;


revoke all
on function
  public.accounting_effective_order_messages(
    uuid,
    text[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_effective_order_messages(
    uuid,
    text[]
  )
to service_role;


-- ============================================================
-- Accounting summary fast path
--
-- Consume the same effective Human Truth source used by the
-- full ledger path.
-- ============================================================

create or replace function
  public.accounting_report_line_group_summary(
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
      cfg.reduction_pct::numeric
        as reduction_pct
    from public.settlement_line_group_config cfg
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
    from public.accounting_effective_order_items(
      p_session_id,
      null::text[]
    )
  ),

  item_values as (
    select
      cfg.line_group_id,
      cfg.line_group_name,
      cfg.summary_group_id,
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

    left join public.settlement_point_profiles profile
      on profile.settlement_session_id =
         p_session_id
      and profile.category =
          item.category

    left join public.settlement_point_promotions promotion
      on promotion.settlement_session_id =
         p_session_id
      and promotion.summary_group_id =
          cfg.summary_group_id
      and promotion.category =
          item.category
      and promotion.code =
          item.code

    left join
      public.settlement_summary_group_actual_special_point_codes
        actual_code
      on actual_code.settlement_session_id =
         p_session_id
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
  public.accounting_report_line_group_summary(
    uuid,
    text
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_report_line_group_summary(
    uuid,
    text
  )
to service_role;
