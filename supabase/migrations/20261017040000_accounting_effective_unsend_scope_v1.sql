-- LOC Accounting UNSEND Scoped Lookup V1 -- 2026-10-17
-- BASELINE COMMIT: 074a1c20ea5cac9656339df6ad5b42a9b72e2610
-- FIXED SOURCE: 20260923180000_exclude_unsent_from_accounting_report.sql
-- ONE CREATE OR REPLACE FUNCTION; no data mutation, table/index/privilege changes.
-- Scope and Human Truth source are inherited verbatim; only UNSEND filtering changes.
-- This is a targeted optimization candidate. Performance benefit requires measurement.
begin;

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
         effective.message_record_id

  -- Each candidate has already passed the session, LINE Group and Round
  -- scope. Test UNSEND against that precise message id; do not materialize
  -- a global list of unsent messages for each accounting request.
  where not exists (
    select 1
    from public.messages message
    where message.id = effective.message_record_id
      and message.unsent = true
  )
  and not exists (
    select 1
    from public.unsend_events unsend
    where unsend.matched_message_record_id = effective.message_record_id
  );
$$;

comment on function public.accounting_effective_order_items_rounds(uuid,uuid[],text[])
is 'Round-scoped effective accounting truth, preserving human precedence and UNSEND exclusion with candidate-message lookup instead of an unscoped UNSEND CTE.';

commit;
