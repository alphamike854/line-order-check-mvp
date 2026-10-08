"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fetchLineGroupSummary,
} from "./src/lib/line-group-profile.mjs";

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


const groupProfileBackground =
  fs.readFileSync(
    "netlify/functions/"
      + "line-group-profile-background.mjs",
    "utf8",
  );


const identityMigration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261008063000_"
      + "add_line_group_identity.sql",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const html =
  fs.readFileSync(
    "public/index.html",
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
    "selectQStashIngressEvents(",
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


const profileBackgroundPromiseIndex =
  webhook.indexOf(
    "const lineGroupProfileBackgroundPromise =",
    observeCallIndex,
  );

const profileBackgroundInvokeIndex =
  webhook.indexOf(
    "invokeLineGroupProfileBackgroundBestEffort(",
    profileBackgroundPromiseIndex,
  );

assert.ok(
  profileBackgroundPromiseIndex
    > observeCallIndex,
  "profile background promise must start after registry observation",
);

assert.ok(
  profileBackgroundInvokeIndex
    > profileBackgroundPromiseIndex,
  "profile background invocation must initialize the promise",
);

assert.ok(
  profileBackgroundInvokeIndex
    < admissionIndex,
  "profile enrichment must start before temporal admission can discard a new group",
);

assert.doesNotMatch(
  webhook,
  /await invokeLineGroupProfileBackgroundBestEffort\(/,
);

assert.match(
  webhook,
  /await Promise\.all\(\[[\s\S]*selectQStashIngressEvents\([\s\S]*lineGroupProfileBackgroundPromise[\s\S]*\]\)/,
);

assert.match(
  webhook,
  /!isQStashIngressEnabledForAdmission\(\)[\s\S]*await lineGroupProfileBackgroundPromise/,
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



/*
 * Real LINE Group identity + membership lifecycle.
 */
assert.match(
  identityMigration,
  /last_known_group_name text/i,
);

assert.match(
  identityMigration,
  /group_name_synced_at timestamptz/i,
);

assert.match(
  identityMigration,
  /observe_line_group_ingress_v2/i,
);

assert.match(
  identityMigration,
  /set_observed_line_group_name/i,
);

assert.match(
  identityMigration,
  /v_last_event_type = 'leave'[\s\S]*'LEFT'/i,
);

assert.doesNotMatch(
  webhook,
  /fetchLineGroupSummary/,
);

assert.match(
  webhook,
  /line-group-profile-background/,
);

assert.match(
  webhook,
  /invokeLineGroupProfileBackgroundBestEffort/,
);

assert.match(
  groupProfileBackground,
  /verifyLineSignature/,
);

assert.match(
  groupProfileBackground,
  /fetchLineGroupSummary/,
);

assert.match(
  groupProfileBackground,
  /observe_line_group_ingress_v2/,
);

assert.match(
  groupProfileBackground,
  /set_observed_line_group_name/,
);

assert.match(
  groupProfileBackground,
  /background:\s*true/,
);

assert.match(
  webhook,
  /observe_line_group_ingress_v2/,
);

assert.match(
  webhook,
  /data\?\.membership_status[\s\S]*=== "IN_GROUP"/,
);

assert.match(
  webhook,
  /data\?\.needs_name_sync[\s\S]*=== true/,
);

assert.match(
  webhook,
  /LINE group profile background invocation failed; continuing ingress/,
);

assert.match(
  settingsBody,
  /last_known_group_name/,
);

assert.match(
  settingsBody,
  /membership_status/,
);

assert.match(
  settingsBody,
  /observed_group_name/,
);

assert.match(
  app,
  /🟢 อยู่ในกลุ่ม/,
);

assert.match(
  app,
  /⚪ ออกจากกลุ่ม/,
);

assert.match(
  app,
  /row\.line_group_name/,
);

assert.match(
  html,
  /name="line_group_name"[\s\S]*readonly/,
);

assert.doesNotMatch(
  app,
  /แล้วตั้งชื่อและกลุ่มสรุป/,
);


/*
 * Group Summary helper must not require a live LINE request in tests.
 */
const foundSummary =
  await fetchLineGroupSummary({
    lineGroupId:
      "C1234567890abcdef",

    channelAccessToken:
      "test-token",

    fetchImpl:
      async () => ({
        ok: true,
        status: 200,
        json:
          async () => ({
            groupId:
              "C1234567890abcdef",
            groupName:
              "กลุ่มจริงจาก LINE",
          }),
      }),
  });

assert.deepEqual(
  foundSummary,
  {
    status: "FOUND",
    group_name:
      "กลุ่มจริงจาก LINE",
  },
);


const leftSummary =
  await fetchLineGroupSummary({
    lineGroupId:
      "C1234567890abcdef",

    channelAccessToken:
      "test-token",

    fetchImpl:
      async () => ({
        ok: false,
        status: 404,
      }),
  });

assert.deepEqual(
  leftSummary,
  {
    status: "NOT_MEMBER",
    group_name: null,
  },
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


console.log(
  "PASS: real LINE Group name is cached without manual naming",
);

console.log(
  "PASS: membership status derives from LINE leave lifecycle",
);


console.log(
  "PASS: LINE Group Summary runs only in background enrichment",
);

console.log(
  "PASS: public webhook ingress does not wait for LINE Group Summary",
);


console.log(
  "PASS: profile background acceptance overlaps temporal admission",
);
