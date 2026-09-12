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


assert.doesNotMatch(
  html,
  /id="closeSettlementButton"/,
);

assert.doesNotMatch(
  html,
  />ปิดยอดทั้งหมด</,
);

console.log(
  "PASS S1UI-02 global close action removed from operator UI",
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
  "PASS S1UI-04 UI uses independent OPEN_GROUP / CLOSE_GROUP",
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
  "PASS S1UI-05 group mutations remain independently scoped",
);


assert.match(
  app,
  /ข้อความใหม่ของกลุ่มนี้จะไม่เข้ายอด/,
);

assert.match(
  app,
  /จนกว่าจะเปิดรับยอดอีกครั้ง/,
);

console.log(
  "PASS S1UI-06 close copy matches group receiving boundary",
);


assert.doesNotMatch(
  app,
  /\$\("#closeSettlementButton"\)\.addEventListener/,
);

console.log(
  "PASS S1UI-07 no global close operator event binding",
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
  "PASS S1UI-08 explicit group open/closed styles remain",
);


console.log(
  "PASS: Summary Group settlement UI S1 v9.16 revised",
);
