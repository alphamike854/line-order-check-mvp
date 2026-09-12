-- First-real-Round OPEN timeout hardening.
--
-- OPEN_GROUP archives parser corpus before destructive Round reset.
-- archive_parser_corpus_message(uuid) looks up child rows by message id
-- once per archived message.
--
-- These indexes are additive only:
-- - no lifecycle/Round semantics change
-- - no parser/archive semantics change
-- - no statement_timeout change
-- - no data mutation beyond index creation
--
-- They support the exact lookup predicates used by
-- archive_parser_corpus_message() and the OPEN_GROUP purge path.

create index if not exists
  review_items_message_record_id_idx
on public.review_items (
  message_record_id
);


create index if not exists
  review_resolution_events_message_record_id_idx
on public.review_resolution_events (
  message_record_id
);


create index if not exists
  unsend_events_matched_message_record_id_idx
on public.unsend_events (
  matched_message_record_id
);


create index if not exists
  message_verifications_message_record_id_idx
on public.message_verifications (
  message_record_id
);
