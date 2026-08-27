import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync(
  "netlify/functions/settings.mjs",
  "utf8"
);

const start = settings.indexOf("async function saveLineGroup");
const end = settings.indexOf("async function saveAllocationRule", start);

assert.ok(start >= 0, "saveLineGroup must exist");
assert.ok(end > start, "saveLineGroup boundary must exist");

const block = settings.slice(start, end);

assert.match(
  block,
  /if\s*\(\s*row\.enabled\s*\)/,
  "only enabled new groups should initially join OPEN settlement"
);

assert.match(
  block,
  /settlement_session_id:\s*openSession\.id/,
  "snapshot must belong to current OPEN settlement"
);

assert.match(
  block,
  /line_group_id:\s*row\.line_group_id/,
  "snapshot must contain LINE group id"
);

assert.match(
  block,
  /line_group_name:\s*row\.line_group_name/,
  "new snapshot must contain current group name"
);

assert.match(
  block,
  /summary_group_id:\s*row\.summary_group_id/,
  "new snapshot must contain selected summary group"
);

assert.match(
  block,
  /enabled:\s*true/,
  "new enabled group snapshot must start enabled"
);

assert.match(
  block,
  /onConflict:\s*"settlement_session_id,line_group_id"/,
  "snapshot registration must be idempotent"
);

assert.match(
  block,
  /ignoreDuplicates:\s*true/,
  "existing settlement snapshot must not be overwritten"
);

assert.match(
  block,
  /\.update\(\{[\s\S]*?reduction_pct:\s*row\.reduction_pct,[\s\S]*?enabled:\s*row\.enabled,[\s\S]*?\}\)/,
  "OPEN snapshot operational settings must update immediately"
);

assert.doesNotMatch(
  block,
  /\.update\(\{[^}]*summary_group_id/,
  "existing OPEN snapshot summary mapping must remain frozen"
);

assert.doesNotMatch(
  block,
  /\.update\(\{[^}]*line_group_name/,
  "existing OPEN snapshot group name must remain frozen"
);

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8"
);

const settlementStart = webhook.indexOf(
  "async function resolveSettlementLineGroup"
);

assert.ok(
  settlementStart >= 0,
  "settlement group resolver must exist"
);

const settlementBlock = webhook.slice(
  settlementStart,
  webhook.indexOf("\nasync function", settlementStart + 20) >= 0
    ? webhook.indexOf("\nasync function", settlementStart + 20)
    : webhook.length
);

assert.match(
  settlementBlock,
  /\.from\("settlement_line_group_config"\)/,
  "webhook must resolve from settlement snapshot"
);

assert.match(
  settlementBlock,
  /\.eq\("enabled",\s*true\)/,
  "disabled settlement group must not resolve"
);

const masterStart = webhook.indexOf(
  "async function resolveLineGroup"
);

const masterEnd = webhook.indexOf(
  "async function resolveSettlementLineGroup",
  masterStart
);

const masterBlock = webhook.slice(masterStart, masterEnd);

assert.match(
  masterBlock,
  /\.eq\("enabled",\s*true\)/,
  "disabled master LINE group must not resolve"
);

const migration = fs.readFileSync(
  "supabase/migrations/20260827052000_add_settlement_line_group_enabled.sql",
  "utf8"
);

assert.match(
  migration,
  /add column if not exists enabled boolean not null default true/,
  "settlement snapshot must persist enabled state"
);

assert.doesNotMatch(
  migration,
  /update\s+public\.settlement_line_group_config[\s\S]*set\s+enabled\s*=\s*true/i,
  "migration must not re-enable previously disabled settlement groups"
);

assert.match(
  webhook,
  /GROUP_NOT_CONFIGURED/,
  "disabled/unconfigured groups must stay review-safe"
);

assert.equal(
  (masterBlock.match(/\.eq\("enabled",\s*true\)/g) || []).length,
  1,
  "master LINE-group resolver must contain exactly one enabled filter"
);

assert.equal(
  (settlementBlock.match(/\.eq\("enabled",\s*true\)/g) || []).length,
  1,
  "settlement LINE-group resolver must contain exactly one enabled filter"
);

console.log(
  "PASS: LINE group live registration + enabled control v8.9"
);
