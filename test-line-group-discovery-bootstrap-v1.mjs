"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261007221500_"
      + "add_observed_line_groups.sql",
    "utf8",
  );

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      "package.json",
      "utf8",
    ),
  );


assert.match(
  migration,
  /create table if not exists\s+public\.observed_line_groups/i,
);

assert.match(
  migration,
  /line_group_id text primary key/i,
);

assert.match(
  migration,
  /first_seen_at timestamptz not null/i,
);

assert.match(
  migration,
  /last_seen_at timestamptz not null/i,
);

assert.match(
  migration,
  /from public\.webhook_events e/i,
);

assert.match(
  migration,
  /group by\s+e\.line_group_id/i,
);

assert.match(
  migration,
  /create or replace function\s+public\.observe_line_group_ingress/i,
);

assert.match(
  migration,
  /on conflict \(line_group_id\)[\s\S]*do update set/i,
);

assert.match(
  migration,
  /enable row level security/i,
);

assert.match(
  migration,
  /grant[\s\S]*select,[\s\S]*insert,[\s\S]*update[\s\S]*to service_role/i,
);


/*
 * Discovery registry must remain metadata-only.
 */
const tableStart =
  migration.indexOf(
    "create table if not exists\n"
      + "  public.observed_line_groups",
  );

const backfillStart =
  migration.indexOf(
    "-- Backfill rooms",
  );

assert.ok(
  tableStart >= 0
  && backfillStart > tableStart,
);

const tableDefinition =
  migration.slice(
    tableStart,
    backfillStart,
  );

assert.doesNotMatch(
  tableDefinition,
  /\bpayload\b/i,
);

assert.doesNotMatch(
  tableDefinition,
  /\braw_text\b/i,
);


/*
 * Public ingress observation must occur only after signature + JSON
 * validation, but before temporal/QStash admission filtering.
 */
assert.match(
  webhook,
  /async function observeLineGroupsBestEffort\(/,
);

assert.match(
  webhook,
  /event\?\.source\?\.type[\s\S]*!== "group"/,
);

assert.match(
  webhook,
  /observe_line_group_ingress/,
);

assert.match(
  webhook,
  /LINE group observation failed; continuing ingress/,
);

const signatureIndex =
  webhook.indexOf(
    "if (!verifyLineSignature(",
  );

const parseIndex =
  webhook.indexOf(
    "payload = JSON.parse(",
    signatureIndex,
  );

const observeCallIndex =
  webhook.indexOf(
    "await observeLineGroupsBestEffort(",
    parseIndex,
  );

const admissionIndex =
  webhook.indexOf(
    "await selectQStashIngressEvents(",
    observeCallIndex,
  );

assert.ok(
  signatureIndex >= 0,
  "signature gate missing",
);

assert.ok(
  parseIndex > signatureIndex,
  "JSON parse must follow signature validation",
);

assert.ok(
  observeCallIndex > parseIndex,
  "observation must follow valid JSON",
);

assert.ok(
  admissionIndex > observeCallIndex,
  "observation must precede temporal admission",
);


/*
 * Settings must discover unconfigured rooms from the bounded registry,
 * not from admitted webhook_events.
 */
const settingsStart =
  dashboard.indexOf(
    "export async function fetchSettings()",
  );

const settingsEnd =
  dashboard.indexOf(
    "export async function writeSettingsAudit",
    settingsStart,
  );

assert.ok(
  settingsStart >= 0
  && settingsEnd > settingsStart,
);

const settingsBody =
  dashboard.slice(
    settingsStart,
    settingsEnd,
  );

assert.match(
  settingsBody,
  /\.from\("observed_line_groups"\)/,
);

assert.doesNotMatch(
  settingsBody,
  /\.from\("webhook_events"\)/,
);

assert.match(
  settingsBody,
  /unconfigured_line_groups:\s*[\r\n\s]*unconfiguredLineGroups/,
);


/*
 * The new regression must stay in the canonical suite.
 */
assert.match(
  pkg.scripts.test,
  /\btest-line-group-discovery-bootstrap-v1\.mjs\b/,
);


console.log(
  "PASS: signed group is observed before Round admission",
);

console.log(
  "PASS: discovery registry stores metadata only",
);

console.log(
  "PASS: Settings discovery no longer depends on webhook admission",
);

console.log(
  "PASS: observed LINE group bootstrap regression contract",
);
