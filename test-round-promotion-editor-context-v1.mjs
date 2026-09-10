import assert from "node:assert/strict";
import fs from "node:fs";

const special = fs.readFileSync(
  "netlify/functions/special-points.mjs",
  "utf8",
);

const settlement = fs.readFileSync(
  "netlify/functions/settlement.mjs",
  "utf8",
);

const browser = fs.readFileSync(
  "public/app.js",
  "utf8",
);

console.log(
  "===== Round Promotion Editor Context v1 =====",
);

assert.equal(
  (
    special.match(
      /eligible_line_groups:\s*\[\]/g,
    ) || []
  ).length,
  2,
);

console.log(
  "PASS P2B2A-01 null and unselected contexts expose empty eligible LINE groups",
);

assert.match(
  special,
  /const\s*\[\s*promoResult,\s*codeResult,\s*statusResult,\s*eligibleLineGroupResult,\s*\]\s*=\s*await Promise\.all/,
);

console.log(
  "PASS P2B2A-02 eligible LINE groups are loaded with the selected Point context",
);

assert.match(
  special,
  /\.from\("settlement_line_group_config"\)[\s\S]*?\.select\("line_group_id,line_group_name"\)[\s\S]*?\.eq\("settlement_session_id",\s*session\.id\)[\s\S]*?\.eq\(\s*"summary_group_id",\s*selectedSummaryGroup,\s*\)[\s\S]*?\.eq\("enabled",\s*true\)[\s\S]*?\.order\("line_group_name"\)[\s\S]*?\.order\("line_group_id"\)/,
);

console.log(
  "PASS P2B2A-03 target authority is enabled session + Summary Group membership",
);

assert.match(
  special,
  /eligible_line_groups:\s*eligibleLineGroupResult\.data\s*\?\?\s*\[\]/,
);

console.log(
  "PASS P2B2A-04 API exposes eligible_line_groups without replacing existing payload keys",
);

assert.match(
  special,
  /promotions:\s*promoResult\.data\s*\?\?\s*\[\]/,
);

assert.match(
  special,
  /round_id:\s*roundRead\.round\?\.id\s*\?\?\s*null/,
);

assert.match(
  special,
  /round_no:\s*roundRead\.round\?\.round_no\s*\?\?\s*null/,
);

assert.match(
  special,
  /round_status:\s*roundRead\.round\?\.status\s*\?\?\s*null/,
);

console.log(
  "PASS P2B2A-05 Promotion and Round read contracts remain intact",
);

assert.match(
  special,
  /settlement_summary_group_point_promotions_current/,
);

assert.match(
  special,
  /ROUND_PROMOTION_PROJECTION_MISMATCH/,
);

assert.match(
  special,
  /ROUND_PROMOTION_TARGET_MISMATCH/,
);

console.log(
  "PASS P2B2A-06 current Round Promotion projection remains fail closed",
);

assert.doesNotMatch(
  special,
  /set_settlement_round_point_promotion/,
);

assert.doesNotMatch(
  special,
  /delete_settlement_round_point_promotion/,
);

console.log(
  "PASS P2B2A-07 Special Point endpoint remains read-context only for Promotion",
);

assert.match(
  settlement,
  /action === "SET_ROUND_PROMOTION"/,
);

assert.match(
  settlement,
  /action === "DELETE_ROUND_PROMOTION"/,
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
  "PASS P2B2A-08 editor context now feeds the Round-native browser mutation path",
);

console.log(
  "PASS: Round Promotion Editor Context v1",
);
