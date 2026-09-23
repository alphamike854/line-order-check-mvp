-- Accounting Report UNSEND exclusion
--
-- Business rule:
--   LINE UNSEND remains durable audit/history evidence,
--   but an UNSEND order is not an effective Accounting order.
--
-- Scope:
--   Round-scoped Accounting read model only.
--
-- Effects:
--   - no operational order/message deletion
--   - no mutation of UNSEND evidence
--   - Full Ledger excludes UNSEND
--   - Summary excludes UNSEND
--   - Point calculations exclude UNSEND
--   - CSV inherits the same effective ledger
--
-- The legacy non-Round effective read model remains unchanged.

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
  ),

  /*
   * UNSEND is operationally cancelled truth.
   *
   * messages.unsent is the authoritative live-message state.
   * unsend_events provides the durable matched UNSEND evidence
   * while the operational Round data still exists.
   *
   * Either source is sufficient to exclude the message from
   * Accounting effective truth.
   */
  unsent_message_ids as (

    select
      message.id
        as message_record_id
    from
      public.messages message
    where
      message.unsent = true

    union

    select
      unsend.matched_message_record_id
        as message_record_id
    from
      public.unsend_events unsend
    where
      unsend.matched_message_record_id
        is not null
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
         effective.message_record_id

  where not exists (
    select 1
    from unsent_message_ids unsent
    where
      unsent.message_record_id =
        effective.message_record_id
  );
$$;


comment on function
  public.accounting_effective_order_items_rounds(
    uuid,
    uuid[],
    text[]
  )
is
  'Round-scoped effective Accounting items. Preserves Human Truth precedence while excluding LINE UNSEND messages from Ledger, Summary, Point and CSV accounting truth.';
