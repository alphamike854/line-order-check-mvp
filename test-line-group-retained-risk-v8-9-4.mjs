import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260828041000_add_line_group_retained_risk_state.sql',
  'utf8',
);

assert.match(
  migration,
  /session_line_group_confirmed_cut_state/,
);

assert.match(
  migration,
  /i\.line_group_id\s*=\s*b\.line_group_id/,
  'batch and item LINE Group attribution must agree',
);

assert.match(
  migration,
  /b\.risk_model\s*=\s*'CATEGORY_RETENTION'/,
  'legacy Summary Group transfers must not reduce LINE Group retained state',
);

assert.match(
  migration,
  /c\.order_total\s*-\s*coalesce\(x\.confirmed_cut,0\)/,
);

assert.match(
  migration,
  /l\.retained_quantity\s*-\s*l\.retention_limit/,
  'recommendation must use retained quantity',
);

assert.match(
  migration,
  /confirmed_cut_exceeds_order_total/,
);

assert.match(
  migration,
  /DATA_INTEGRITY_ERROR/,
);

assert.match(
  migration,
  /over_cut_code_count/,
);

assert.doesNotMatch(
  migration,
  /\bupdate\s+public\./i,
  'Phase 2B must remain read-only',
);

assert.doesNotMatch(
  migration,
  /point_loss_tolerance/,
);

console.log(
  'PASS: LINE Group retained Risk state v8.9.4',
);
