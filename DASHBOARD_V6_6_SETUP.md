# Dashboard v6.6 — Dynamic Risk Budget + bounded warehouse distribution

v6.6 replaces the Risk→Cut% experiment with the confirmed business model:

1. Calculate Adjusted Received from all incoming orders after each LINE Group reduction %.
2. Add the accepted Point loss tolerance to create the Risk Budget.
3. Calculate worst-case Point Reserve from quantity still retained by our warehouse.
4. If Reserve exceeds the Risk Budget, dynamically simulate the quantity that should be distributed out.
5. Send only one bounded warehouse round at a time. After confirm, recalculate before the next round.

## Core example

- total order basis after reduction = 60
- accepted negative Point = 10
- Risk Budget = 70
- A01 retained = 35
- effective multiplier = x7
- current exposure = 245
- target retained = 10
- distribute target = 25
- destination limit = 5 per round
- current plan = 5 rounds (recalculated after every confirmation)

## Migration

Run after migrations 007–011:

`supabase/migrations/202608250012_add_dynamic_risk_budget_distribution.sql`

Migration 012:

- adds `summary_group_risk_settings`
- adds `warehouse_transfer_limits`
- changes operational Point Reserve to retained quantity after confirmed transfers
- appends `point_loss_tolerance`, `risk_budget`, `risk_budget_margin`, `excess_point_risk` to `session_overall_risk_state`
- adds batch audit snapshots for Risk Budget and warehouse limits
- adds `confirm_risk_transfer_batch_budget_safe(...)`

Migration 011 is intentionally kept in migration history if already applied. Its Risk→Cut% policy is not used by v6.6.

## Required setup before transferring

In Dashboard → Settings:

- set `Point ที่ยอมติดลบได้` for each Summary Group (default migration seed is 10 Point)
- add each destination warehouse and its maximum total quantity per transfer round

Example:

- NORTH tolerance = 10
- คลัง 2 = 5 / round
- คลัง 3 = 10 / round

## Verification query

```sql
select
  summary_group_id,
  adjusted_received,
  point_loss_tolerance,
  risk_budget,
  risk_point_total,
  excess_point_risk,
  confirmed_cut_total,
  safety_margin,
  risk_pct
from public.session_overall_risk_state
where settlement_session_id = (
  select id from public.settlement_sessions
  where status='OPEN'
  order by opened_at desc
  limit 1
);
```

Operational code details:

```sql
select
  category,
  code,
  order_total,
  confirmed_cut,
  retained_quantity,
  effective_multiplier,
  retained_point_exposure,
  reserve_rank,
  reserve_candidate
from public.session_code_risk_state
where settlement_session_id = (
  select id from public.settlement_sessions
  where status='OPEN'
  order by opened_at desc
  limit 1
)
order by category,reserve_rank,code;
```

## Tests

Run:

```bash
npm test
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/risk-transfer-preview.mjs
node --check netlify/functions/risk-transfer-confirm.mjs
node --check netlify/functions/settings.mjs
node --check src/lib/risk-engine.mjs
node --check src/lib/risk-transfer-safety.mjs
node --check public/app.js
git diff --check
```

Expected final smoke test:

`PASS: Dynamic Risk Budget + bounded warehouse distribution v6.6 smoke tests`
