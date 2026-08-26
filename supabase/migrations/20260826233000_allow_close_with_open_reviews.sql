-- v8.3 Review Workbench + Non-blocking Settlement Close
--
-- Rules:
-- 1. order_items is canonical accounting data only.
-- 2. PARTIAL / REVIEW messages must not contribute to totals.
-- 3. Closing a settlement never requires all Review items to be manually resolved.
-- 4. OPEN Review items at close become RESOLVED / DEFERRED for audit.
-- 5. Deferred Review does not mutate the closed settlement snapshot.

-- Extend Review resolution semantics without adding another top-level status.
alter table public.review_items
  drop constraint if exists review_items_resolution_type_check;

alter table public.review_items
  add constraint review_items_resolution_type_check
  check (
    resolution_type is null
    or resolution_type in ('CORRECTED','IGNORED','DEFERRED')
  );

alter table public.review_resolution_events
  drop constraint if exists review_resolution_events_action_check;

alter table public.review_resolution_events
  add constraint review_resolution_events_action_check
  check (action in ('CORRECTED','IGNORED','DEFERRED'));

-- One-time cleanup for data created before v8.3:
-- older webhook versions could persist tentative PARTIAL items into order_items.
-- Remove only canonical items belonging to still-OPEN Review/PARTIAL messages.
-- Raw message text, parser status, reason codes and Review records remain intact.
delete from public.order_items oi
using public.review_items r, public.messages m
where r.message_record_id = m.id
  and oi.message_record_id = m.id
  and r.status = 'OPEN'
  and m.parse_status in ('PARTIAL','REVIEW');

create or replace function public.close_settlement_session(
  p_session_id uuid,
  p_closed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_ready boolean;
  v_counts jsonb;
  v_deferred_reviews integer := 0;
  v_closed_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0)
  );

  select *
    into v_session
  from public.settlement_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_session.status <> 'OPEN' then
    raise exception 'SETTLEMENT_NOT_OPEN';
  end if;

  -- Review is a workbench/audit mechanism, not a close blocker.
  select count(*)::integer
    into v_deferred_reviews
  from public.review_items r
  join public.messages m
    on m.id = r.message_record_id
  where m.settlement_session_id = p_session_id
    and r.status = 'OPEN';

  if v_deferred_reviews > 0 then
    -- Preserve an explicit audit trail showing that these entries were
    -- unresolved when the operator closed the settlement.
    insert into public.review_resolution_events (
      review_id,
      message_record_id,
      action,
      original_parse_status,
      corrected_text,
      before_items,
      after_items,
      resolved_by,
      resolved_at
    )
    select
      r.id,
      m.id,
      'DEFERRED',
      m.parse_status,
      null,
      '[]'::jsonb,
      '[]'::jsonb,
      p_closed_by,
      v_closed_at
    from public.review_items r
    join public.messages m
      on m.id = r.message_record_id
    where m.settlement_session_id = p_session_id
      and r.status = 'OPEN';

    update public.review_items r
    set
      status = 'RESOLVED',
      resolved_at = v_closed_at,
      resolution_type = 'DEFERRED',
      resolved_by = p_closed_by
    where r.status = 'OPEN'
      and exists (
        select 1
        from public.messages m
        where m.id = r.message_record_id
          and m.settlement_session_id = p_session_id
      );
  end if;

  -- Actual Point may still be completed/corrected later according to the
  -- existing closed-settlement Point workflow.
  select
    actual_codes_ready,
    category_counts
  into
    v_ready,
    v_counts
  from public.session_actual_point_status
  where settlement_session_id = p_session_id;

  update public.settlement_sessions
  set
    status = 'CLOSED',
    closed_at = v_closed_at,
    closed_by = p_closed_by
  where id = p_session_id;

  return jsonb_build_object(
    'id', p_session_id,
    'business_date', v_session.business_date,
    'status', 'CLOSED',
    'closed_at', v_closed_at,
    'deferred_review_count', v_deferred_reviews,
    'point_ready', coalesce(v_ready,false),
    'special_point_counts', coalesce(v_counts,'{}'::jsonb)
  );
end;
$$;

revoke all
on function public.close_settlement_session(uuid,text)
from public, anon, authenticated;

grant execute
on function public.close_settlement_session(uuid,text)
to service_role;
