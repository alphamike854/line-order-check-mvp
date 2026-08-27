import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync(
  "netlify/functions/settings.mjs",
  "utf8",
);

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8",
);

const enabledMigration = fs.readFileSync(
  "supabase/migrations/20260827052000_add_settlement_line_group_enabled.sql",
  "utf8",
);

assert.match(
  settings,
  /supabase\.rpc\(\s*"save_line_group_live"/,
  "LINE-group settings must use the atomic live-save RPC",
);

assert.match(
  webhook,
  /\.from\("settlement_line_group_config"\)[\s\S]*?\.eq\("enabled",\s*true\)/,
  "webhook must ignore disabled settlement groups",
);

assert.match(
  enabledMigration,
  /add column if not exists enabled boolean not null default true/,
  "settlement snapshot must persist enabled state",
);

assert.doesNotMatch(
  enabledMigration,
  /update\s+public\.settlement_line_group_config[\s\S]*set\s+enabled\s*=\s*true/i,
  "enabled migration must not re-enable disabled groups",
);

console.log(
  "PASS: LINE group live registration + enabled control v8.9",
);
