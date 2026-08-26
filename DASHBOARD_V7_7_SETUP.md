# Dashboard v7.7 — H/L One-Digit Categories + Separate Risk Pools

## What changed

v7.7 adds two independent one-digit order categories:

- `H0`–`H9` = **วิ่งบน**
  - Point special-code capacity: **3 codes**
- `L0`–`L9` = **วิ่งล่าง**
  - Point special-code capacity: **2 codes**

H and L are intentionally separated from the MAIN A/B/E/F/G risk pool. Their order totals, Risk Budget, Point reserve, accepted Point loss, recommendations, and confirmed cuts are calculated independently.

The company Point multiplier for H/L is **not guessed**. Migration 019 seeds H and L with multiplier `0`, meaning **not configured yet**. Set the real multiplier in Dashboard Settings before using H/L risk-cut recommendations.

## Parser examples

All of these are supported:

```text
H1=500
วิ่งบน1=500
วิ่งบน 1=500
วิ่ง บ 1=500
วิ่ง บ1=500
```

Expected:

```text
H1 = 500
```

Multiple H codes:

```text
วิ่งบน 1 3 5=500
```

Expected:

```text
H1 = 500
H3 = 500
H5 = 500
```

L examples:

```text
L2=300
วิ่งล่าง2=300
วิ่งล่าง 2=300
วิ่ง ล 2=300
```

Expected:

```text
L2 = 300
```

Parser version: `1.4.0`.

## Risk behavior

The three risk pools are:

```text
MAIN = A + B + E + F + G
H    = H only
L    = L only
```

H uses its 3 highest retained Point exposures as the conservative reserve candidates.
L uses its 2 highest retained Point exposures.

For each pool:

```text
Risk Budget = adjusted received in that pool + accepted Point loss for that pool
```

Confirmed warehouse transfers reduce retained quantity and operational Point exposure only inside the corresponding pool.

## Dashboard

Summary, Allocation, and After-cut views now keep H/L in a consistent compact section below the existing main board.

H/L display:

- Received
- retained quantity after confirmed cuts
- Point reserve / recommendation status
- confirmed cuts and after-cut state

The Allocation page can select MAIN/H/L recommendations in one workflow, but the backend previews and confirms each pool independently so one pool cannot spend another pool's Risk Budget.

## Point settings

Dashboard Settings now includes H and L in Point Profiles.

Required first-time setup after migration:

1. Edit **H — วิ่งบน** and enter the company's real Point multiplier.
2. H special-code slots remain fixed at **3**.
3. Edit **L — วิ่งล่าง** and enter the company's real Point multiplier.
4. L special-code slots remain fixed at **2**.
5. Set accepted Point loss separately for MAIN, H, and L for each Summary Group.

Until H/L multiplier is greater than zero, H/L orders are still recorded and shown, but the dashboard does not issue H/L risk-cut recommendations.

## Migration

Run only the new migration when upgrading from v7.6:

```text
supabase/migrations/202608260019_add_one_digit_hl_risk_pools.sql
```

Migration 019:

- expands persisted categories to H/L;
- adds `category_definitions`;
- expands aliases with H/L;
- creates H/L Point Profiles with multiplier 0;
- adds H/L only to the current OPEN settlement, leaving historical CLOSED settlement snapshots unchanged;
- creates independent MAIN/H/L risk settings and pool state;
- adds pool identity to distribution runs/batches;
- adds the separate-risk atomic confirmation RPC;
- expands Promotion and Actual Point code validation for one-digit H/L codes.

## Install

From the repository root:

```bash
cd ~/Downloads/line-order-netlify-supabase-mvp
git status --short
```

The working tree should be clean before applying the patch.

```bash
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v7.7-hl-one-digit-separate-risk-pools-patch.zip" -d .
```

Run migration 019 in Supabase SQL Editor, then verify locally:

```bash
npm test
node --check src/lib/order-parser.mjs
node --check src/lib/risk-engine.mjs
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/settings.mjs
node --check netlify/functions/risk-distribution-preview.mjs
node --check netlify/functions/risk-distribution-confirm.mjs
node --check public/app.js
git diff --check
```

Expected regression line:

```text
PASS: H/L one-digit categories + separate risk pools v7.7 smoke tests
```

Then stage and commit:

```bash
git add .
git diff --cached --check
git status --short
git commit -m "Add one digit H L risk pools"
git push
```

After Netlify is Published, hard refresh the dashboard.

## Recommended live test

Before testing Risk, first set the real H/L multipliers.

Send:

```text
วิ่งบน 1 3 5=500
วิ่งล่าง 2 8=300
```

Expected received items:

```text
H1 = 500
H3 = 500
H5 = 500
L2 = 300
L8 = 300
```

Confirm that:

- MAIN totals do not include H/L;
- H Risk shows only H;
- L Risk shows only L;
- H reserve uses up to 3 codes;
- L reserve uses up to 2 codes;
- cutting H does not reduce MAIN or L Risk;
- cutting L does not reduce MAIN or H Risk.
