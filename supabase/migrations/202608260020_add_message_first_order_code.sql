-- v8.0: preserve a compact first-code hint for daily accounting reports.
-- The original message text may be cleared on LINE unsend; this field keeps
-- the non-sensitive derived code needed by the frozen ledger.
alter table public.messages
  add column if not exists first_order_code text;

comment on column public.messages.first_order_code is
  'Derived first order code shown in the daily accounting ledger; source text may later be cleared.';

-- Historical messages are intentionally not rewritten here. The report derives
-- their first code from the retained source text and falls back to order_items.
-- New messages and corrected Review items populate first_order_code in the app,
-- so future LINE Unsend events can clear source text without losing this cue.
