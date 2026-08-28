import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260828042000_add_line_group_distribution_confirm.sql',
  'utf8',
);

assert.match(
  migration,
  /confirm_line_group_distribution_run/,
);

assert.match(
  migration,
  /security definer/,
);

assert.match(
  migration,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
  'confirm must serialize with settlement lifecycle/live remap',
);

assert.match(
  migration,
  /where id = p_settlement_session_id[\s\S]*for update/,
  'OPEN settlement row must be locked',
);

assert.match(
  migration,
  /settlement_line_group_config[\s\S]*line_group_id = v_line_group_id[\s\S]*for update/,
  'exact LINE Group settlement snapshot must be locked',
);

assert.match(
  migration,
  /CONFIRMATION_REQUEST_ID_COLLISION/,
  'idempotency must not return an unrelated run',
);

assert.match(
  migration,
  /session_line_group_risk_state/,
);

assert.match(
  migration,
  /session_line_group_code_retention_state/,
);

assert.match(
  migration,
  /retained_quantity[\s\S]*min_expected_retained/,
);

assert.match(
  migration,
  /effective_multiplier[\s\S]*min_expected_multiplier/,
);

assert.match(
  migration,
  /retention_limit[\s\S]*min_retention_limit/,
);

assert.match(
  migration,
  /v_code_agg\.quantity[\s\S]*<>[\s\S]*v_code_state\.recommended_cut/,
  'selected code must confirm its complete current recommendation',
);

assert.match(
  migration,
  /DUPLICATE_TRANSFER_ITEM/,
);

assert.match(
  migration,
  /POST_CONFIRM_RETENTION_MISMATCH/,
);

assert.match(
  migration,
  /line_group_id,[\s\S]*risk_model/,
  'distribution writes must carry LINE Group attribution',
);

assert.match(
  migration,
  /settlement_transfer_batch_items\([\s\S]*line_group_id,[\s\S]*retention_limit/,
);

assert.match(
  migration,
  /recommended_cut_after/,
);

assert.doesNotMatch(
  migration,
  /session_overall_risk_state/,
  'new confirm must not depend on legacy Summary Group overall risk state',
);

assert.doesNotMatch(
  migration,
  /session_risk_pool_state/,
  'new confirm must not depend on legacy Summary Group pool state',
);

assert.doesNotMatch(
  migration,
  /from public\.session_code_risk_state/,
  'new confirm must not use Summary Group code state',
);

assert.match(
  migration,
  /grant execute[\s\S]*to service_role/,
);

assert.match(
  migration,
  /revoke all[\s\S]*from public, anon, authenticated/,
);

console.log(
  'PASS: LINE Group atomic confirmation RPC v8.9.4',
);
