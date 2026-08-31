"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const css =
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

assert.match(
  html,
  /id="settlementGroupControls"/,
);
console.log(
  "PASS S1UI-01 Summary Group control container exists",
);

assert.match(
  html,
  />ปิดยอดทั้งหมด</,
);
console.log(
  "PASS S1UI-02 global close action is explicitly labelled",
);

assert.match(
  app,
  /function renderSettlementGroupControls\(payload\)/,
);

assert.match(
  app,
  /summary_group_states/,
);
console.log(
  "PASS S1UI-03 group states render from settlement API",
);

assert.match(
  app,
  /action:\s*nextAccepting[\s\S]*"OPEN_GROUP"[\s\S]*"CLOSE_GROUP"/,
);
console.log(
  "PASS S1UI-04 UI uses OPEN_GROUP and CLOSE_GROUP",
);

assert.match(
  app,
  /settlement_session_id:\s*open\.id/,
);

assert.match(
  app,
  /summary_group_id:\s*summaryGroupId/,
);
console.log(
  "PASS S1UI-05 group mutations are scoped to session and Summary Group",
);

assert.match(
  app,
  /ข้อความใหม่ของกลุ่มนี้จะไม่เข้ายอด/,
);

assert.match(
  app,
  /หน้าตรวจรายการ/,
);
console.log(
  "PASS S1UI-06 close confirmation explains Review behavior",
);

assert.match(
  app,
  /ปิดยอดทั้งหมดของรอบนี้/,
);

assert.match(
  app,
  /ยังมี \$\{formatNumber\(acceptingGroupCount\)\} กลุ่มเปิดรับยอด/,
);
console.log(
  "PASS S1UI-07 global close warns about accepting groups",
);

assert.match(
  css,
  /\.settlement-group-control-row/,
);

assert.match(
  css,
  /\.settlement-group-state\.open/,
);

assert.match(
  css,
  /\.settlement-group-state\.closed/,
);
console.log(
  "PASS S1UI-08 group control UI has explicit open/closed states",
);

console.log(
  "PASS: Summary Group settlement UI S1 v9.16",
);
