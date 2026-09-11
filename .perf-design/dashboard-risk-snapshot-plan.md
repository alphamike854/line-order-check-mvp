# Dashboard Risk Snapshot Performance Fix

## Confirmed root cause

Production `/api/dashboard` times out because multiple expensive risk and
retention projections execute concurrently.

Individually the heavy projections complete, but concurrent execution causes
substantial slowdown and `session_line_group_risk_state` can exceed the
12-second PostgreSQL statement timeout.

## Required invariants

1. Existing public risk/retention views remain authoritative outside Dashboard.
2. Existing `/api/dashboard` JSON contract must remain unchanged.
3. P3A2 work remains isolated in the original worktree.
4. No semantic change to Round, Promotion, Actual Point, cut, retention,
   risk-pool, or distribution calculations.
5. Performance fix must be parity-tested against the existing views.

## Target architecture

One Dashboard-specific SQL RPC:

  dashboard_risk_snapshot(
    settlement_session_id uuid,
    summary_group_id text
  )

Request-scoped computation:

  canonical Round line-group/code base
      |
      +-- Summary Group branch
      |     +-- code risk
      |     +-- category risk
      |     +-- risk pool
      |     +-- overall risk
      |
      +-- LINE Group branch
            +-- line-group code risk
            +-- retention
            +-- line-group risk

Heavy reusable CTEs must be MATERIALIZED.

The RPC should return only the heavy Dashboard sections:

- risk_codes
- category_risk
- overall_risk
- risk_pools
- line_group_risk
- line_group_risk_codes

Lightweight Dashboard queries remain outside the RPC initially:

- messages
- point profiles
- point promotions
- actual special codes
- warehouse limits
- risk-budget settings
- review-open count
- unsends
- transfer-batch freshness

## Validation gates

1. Historical row parity with existing views.
2. Current OPEN session row parity.
3. ALL parity.
4. NORTH parity.
5. Exact field contract parity.
6. Benchmark below 12-second DB statement timeout with margin.
7. Production HTTP ALL + NORTH smoke.
