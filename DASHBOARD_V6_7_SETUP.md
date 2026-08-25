# Dashboard v6.7 — Live Point multiplier + fast bulk allocation

v6.7 fixes two operational problems found during real testing:

1. Editing a company Point multiplier (for example A x14 -> x7) now updates the current OPEN settlement immediately. CLOSED settlements keep their historical multiplier snapshot.
2. The allocation page now mirrors the Order Board and supports selecting many recommended codes at once. The system automatically splits the approved quantities into multiple warehouse rounds based on each selected warehouse's per-round limit.

## Migration

Run after migration 012:

`supabase/migrations/202608250013_sync_live_point_profiles_and_bulk_distribution.sql`

Migration 013:

- adds `point_category_profiles_sync_open_settlement_trg`
- synchronizes the current OPEN `settlement_point_profiles` whenever company Point multipliers or max-code limits are edited
- immediately repairs the current OPEN settlement from company Point settings
- adds `settlement_distribution_runs`
- links transfer batches to an automatic distribution run
- adds `confirm_risk_distribution_run_budget_safe(...)` for one-click multi-round confirmation

## Multiplier verification

After changing A to x7 in Dashboard Settings, run:

```sql
select
  p.category,
  p.special_multiplier,
  p.max_special_codes
from public.settlement_point_profiles p
where p.settlement_session_id = (
  select id from public.settlement_sessions
  where status='OPEN'
  order by opened_at desc
  limit 1
)
order by p.category;
```

A must show `7.000` immediately. CLOSED settlements are not updated.

## Fast allocation UX

Allocation now works as:

1. Look at the same A / B / E / F board used by Summary; G appears below when present.
2. Recommended codes are checked automatically.
3. Select one or more destination warehouses.
4. Click `กระจายยอดที่เลือกตามแผน` once.
5. The server previews the current dynamic risk plan, then one user confirmation commits all bounded rounds atomically.

Example:

- A01 received 35
- risk model says retain 10
- distribute 25
- selected warehouse limit = 5 / round

The system records five rounds of 5 from one user confirmation. If multiple warehouses are selected, they rotate round-robin while respecting each warehouse's own limit.

The bulk confirmation is stale-safe: order-item writes, Point multiplier changes and transfer confirmation share the settlement + Summary Group advisory lock. If the state changes before confirmation, the run is rejected and the Dashboard must refresh.

## Tests

```bash
npm test
node --check netlify/functions/risk-distribution-preview.mjs
node --check netlify/functions/risk-distribution-confirm.mjs
node --check src/lib/distribution-round-planner.mjs
node --check src/lib/distribution-run-safety.mjs
node --check public/app.js
git diff --check
```

Expected final test:

`PASS: Live Point multiplier + fast bulk allocation v6.7 smoke tests`
