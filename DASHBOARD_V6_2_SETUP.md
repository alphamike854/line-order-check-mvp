# Dashboard v6.2 — Settlement Point Profile Snapshot Hardening

## Purpose

Fix the permanent cause of a blank Summary/Risk board when the daily report has orders:
`open_settlement_session()` can remain on the old v5 definition and create a settlement without rows in `settlement_point_profiles`.

v6.2 makes the database enforce the invariant itself.

## Migration

Run:

`supabase/migrations/202608250010_harden_settlement_point_profile_snapshot.sql`

The migration:

1. Backfills missing A/B/E/F/G Point Profiles for existing settlements.
2. Adds an `AFTER INSERT` trigger on `settlement_sessions` to snapshot Point Profiles regardless of which application path creates a settlement.
3. Replaces `open_settlement_session(date,jsonb,text)` with the v6 contract.
4. Promotion input uses `point_factor_pct`.
5. Keeps an explicit profile snapshot inside the RPC with `ON CONFLICT DO NOTHING` as a second safety layer.

## Verification

After migration, run in Supabase:

```sql
select
  position(
    'settlement_point_profiles'
    in pg_get_functiondef('public.open_settlement_session(date,jsonb,text)'::regprocedure)
  ) > 0 as snapshots_point_profiles,
  position(
    'point_factor_pct'
    in pg_get_functiondef('public.open_settlement_session(date,jsonb,text)'::regprocedure)
  ) > 0 as uses_v6_promotions;
```

Expected: `true,true`.

Check the trigger:

```sql
select tgname
from pg_trigger
where tgrelid='public.settlement_sessions'::regclass
  and not tgisinternal
order by tgname;
```

Expected to include `settlement_sessions_snapshot_point_profiles`.

Check current/open settlement profiles:

```sql
select s.id, s.status, count(p.category) as profile_rows
from public.settlement_sessions s
left join public.settlement_point_profiles p
  on p.settlement_session_id=s.id
group by s.id,s.status,s.opened_at
order by s.opened_at desc;
```

Each settlement should have 5 profile rows.
