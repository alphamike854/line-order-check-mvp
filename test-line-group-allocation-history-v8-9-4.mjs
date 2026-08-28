import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL(
    "./netlify/functions/allocation-history.mjs",
    import.meta.url,
  ),
  "utf8",
);


// Batch attribution.
assert.match(
  source,
  /settlement_transfer_batches/,
);

assert.match(
  source,
  /summary_group_id,line_group_id,risk_pool,risk_model/,
);


// Item attribution.
assert.match(
  source,
  /settlement_transfer_batch_items/,
);

assert.match(
  source,
  /batch_id,line_group_id,category,code,quantity/,
);

assert.match(
  source,
  /effective_multiplier,retention_limit,recommended_transfer_before/,
);


// Existing history contract remains.
assert.match(
  source,
  /distribution_run_id/,
);

assert.match(
  source,
  /confirmed_at/,
);

assert.match(
  source,
  /compactTransferLines/,
);

assert.match(
  source,
  /history:/,
);


// Historical legacy rows are allowed to remain null.
// No synthetic fallback or guessed LINE Group attribution.
assert.doesNotMatch(
  source,
  /line_group_id\s*\?\?/,
);

assert.doesNotMatch(
  source,
  /line_group_id\s*\|\|/,
);


// Endpoint remains read-only.
assert.doesNotMatch(
  source,
  /\.insert\s*\(/,
);

assert.doesNotMatch(
  source,
  /\.update\s*\(/,
);

assert.doesNotMatch(
  source,
  /\.delete\s*\(/,
);

assert.doesNotMatch(
  source,
  /\.rpc\s*\(/,
);


console.log(
  "PASS: LINE Group allocation history attribution v8.9.4"
);
