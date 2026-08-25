# Dashboard v5 — Open/Close Settlement + Promotion + Special Point + Daily Report

## Business rules implemented

- The operational total never carries forward after **Close settlement**.
- Closing and opening again on the same calendar date is allowed; the new settlement starts from zero.
- Each settlement keeps its own messages, order items, allocation confirmations, promotion rules, special point rules, and report.
- Promotion / Threshold overrides are set **before opening** a settlement and are frozen for that settlement.
- Default allocation rules are also snapshotted at opening so later Settings changes do not rewrite an already-open settlement.
- Special Point rules may be added/changed at any time while the settlement is OPEN. The report recalculates all messages in the current settlement using the latest rules.
- Default point is x1, but only **special point values** are subtracted from the reconciliation total.
- LINE Group reduction % is persistent. If changed while a settlement is OPEN, the current settlement uses the new % immediately; closed settlements keep their prior snapshot.
- Unsend stays available for audit but is removed from the main Summary metrics/board. Received Total still includes previously-derived quantities from unsent messages.

## Reconciliation formula per LINE Group

```
after_reduction = received_total * (1 - reduction_pct / 100)
special_point_total = Σ(special_code_quantity * multiplier)
reconciliation_total = after_reduction - special_point_total
```

Example:

```
received_total       500
reduction              5%
after_reduction       475
B02 = 10 × 20         200 special points
reconciliation_total  275
```

## Install

1. From the repository root, unzip the v5 patch over the current v4 project.
2. Run migration:

```
supabase/migrations/202608250007_add_settlement_sessions_promotions_points_reports.sql
```

in Supabase SQL Editor.

3. Run tests:

```bash
npm test
node --check netlify/functions/line-webhook.mjs
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/settlement.mjs
node --check netlify/functions/special-points.mjs
node --check netlify/functions/accounting-report.mjs
node --check netlify/functions/confirm-transfer.mjs
node --check src/lib/allocation-safety.mjs
node --check src/lib/settlement-calculations.mjs
node --check public/app.js
git diff --check
```

Expected test output includes:

```
PASS: Parser + Allocation + OCR helper smoke tests
PASS: Dashboard helper smoke tests
PASS: Review + Settings validation smoke tests
PASS: Review preview safety smoke tests
PASS: Allocation confirmation safety smoke tests
PASS: Settlement + Point + Reduction v5 smoke tests
```

4. Commit and push.

Suggested commit:

```bash
git add .
git commit -m "Add settlement lifecycle and daily reconciliation"
git push
```

## First v5 test

### A. Open a new settlement

- Dashboard should show **ยังไม่ได้เปิดยอด** after migration because legacy data is archived into closed legacy settlements.
- Click **เตรียมเปิดยอดใหม่**.
- Add a Promotion example:

```
NORTH / A01 / Threshold 200 / คลังทดสอบ
```

- Keep business date as 25 Aug 2026 and click **เปิดยอด**.
- Dashboard must start at zero.

### B. Send orders

Send normal LINE text orders. They must be attached to the currently OPEN settlement only.

### C. Special Point after orders already exist

Open **Point พิเศษ**, add:

```
B02 ×20
```

and save. Existing B02 order items in this settlement must immediately be included in the report; no need to resend messages.

### D. LINE Group reduction

Settings → LINE Group → set `ลด %`, e.g. 5.
The current OPEN settlement report should immediately use 5%. A previously CLOSED report must not change.

### E. Daily report

The report contains, per LINE Group:

- ยอดรับจริง
- ลด %
- ยอดหลังลด
- Point พิเศษ
- ยอดสุทธิเทียบ
- Summary by special code (quantity, multiplier, point)
- Message ledger: sequence, time, summarized quantity, and special-point code details only when applicable

### F. Close and reopen on the same date

Click **ปิดยอด**. Then click **เตรียมเปิดยอดใหม่** and open again with the same business date.

Expected:

- Received = 0
- Allocation confirmed = 0
- message sequence in the new report starts at 001
- old closed report remains selectable
- Promotion is configured again before opening
- Special Point starts empty and can be configured later
- LINE Group reduction % remains in Settings

## Important

Do not send production LINE orders during the short interval after deploying v5 but before opening the first settlement. Messages received while no settlement is OPEN are kept as REVIEW / SETTLEMENT_NOT_OPEN and are not counted into a later settlement automatically.
