# Dashboard v6.1 — Summary / Daily Report alignment

This patch fixes a case where the Daily Report can show order totals while the Summary / Risk board does not.

## Cause
The Daily Report resolves Summary Group from the frozen `settlement_line_group_config`, while the Risk view previously grouped directly by `order_items.summary_group_id`. Those two values can diverge. v6.1 makes the frozen settlement mapping the single source of truth.

## Install
1. Start from v6 commit `ebeceed` with a clean working tree.
2. Unzip the v6.1 patch into the repository.
3. Run migration `202608250009_align_summary_risk_with_settlement_snapshot.sql` in Supabase SQL Editor.
4. Run `npm test` and syntax checks.
5. Commit and push.

## Expected regression result
The same OPEN settlement orders shown in the Daily Report must also appear on Summary / Order Board and feed Risk / Safe Capacity calculations.
