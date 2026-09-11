import assert from "node:assert/strict";
import fs from "node:fs";

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

const css =
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

const settlement =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
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

console.log(
  "===== Round Promotion Browser Cutover v1 =====",
);

assert.match(
  app,
  /specialPointEligibleLineGroups:\s*\[\]/,
);

assert.match(
  app,
  /specialPointRoundId:\s*null/,
);

assert.match(
  app,
  /payload\.eligible_line_groups\s*\|\|\s*\[\]/,
);

assert.match(
  app,
  /payload\.round_id\s*\|\|\s*null/,
);

console.log(
  "PASS P2B2B-01 browser stores authoritative Promotion editor context from Special Point GET",
);

const settlementPanelIndex =
  html.indexOf(
    'id="settlementPanel"',
  );

const pointsTabIndex =
  html.indexOf(
    'id="pointsTab"',
  );

const promotionRootIndex =
  html.indexOf(
    'id="settlementPromotionControls"',
  );

assert.ok(
  settlementPanelIndex >= 0
    && pointsTabIndex > settlementPanelIndex
    && promotionRootIndex > pointsTabIndex,
);

console.log(
  "PASS P2B2B-02 live Promotion editor lives inside the Points tab",
);

const settlementStatusStart =
  app.indexOf(
    "function renderSettlementStatus(",
  );

const loadSettlementStart =
  app.indexOf(
    "async function loadSettlement(",
  );

assert.ok(
  settlementStatusStart >= 0
    && loadSettlementStart
      > settlementStatusStart,
);

const settlementStatusSection =
  app.slice(
    settlementStatusStart,
    loadSettlementStart,
  );

assert.doesNotMatch(
  settlementStatusSection,
  /renderSettlementPromotionControls/,
);

assert.doesNotMatch(
  settlementStatusSection,
  /Promotion \$\{formatNumber\(\(payload\.promotions/,
);

console.log(
  "PASS P2B2B-03 settlement status no longer renders or counts legacy live Promotion state",
);

const loadPointStart =
  app.indexOf(
    "async function loadSpecialPoints(",
  );

const savePointStart =
  app.indexOf(
    "async function saveSpecialPoints(",
  );

assert.ok(
  loadPointStart >= 0
    && savePointStart > loadPointStart,
);

const loadPointSection =
  app.slice(
    loadPointStart,
    savePointStart,
  );

assert.match(
  loadPointSection,
  /state\.specialPointPromotions=/,
);

assert.match(
  loadPointSection,
  /state\.specialPointEligibleLineGroups=/,
);

assert.match(
  loadPointSection,
  /state\.specialPointRoundId=/,
);

assert.match(
  loadPointSection,
  /renderSettlementPromotionControls\(\s*payload,\s*\)/s,
);

console.log(
  "PASS P2B2B-04 Special Point load owns live Promotion rendering",
);

const renderStart =
  app.indexOf(
    "function renderSettlementPromotionControls(",
  );

const groupControlsStart =
  app.indexOf(
    "function renderSettlementGroupControls(",
  );

assert.ok(
  renderStart >= 0
    && groupControlsStart > renderStart,
);

const liveSection =
  app.slice(
    renderStart,
    groupControlsStart,
  );

assert.match(
  liveSection,
  /payload\?\.session/,
);

assert.match(
  liveSection,
  /payload\?\.selected_summary_group/,
);

assert.match(
  liveSection,
  /payload\?\.round_id/,
);

assert.match(
  liveSection,
  /payload\?\.eligible_line_groups/,
);

assert.match(
  liveSection,
  /กลุ่มนี้ยังไม่มีรอบปัจจุบัน/,
);

console.log(
  "PASS P2B2B-05 editor requires selected session + Summary Group + current Round",
);

assert.match(
  liveSection,
  /name="target_scope"[\s\S]*value="ALL"/,
);

assert.match(
  liveSection,
  /name="target_scope"[\s\S]*value="SELECTED"/,
);

assert.match(
  liveSection,
  /ทุก LINE Group/,
);

assert.match(
  liveSection,
  /เลือกเฉพาะ LINE Group/,
);

assert.match(
  liveSection,
  /name="line_group_ids"/,
);

console.log(
  "PASS P2B2B-06 UI exposes ALL and SELECTED LINE Group targets",
);

assert.match(
  liveSection,
  /targetScope === "SELECTED"[\s\S]*selectedLineGroupIds\.length/s,
);

assert.match(
  liveSection,
  /กรุณาเลือกอย่างน้อย 1 LINE Group/,
);

assert.match(
  liveSection,
  /targetScope === "SELECTED"[\s\S]*selectedLineGroupIds[\s\S]*:\s*\[\]/s,
);

console.log(
  "PASS P2B2B-07 SELECTED requires targets while ALL submits an empty target set",
);

const saveStart =
  app.indexOf(
    "async function saveLivePromotion(",
  );

const deleteStart =
  app.indexOf(
    "async function deleteLivePromotion(",
  );

assert.ok(
  saveStart >= 0
    && deleteStart > saveStart,
);

const saveSection =
  app.slice(
    saveStart,
    deleteStart,
  );

const nextFunction =
  app.indexOf(
    "function renderSettlementGroupControls(",
    deleteStart,
  );

const deleteSection =
  app.slice(
    deleteStart,
    nextFunction,
  );

assert.match(
  saveSection,
  /state\.specialPointSessionId/,
);

assert.match(
  saveSection,
  /state\.specialPointSummaryGroupId/,
);

assert.match(
  saveSection,
  /state\.specialPointRoundId/,
);

assert.match(
  saveSection,
  /SET_ROUND_PROMOTION/,
);

assert.match(
  saveSection,
  /target_scope:\s*targetScope/,
);

assert.match(
  saveSection,
  /line_group_ids:\s*lineGroupIds/,
);

assert.doesNotMatch(
  saveSection,
  /round_id\s*:/,
);

console.log(
  "PASS P2B2B-08 SET uses Special Point context and never sends round_id",
);

assert.match(
  deleteSection,
  /state\.specialPointSessionId/,
);

assert.match(
  deleteSection,
  /state\.specialPointSummaryGroupId/,
);

assert.match(
  deleteSection,
  /DELETE_ROUND_PROMOTION/,
);

assert.doesNotMatch(
  deleteSection,
  /round_id\s*:/,
);

console.log(
  "PASS P2B2B-09 DELETE uses the same server-resolved Round authority",
);

assert.match(
  liveSection,
  /data-target-scope=/,
);

assert.match(
  liveSection,
  /data-line-group-ids=/,
);

assert.match(
  liveSection,
  /JSON\.parse\(/,
);

assert.match(
  liveSection,
  /selectedSet\.has\(input\.value\)/,
);

console.log(
  "PASS P2B2B-10 editing restores ALL/SELECTED target state",
);

assert.match(
  liveSection,
  /async function refreshAfterPromotionChange\([\s\S]*loadSpecialPoints\(/,
);

assert.doesNotMatch(
  liveSection,
  /refreshAfterPromotionChange[\s\S]*loadReport\(/,
);

console.log(
  "PASS P2B2B-11 mutation refresh stays on Round-aware Point read path before production calculation cutover",
);

assert.match(
  css,
  /Phase 2C2P2B2B Round Promotion target editor/,
);

assert.match(
  css,
  /\.promotion-line-group-selector/,
);

assert.match(
  css,
  /\.promotion-target-scope/,
);

console.log(
  "PASS P2B2B-12 ALL/SELECTED editor has responsive target layout",
);

assert.match(
  html,
  /id="promotionDraftForm"/,
);

assert.match(
  app,
  /promotions:\s*state\.promotionDrafts/,
);

assert.match(
  app,
  /const rule=\{summary_group_id,category,code,point_factor_pct\}/,
);

console.log(
  "PASS P2B2B-13 opening-settlement Promotion draft flow remains unchanged",
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
  settlement,
  /action === "SET_ROUND_PROMOTION"/,
);

assert.match(
  settlement,
  /action === "DELETE_ROUND_PROMOTION"/,
);

console.log(
  "PASS P2B2B-14 legacy deployed-client compatibility remains alongside Round-native browser actions",
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
  "PASS P2B2B-15 Dashboard metadata delegates to P3A2 while Accounting cutover remains deferred",
);

console.log(
  "PASS: Round Promotion Browser Cutover v1",
);
