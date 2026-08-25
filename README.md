# LINE Order Check MVP — Netlify + Supabase

## Architecture

LINE Messaging API → Netlify Function `/api/line-webhook` → deterministic Parser v1 → Supabase Postgres.

Phase 1 implements:
- LINE webhook signature verification
- Group-only processing
- Webhook idempotency using `webhookEventId`
- Text parser
- Canonical `order_items`
- REVIEW queue
- UNSEND audit while keeping received totals
- Summary and allocation views
- Image events are captured into REVIEW for Phase 2 OCR

## 1) Create Supabase project

Open SQL Editor and run:

`supabase/migrations/202608240001_initial_line_order_mvp.sql`

Then insert your real LINE group mapping, for example:

```sql
insert into public.line_groups (
  line_group_id,
  line_group_name,
  summary_group_id
) values (
  'Cxxxxxxxxxxxxxxxx',
  'กลุ่มทดลองภาคเหนือ',
  'NORTH'
);
```

Add allocation rules only after the group mapping is correct.

## 2) Create Netlify project

Push this folder to GitHub/GitLab and import the repository into Netlify, or deploy with Netlify CLI.

Required environment variables in Netlify:

- `LINE_CHANNEL_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (new `sb_secret_...` backend key; never expose in browser)

The deployed webhook endpoint is:

`https://YOUR-SITE.netlify.app/api/line-webhook`

## 3) Configure LINE Developers

In the Messaging API channel:
- Set Webhook URL to the Netlify endpoint
- Enable `Use webhook`
- Ensure the bot is allowed to join group chats
- Use the matching Channel Secret in Netlify

## 4) First test

Send in the configured LINE group:

`01=20`

Expected database state:
- `webhook_events`: 1 row
- `messages`: 1 row with `parse_status = PARSED`
- `order_items`: 1 row, `A / 01 / 20`

Then test:

```text
AB
01
02
03=20
```

Expected `order_items`: 6 rows.

Then test invalid grammar:

`123=20x4`

Expected:
- `messages.parse_status = REVIEW`
- `review_items`: 1 row
- no guessed order items

## 5) UNSEND behavior

When the original message is unsent:
- `messages.unsent = true`
- original raw/normalized text is cleared
- `order_items.unsent_flag = true`
- quantities remain in `current_summary.order_total`
- `current_summary.unsent_qty` shows the unsent contribution
- `unsend_events` records derived impact

## 6) What is intentionally deferred

Phase 2:
- LINE image download
- OCR / Vision
- image text → same Parser v1
- Dashboard UI
- authentication
- confirmation UI for allocation transfers

## Security notes

- Keep `SUPABASE_SECRET_KEY` and `LINE_CHANNEL_SECRET` only in Netlify environment variables.
- Do not put backend secret keys in frontend code or Git.
- Internal tables have RLS enabled and no anon/authenticated policies in this MVP.

## Dashboard MVP

After migrations `001`, `002`, and `003`, Netlify also serves a protected dashboard at `/`.

Required additional environment variable:

- `DASHBOARD_ACCESS_KEY`

Optional:

- `DASHBOARD_OPERATOR_NAME`

See `DASHBOARD_SETUP.md` for deployment and testing steps.

## Dashboard v6 — Risk foundation

Migrations `007` + `008` add settlement reset, Point Reserve, Promotion factors, actual Point codes, 4-column Order Board, and atomic warehouse transfer foundations. Later migrations keep the original Safe Capacity columns only for schema compatibility; current operational risk uses retained warehouse exposure and Risk Budget.

## v6.3 — Friendly already-open settlement recovery
Duplicate/open-race requests no longer expose `SETTLEMENT_ALREADY_OPEN` directly to the operator. The dashboard refreshes the active settlement, shows a Thai explanation, and focuses the current settlement panel. No database migration is required.


## v6.5 — Risk policy recommended cut
Safety Margin is now correctly treated as a diagnostic buffer, not a warehouse-cut cap. Migration `011` adds editable Risk → Cut % policy bands and computes `Recommended Cut` from Adjusted Received. Transfer confirmation is capped by `Remaining Recommended Cut` and rechecked atomically. See `DASHBOARD_V6_5_SETUP.md`.


## v6.6 — Dynamic Risk Budget + warehouse distribution rounds
Migration `012` supersedes the v6.5 Risk→Cut% experiment. Current operational logic is:

- `Risk Budget = Adjusted Received + accepted Point loss tolerance`
- Point Reserve is calculated from quantity still retained by our warehouse (`Received - confirmed transfer out`)
- if Point Reserve exceeds Risk Budget, the server dynamically simulates how many units should be distributed out
- reserve candidates are re-ranked after each unit in the simulation (A/B/E top 1, F top 6, G top 4)
- each destination warehouse has a configurable maximum quantity per transfer round
- every confirmed round is atomic/stale-safe, then the system recalculates before the next round

Example: Adjusted=60, accepted loss=10, A01=35 at x7 → Risk Budget=70, retain target=10, distribute target=25. If the destination limit is 5/round, the current plan requires 5 rounds, with a fresh risk calculation after every confirmation.

Migration `011` remains in history because it may already have been applied, but its Risk→Cut% bands are no longer used to authorize v6.6 transfers.

## Dashboard v6.7

- Point multiplier edits apply immediately to the current OPEN settlement; CLOSED reports keep their snapshot.
- Allocation uses a Summary-like A/B/E/F board (G below), preselects recommended codes, supports multiple warehouses, and automatically splits one approved distribution into bounded warehouse rounds.
- See `DASHBOARD_V6_7_SETUP.md` and migration `202608250013_sync_live_point_profiles_and_bulk_distribution.sql`.
