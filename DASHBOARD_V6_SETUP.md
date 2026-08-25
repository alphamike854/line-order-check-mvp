# Dashboard v6 — Risk Reserve + Safe Capacity

v6 replaces the **fixed Threshold allocation UI** with a dynamic Risk/Safe-Capacity model while keeping v4/v5 audit tables for history and compatibility.

## Business rules locked in v6

- Current totals never accumulate across a closed settlement. Closing and reopening on the same calendar date starts from zero.
- LINE Group reduction % is applied to the received quantity of that LINE Group before group totals are combined.
- Special-Point multipliers are company settings and are snapshotted when a settlement is opened:
  - A ×14 — 1 possible special code
  - B ×14 — 1 possible special code
  - E ×100 — 1 possible special code
  - F ×20 — up to 6 possible special codes
  - G ×20 — 4 possible special codes
- While the settlement is OPEN, the system does **not need the actual special codes** for warehouse safety.
- Point Reserve uses a worst-case selection by Point exposure:
  - A/B/E: highest 1 code
  - F: highest 6 codes
  - G: highest 4 codes
- Point exposure uses RAW order quantity before reduction.
- Promotion is configured before opening and means a percentage of the category special multiplier. Example: E ×100 + E125 Promotion 50% => E125 exposure is calculated at ×50 if it becomes a special code.
- Safe Capacity while OPEN always uses Point Reserve, even after actual special codes are entered. This keeps warehouse cutting conservative.
- Actual special codes are entered before closing for the final accounting report.
- The final accounting report uses actual special Point, not Point Reserve.

## Safe Capacity formula

For each Summary Group:

```text
Adjusted Received
= sum(each LINE Group quantity × (1 - reduction_pct / 100))

Point Reserve
= sum(worst-case Point exposure for A/B/E/F/G)

Net Safe Capacity
= Adjusted Received - Point Reserve

Remaining Safe Capacity
= max(0, Net Safe Capacity - confirmed warehouse cuts)
```

Category risk is calculated separately for diagnostics, while the overall Safe Capacity is the operational ceiling for warehouse cuts.

## Installation from v4

This v6 cumulative patch contains v5 and v6 changes. Run migrations in order:

1. `supabase/migrations/202608250007_add_settlement_sessions_promotions_points_reports.sql`
2. `supabase/migrations/202608250008_add_risk_reserve_safe_capacity.sql`

If migration `007` has already been run, run only `008`.

## Required environment variables

No new environment variable is required. Existing:

- `DASHBOARD_ACCESS_KEY`
- `DASHBOARD_OPERATOR_NAME` (optional)

The risk transfer confirmation token uses `DASHBOARD_ACCESS_KEY` unless `RISK_TRANSFER_SIGNING_KEY` is explicitly added later.

## Tests

```bash
npm test
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/settlement.mjs
node --check netlify/functions/special-points.mjs
node --check netlify/functions/accounting-report.mjs
node --check netlify/functions/risk-transfer-preview.mjs
node --check netlify/functions/risk-transfer-confirm.mjs
node --check netlify/functions/allocation-history.mjs
node --check netlify/functions/dashboard-freshness.mjs
node --check src/lib/risk-engine.mjs
node --check src/lib/risk-transfer-safety.mjs
node --check public/app.js
git diff --check
```

Expected test tail:

```text
PASS: Parser + Allocation + OCR helper smoke tests
PASS: Dashboard helper smoke tests
PASS: Review + Settings validation smoke tests
PASS: Review preview safety smoke tests
PASS: Allocation confirmation safety smoke tests
PASS: Settlement + Point + Reduction v5 smoke tests
PASS: Risk reserve + safe capacity v6 smoke tests
```

## First operational test

1. Close any test settlement that should not be reused.
2. In Settings confirm company Point profiles:
   - A 14 / max 1
   - B 14 / max 1
   - E 100 / max 1
   - F 20 / max 6
   - G 20 / max 4
3. Prepare a new settlement.
4. Optionally add a Promotion, e.g. `E125 = 50%`.
5. Open the settlement.
6. Send several LINE orders.
7. Order Board should show 4 columns A/B/E/F, with G below only when it has orders.
8. A/B must show codes 00–99 including zero rows; E/F/G show only received codes.
9. Check each category header for Received, Adjusted, Reserve, Safe, Risk and order share.
10. Select one Summary Group before using the cut screen.
11. Enter quantities to cut. Total must not exceed Remaining Safe Capacity.
12. Preview. A01+B01 should compact to `AB 01=...*...`.
13. Confirm and verify that the batch appears once in Transfer History.
14. Add new LINE orders and verify Safe Capacity changes dynamically.

## Actual Point before closing

The Point tab is for **actual special codes** used by the final accounting report.

Required before closing:

- A: exactly 1
- B: exactly 1
- E: exactly 1
- G: exactly 4
- F: 0–6 (the operator confirms the final F list before closing)

The close action is blocked until A/B/E/G are complete. Closed reports do not change afterward.
