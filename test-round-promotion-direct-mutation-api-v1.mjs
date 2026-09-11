import assert from "node:assert/strict";
import fs from "node:fs";

const settlement =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
    "utf8",
  );

const browser =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const specialPoints =
  fs.readFileSync(
    "netlify/functions/special-points.mjs",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const accounting =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

const resolverStart =
  settlement.indexOf(
    "async function resolvePromotionRound(",
  );

const directStart =
  settlement.indexOf(
    "async function changeRoundPointPromotion(",
  );

const legacyStart =
  settlement.indexOf(
    "async function changePointPromotion(",
  );

assert.ok(
  resolverStart >= 0
    && directStart > resolverStart
    && legacyStart > directStart,
  "Round mutation function boundaries missing",
);

const roundSection =
  settlement.slice(
    resolverStart,
    legacyStart,
  );

const legacySection =
  settlement.slice(
    legacyStart,
  );

console.log(
  "===== Round Promotion Direct Mutation API v1 =====",
);

assert.match(
  settlement,
  /action === "SET_ROUND_PROMOTION"/,
);

assert.match(
  settlement,
  /action === "DELETE_ROUND_PROMOTION"/,
);

console.log(
  "PASS P2B1-01 explicit Round-native API actions exist",
);

assert.match(
  roundSection,
  /\.from\("settlement_sessions"\)/,
);

assert.match(
  roundSection,
  /\.from\("settlement_line_group_config"\)/,
);

assert.match(
  roundSection,
  /\.from\("settlement_summary_group_rounds"\)/,
);

assert.match(
  roundSection,
  /\.order\(\s*"round_no",[\s\S]*ascending:\s*false/,
);

assert.match(
  roundSection,
  /\.from\(\s*"settlement_summary_group_round_snapshots"/,
);

console.log(
  "PASS P2B1-02 server resolves latest Round from settlement + Summary Group",
);

assert.doesNotMatch(
  roundSection,
  /body\.round_id/,
);

assert.match(
  roundSection,
  /ROUND_NOT_FOUND/,
);

assert.match(
  roundSection,
  /ROUND_CONFIG_ARCHIVED/,
);

console.log(
  "PASS P2B1-03 browser cannot supply authoritative Round identity",
);

assert.match(
  roundSection,
  /"set_settlement_round_point_promotion"/,
);

assert.match(
  roundSection,
  /p_round_id:\s*[\r\n\s]*round\.id/,
);

assert.match(
  roundSection,
  /p_target_scope:\s*[\r\n\s]*targetScope/,
);

assert.match(
  roundSection,
  /p_line_group_ids:\s*[\r\n\s]*lineGroupIds/,
);

console.log(
  "PASS P2B1-04 Round SET forwards factor, scope and targets to authoritative RPC",
);

assert.match(
  roundSection,
  /"delete_settlement_round_point_promotion"/,
);

console.log(
  "PASS P2B1-05 Round DELETE uses server-resolved Round authority",
);

for (const token of [
  "INVALID_PROMOTION_SCOPE",
  "INVALID_PROMOTION_LINE_GROUPS",
  "PROMOTION_ALL_WITH_SELECTED_GROUPS",
  "PROMOTION_SELECTED_GROUPS_REQUIRED",
  "PROMOTION_LINE_GROUP_OUT_OF_SCOPE",
]) {
  assert.match(
    settlement,
    new RegExp(token),
  );
}

console.log(
  "PASS P2B1-06 ALL/SELECTED validation fails closed",
);

assert.match(
  roundSection,
  /body\.target_scope\s*\?\?\s*"ALL"/,
);

assert.match(
  roundSection,
  /new Set\(/,
);

assert.match(
  roundSection,
  /\.sort\(\)/,
);

console.log(
  "PASS P2B1-07 omitted scope defaults ALL and targets normalize deterministically",
);

assert.doesNotMatch(
  roundSection,
  /\.from\("settlement_round_point_promotions"\)/,
);

assert.doesNotMatch(
  roundSection,
  /\.from\("settlement_round_point_promotion_line_groups"\)/,
);

assert.doesNotMatch(
  roundSection,
  /\.from\("settlement_round_point_promotion_events"\)/,
);

console.log(
  "PASS P2B1-08 application performs no direct Promotion table DML",
);

assert.match(
  settlement,
  /action === "SET_PROMOTION"/,
);

assert.match(
  settlement,
  /action === "DELETE_PROMOTION"/,
);

assert.match(
  legacySection,
  /"set_settlement_summary_group_point_promotion"/,
);

assert.match(
  legacySection,
  /"delete_settlement_summary_group_point_promotion"/,
);

console.log(
  "PASS P2B1-09 legacy compatibility actions remain available",
);

assert.match(
  browser,
  /SET_ROUND_PROMOTION/,
);

assert.match(
  browser,
  /DELETE_ROUND_PROMOTION/,
);

console.log(
  "PASS P2B1-10 browser now consumes the explicit Round-native mutation capability",
);

assert.match(
  specialPoints,
  /settlement_summary_group_point_promotions_current/,
);

assert.match(
  specialPoints,
  /target_scope/,
);

assert.match(
  specialPoints,
  /line_group_ids/,
);

console.log(
  "PASS P2B1-11 current Round Promotion read projection remains intact",
);

assert.match(
  dashboard,
  /loadDashboardPointContext/,
);

assert.match(
  dashboard,
  /buildDashboardFreshness/,
);

assert.doesNotMatch(
  dashboard,
  /\.from\("settlement_point_promotions"\)/,
);

assert.match(
  accounting,
  /settlement_point_promotions/,
);

assert.doesNotMatch(
  accounting,
  /settlement_summary_group_point_promotions_current/,
);

console.log(
  "PASS P2B1-12 Dashboard metadata delegates to P3A2 while Accounting cutover remains deferred",
);

console.log(
  "PASS: Round Promotion Direct Mutation API v1",
);
