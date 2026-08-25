import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(
  new URL('./supabase/migrations/202608250010_harden_settlement_point_profile_snapshot.sql', import.meta.url),
  'utf8'
);

assert.match(sql, /create or replace function public\.snapshot_settlement_point_profiles\(\)/i);
assert.match(sql, /create trigger settlement_sessions_snapshot_point_profiles/i);
assert.match(sql, /after insert on public\.settlement_sessions/i);
assert.match(sql, /on conflict \(settlement_session_id, category\) do nothing/i);
assert.match(sql, /create or replace function public\.open_settlement_session\(/i);
assert.match(sql, /settlement_point_profiles/i);
assert.match(sql, /point_factor_pct/i);
assert.match(sql, /pg_advisory_xact_lock/i);

console.log('PASS: Settlement Point Profile snapshot hardening v6.2 smoke tests');
