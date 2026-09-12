-- DR1D-D1B1A
-- Round-scoped Accounting read-model foundation.
--
-- Contract:
--   1. Parent settlement_session is compatibility/config only.
--   2. Accounting operational truth is explicitly scoped by
--      settlement_summary_group_rounds.id.
--   3. One selected current Round per Summary Group.
--   4. Durable post-close Human Truth and message verification stay usable,
--      but only when they belong to a selected Round.
--   5. Actual special Point codes and Promotion are Round-owned.
--   6. No legacy Point/Promotion fallback is permitted for selected Rounds.
--   7. Existing Accounting RPCs remain unchanged for compatibility.
--   8. This migration is additive/read-only. It changes no lifecycle writes.


-- ============================================================
-- 1. Fail-closed Accounting Round scope
-- ============================================================

create or replace function
  public.accounting_round_scope(
    p_session_id uuid,
    p_round_ids uuid[]
  )
returns table (
  round_id uuid,
  settlement_session_id uuid,
  summary_group_id text,
  business_date date,
  daily_round_no integer,
  round_no integer,
  round_status text,
  opened_at timestamptz,
  closed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_found_count integer;
  v_group_count integer;
begin
  if p_session_id is null then
    raise exception
      'ACCOUNTING_SESSION_REQUIRED';
  end if;

  if coalesce(
    cardinality(p_round_ids),
    0
  ) = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_round_ids) value(round_id)
    where value.round_id is null
  ) then
    raise exception
      'ACCOUNTING_ROUND_ID_REQUIRED';
  end if;

  select
    count(distinct value.round_id)::integer
  into
    v_requested_count
  from unnest(p_round_ids) value(round_id);

  if v_requested_count
       <> cardinality(p_round_ids) then
    raise exception
      'ACCOUNTING_DUPLICATE_ROUND_ID';
  end if;

  select
    count(*)::integer,
    count(
      distinct r.summary_group_id
    )::integer
  into
    v_found_count,
    v_group_count
  from
    public.settlement_summary_group_rounds r
  where
    r.id = any(p_round_ids)
    and r.settlement_session_id =
      p_session_id
    and r.status in (
      'OPEN',
      'CLOSED'
    );

  if v_found_count
       <> v_requested_count then
    raise exception
      'ACCOUNTING_ROUND_SCOPE_INVALID';
  end if;

  if v_group_count
       <> v_requested_count then
    raise exception
      'ACCOUNTING_MULTIPLE_ROUNDS_PER_SUMMARY_GROUP';
  end if;

  -- Current Accounting must never silently read an archived/purged Round.
  -- Full historical ledger reconstruction is a separate future feature.
  if exists (
    select 1
    from
      public.settlement_summary_group_round_snapshots snapshot
    where
      snapshot.round_id =
        any(p_round_ids)
  ) then
    raise exception
      'ACCOUNTING_ROUND_ARCHIVED';
  end if;

  -- A selected Round must be the latest incarnation of its Summary Group.
  -- After CLOSE it remains current until a newer Round is opened.
  if exists (
    select 1
    from
      public.settlement_summary_group_rounds selected
    join
      public.settlement_summary_group_rounds newer
        on newer.summary_group_id =
             selected.summary_group_id
       and newer.settlement_session_id =
             selected.settlement_session_id
       and newer.round_no >
             selected.round_no
    where
      selected.id =
        any(p_round_ids)
  ) then
    raise exception
      'ACCOUNTING_ROUND_NOT_CURRENT';
  end if;

  return query
  select
    r.id
      as round_id,
    r.settlement_session_id,
    r.summary_group_id,
    r.business_date,
    r.daily_round_no,
    r.round_no,
    r.status
      as round_status,
    r.opened_at,
    r.closed_at
  from
    public.settlement_summary_group_rounds r
  where
    r.id = any(p_round_ids)
    and r.settlement_session_id =
      p_session_id
  order by
    r.summary_group_id;
end;
$$;


revoke all
on function
  public.accounting_round_scope(
    uuid,
    uuid[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_round_scope(
    uuid,
    uuid[]
  )
to service_role;


comment on function
  public.accounting_round_scope(
    uuid,
    uuid[]
  )
is
  'Fail-closed current Accounting Round boundary. One latest non-archived OPEN/CLOSED Round per Summary Group.';


-- ============================================================
-- 2. Round-scoped effective Accounting items
--
-- Preserve the already-proven Human Truth precedence inside
-- accounting_effective_order_items(), then constrain the result
-- to immutable message identities owned by selected Rounds.
-- ============================================================

create or replace function
  public.accounting_effective_order_items_rounds(
    p_session_id uuid,
    p_round_ids uuid[],
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
  with selected_rounds as (
    select *
    from public.accounting_round_scope(
      p_session_id,
      p_round_ids
    )
  ),

  selected_message_ids as (
    -- Durable resolved Post-close Review truth.
    select distinct
      archive.source_message_record_id
        as message_record_id
    from
      public.post_close_review_archive archive
    join selected_rounds round_scope
      on round_scope.round_id =
           archive.round_id

    union

    -- Durable Human Verification truth.
    select distinct
      verification.message_record_id
    from
      public.message_verifications verification
    join selected_rounds round_scope
      on round_scope.round_id =
           verification.summary_group_round_id

    union

    -- Current operational canonical truth.
    select distinct
      item.message_record_id
    from
      public.order_items item
    join selected_rounds round_scope
      on round_scope.round_id =
           item.summary_group_round_id
  )

  select
    effective.message_record_id,
    effective.line_group_id,
    effective.summary_group_id,
    effective.category,
    effective.code,
    effective.quantity,
    effective.truth_source
  from
    public.accounting_effective_order_items(
      p_session_id,
      p_line_group_ids
    ) effective
  join selected_message_ids selected
    on selected.message_record_id =
         effective.message_record_id;
$$;


revoke all
on function
  public.accounting_effective_order_items_rounds(
    uuid,
    uuid[],
    text[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_effective_order_items_rounds(
    uuid,
    uuid[],
    text[]
  )
to service_role;


comment on function
  public.accounting_effective_order_items_rounds(
    uuid,
    uuid[],
    text[]
  )
is
  'Accounting effective items constrained to explicit current Summary Group Round IDs while preserving existing Human Truth precedence.';


-- ============================================================
-- 3. Round-scoped effective Accounting message metadata
-- ============================================================

create or replace function
  public.accounting_effective_order_messages_rounds(
    p_session_id uuid,
    p_round_ids uuid[],
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
  with selected_effective_messages as (
    select distinct
      item.message_record_id
    from
      public.accounting_effective_order_items_rounds(
        p_session_id,
        p_round_ids,
        p_line_group_ids
      ) item
  )

  select
    message.id,
    message.line_group_id,
    message.event_timestamp,
    message.raw_text,
    message.normalized_text,
    message.ocr_text,
    message.first_order_code,
    message.message_truth_source
  from
    public.accounting_effective_order_messages(
      p_session_id,
      p_line_group_ids
    ) message
  join selected_effective_messages selected
    on selected.message_record_id =
         message.id;
$$;


revoke all
on function
  public.accounting_effective_order_messages_rounds(
    uuid,
    uuid[],
    text[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_effective_order_messages_rounds(
    uuid,
    uuid[],
    text[]
  )
to service_role;


comment on function
  public.accounting_effective_order_messages_rounds(
    uuid,
    uuid[],
    text[]
  )
is
  'Accounting message metadata constrained to explicit current Summary Group Round IDs and effective order-bearing messages.';


-- ============================================================
-- 4. Round-owned Point / Promotion context
--
-- IMPORTANT BUSINESS INVARIANT:
--   Actual special Point selection and Promotion belong to the
--   exact Round in which they were configured.
--
-- No previous-Round value may be inherited merely because the
-- parent settlement_session is the same.
--
-- The existing current-Round projections are used because they
-- already enforce Round lineage and expose exact round_id.
--
-- settlement_point_profiles remains the base category-policy
-- snapshot (multiplier / maximum special codes). It is NOT an
-- actual special-code selection or Promotion result.
-- ============================================================

create or replace function
  public.accounting_round_point_context(
    p_session_id uuid,
    p_round_ids uuid[]
  )
returns jsonb
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

  round_payload as (
    select
      coalesce(
        jsonb_agg(
          to_jsonb(round_scope)
          order by
            round_scope.summary_group_id
        ),
        '[]'::jsonb
      ) as value
    from selected_rounds round_scope
  ),

  profile_payload as (
    select
      coalesce(
        jsonb_agg(
          to_jsonb(profile)
          order by
            profile.category
        ),
        '[]'::jsonb
      ) as value
    from
      public.settlement_point_profiles profile
    where
      profile.settlement_session_id =
        p_session_id
  ),

  promotion_payload as (
    select
      coalesce(
        jsonb_agg(
          to_jsonb(promotion)
          order by
            promotion.summary_group_id,
            promotion.category,
            promotion.code
        ),
        '[]'::jsonb
      ) as value
    from
      public.settlement_summary_group_point_promotions_current
        promotion
    join selected_rounds round_scope
      on round_scope.round_id =
           promotion.round_id
    where
      promotion.settlement_session_id =
        p_session_id
  ),

  actual_payload as (
    select
      coalesce(
        jsonb_agg(
          to_jsonb(actual)
          order by
            actual.summary_group_id,
            actual.category,
            actual.code
        ),
        '[]'::jsonb
      ) as value
    from
      public.settlement_summary_group_actual_special_point_codes_current
        actual
    join selected_rounds round_scope
      on round_scope.round_id =
           actual.round_id
    where
      actual.settlement_session_id =
        p_session_id
  )

  select
    jsonb_build_object(
      'rounds',
        round_payload.value,
      'point_profiles',
        profile_payload.value,
      'promotions',
        promotion_payload.value,
      'actual_special_point_codes',
        actual_payload.value
    )
  from
    round_payload,
    profile_payload,
    promotion_payload,
    actual_payload;
$$;


revoke all
on function
  public.accounting_round_point_context(
    uuid,
    uuid[]
  )
from public, anon, authenticated;

grant execute
on function
  public.accounting_round_point_context(
    uuid,
    uuid[]
  )
to service_role;


comment on function
  public.accounting_round_point_context(
    uuid,
    uuid[]
  )
is
  'Exact Round-owned Accounting Point context. Actual special Point codes and Promotion never inherit from another Round.';


-- ============================================================
-- 5. Explicit privilege boundary
-- ============================================================

revoke all
on function
  public.accounting_round_scope(
    uuid,
    uuid[]
  )
from anon, authenticated;

revoke all
on function
  public.accounting_effective_order_items_rounds(
    uuid,
    uuid[],
    text[]
  )
from anon, authenticated;

revoke all
on function
  public.accounting_effective_order_messages_rounds(
    uuid,
    uuid[],
    text[]
  )
from anon, authenticated;

revoke all
on function
  public.accounting_round_point_context(
    uuid,
    uuid[]
  )
from anon, authenticated;
