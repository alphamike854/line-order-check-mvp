import fs from "node:fs";
import assert from "node:assert/strict";

const api =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
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

console.log(
  "===== Summary Group Point Promotion UI P1 v9.17 =====",
);

assert.match(
  api,
  /select\("summary_group_id,category,code,point_factor_pct,updated_at,updated_by"\)/,
);

console.log(
  "PASS P1UI-01 API returns Summary Group Promotion identity",
);

assert.match(
  api,
  /action === "SET_PROMOTION"/,
);

assert.match(
  api,
  /action === "DELETE_PROMOTION"/,
);

console.log(
  "PASS P1UI-02 settlement API supports live set/delete",
);

assert.match(
  api,
  /set_settlement_summary_group_point_promotion/,
);

assert.match(
  api,
  /delete_settlement_summary_group_point_promotion/,
);

console.log(
  "PASS P1UI-03 API uses audited DB RPCs",
);

assert.match(
  html,
  /id="settlementPromotionControls"/,
);

assert.match(
  html,
  /name="summary_group_id" required/,
);

console.log(
  "PASS P1UI-04 both live/open workflow have Summary Group UI",
);

assert.match(
  app,
  /summary_group_id,category,code,point_factor_pct/,
);

assert.match(
  app,
  /x\.summary_group_id===summary_group_id&&x\.category===category&&x\.code===code/,
);

console.log(
  "PASS P1UI-05 draft identity includes Summary Group",
);

assert.match(
  app,
  /function renderSettlementPromotionControls/,
);

assert.match(
  app,
  /function saveLivePromotion/,
);

assert.match(
  app,
  /function deleteLivePromotion/,
);

console.log(
  "PASS P1UI-06 OPEN settlement has live Promotion editor",
);

assert.match(
  app,
  /action:\s*"SET_ROUND_PROMOTION"/,
);

assert.match(
  app,
  /action:\s*"DELETE_ROUND_PROMOTION"/,
);

console.log(
  "PASS P1UI-07 browser sends scoped Round Promotion actions",
);

assert.match(
  app,
  /refreshAfterPromotionChange/,
);

assert.match(
  app,
  /loadSpecialPoints\(\s*settlementSessionId,\s*summaryGroupId,\s*\)/s,
);

console.log(
  "PASS P1UI-08 Promotion refreshes the authoritative Point context while downstream calculation cutover stays deferred",
);

assert.match(
  app,
  /แก้ไขได้ทั้งรอบ OPEN และ CLOSED/,
);

assert.match(
  app,
  /Point ปกติ 100%/,
);

console.log(
  "PASS P1UI-09 operator sees current Round editability and delete semantics",
);

assert.match(
  app,
  /\$\{formatNumber\(promotions\.length\)\} รายการ/,
);

console.log(
  "PASS P1UI-10 Round-scoped Promotion count remains labelled as entries",
);

console.log(
  "PASS: Summary Group Point Promotion UI P1 v9.17",
);
