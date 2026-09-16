-- Emergency production Dashboard read-path index.
--
-- /api/dashboard currently reads public.messages with:
--
--   settlement_session_id = ?
--   summary_group_round_id IN (...)
--   optional summary_group_id = ?
--   ORDER BY event_timestamp DESC
--   LIMIT 10000
--
-- The existing messages_settlement_idx includes line_group_id between
-- settlement_session_id and event_timestamp, so it cannot efficiently
-- serve the Dashboard's cross-line-group ordered read.
--
-- This index changes no business data and no admission/parser semantics.

create index if not exists
  messages_dashboard_session_event_idx
on public.messages (
  settlement_session_id,
  event_timestamp desc
)
include (
  summary_group_round_id,
  summary_group_id,
  parse_status
);
