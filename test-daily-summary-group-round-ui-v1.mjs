"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const settlement =
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
  "===== Daily Summary Group Round API/UI v1 =====",
);


// DR1B-01
assert.match(
  settlement,
  /"round_no"[\s\S]*"business_date"[\s\S]*"daily_round_no"[\s\S]*"status"/,
);

console.log(
  "PASS DR1B-01: API reads daily Round identity",
);


// DR1B-02
assert.match(
  settlement,
  /business_date:\s*[\s\S]*openRound\?\.business_date[\s\S]*latestRound\?\.business_date/,
);

assert.match(
  settlement,
  /daily_round_no:\s*[\s\S]*openRound\?\.daily_round_no[\s\S]*latestRound\?\.daily_round_no/,
);

console.log(
  "PASS DR1B-02: group state exposes date and daily round",
);


// DR1B-03
assert.match(
  app,
  /function formatBusinessDateThai\(value\)/,
);

assert.match(
  app,
  /new Intl\.DateTimeFormat\(\s*"th-TH"/,
);

assert.match(
  app,
  /timeZone:\s*"Asia\/Bangkok"/,
);

console.log(
  "PASS DR1B-03: business date displays in Thai",
);


// DR1B-04
assert.match(
  app,
  /item\.daily_round_no[\s\S]*internalRoundNo/,
);

assert.match(
  app,
  /เปิดรับยอด · \$\{identityText\}/,
);

assert.match(
  app,
  /ปิดรับยอด · \$\{identityText\}/,
);

console.log(
  "PASS DR1B-04: UI uses daily Round number",
);


// DR1B-05
assert.match(
  app,
  /businessDate !== todayBangkok\(\)/,
);

assert.match(
  app,
  /⚠ เปิดรับยอดข้ามวัน/,
);

console.log(
  "PASS DR1B-05: cross-midnight OPEN Round warns without auto-close",
);


// DR1B-06
assert.match(
  app,
  /openingNewBusinessDate/,
);

assert.match(
  app,
  /เปิดรับยอดวันนี้ \$\{label\}/,
);

assert.match(
  app,
  /openingNewBusinessDate[\s\S]*เปิดรับยอดวันนี้ \$\{label\}[\s\S]*ระบบจะเริ่ม[\s\S]*formatBusinessDateThai[\s\S]*todayBusinessDate[\s\S]*รอบ 1/,
);

console.log(
  "PASS DR1B-06: reopening on later date is presented as Round 1",
);


// DR1B-07
assert.match(
  app,
  /"OPEN_GROUP"[\s\S]*"CLOSE_GROUP"/,
);

assert.match(
  app,
  /summary_group_id:\s*[\s\S]*summaryGroupId/,
);

console.log(
  "PASS DR1B-07: Summary Groups remain independent",
);


// DR1B-08
assert.doesNotMatch(
  html,
  /closeSettlementButton/,
);

assert.doesNotMatch(
  app,
  /\$\("#closeSettlementButton"\)\.addEventListener/,
);

console.log(
  "PASS DR1B-08: global close removed from operator controls",
);


// DR1B-09
assert.match(
  app,
  /พร้อมรับยอดรายกลุ่ม/,
);

assert.doesNotMatch(
  app,
  /เปิดยอดอยู่ · \$\{open\.business_date\}/,
);

console.log(
  "PASS DR1B-09: parent session date is no longer active Round date",
);


// DR1B-10
assert.match(
  app,
  /จนกว่าจะเปิดรับยอดอีกครั้ง/,
);

console.log(
  "PASS DR1B-10: closed-group copy matches future ignore behavior",
);



const reportRoundUiSourceD1B1B2B=
  fs.readFileSync(
    new URL(
      "./public/app.js",
      import.meta.url,
    ),
    "utf8",
  );

const reportRoundHelperStart=
  reportRoundUiSourceD1B1B2B.indexOf(
    "function reportRoundIdentityLabel(group) {",
  );

const reportRoundHelperEnd=
  reportRoundUiSourceD1B1B2B.indexOf(
    "function reportSpecialDetail(row) {",
    reportRoundHelperStart,
  );

assert.ok(
  reportRoundHelperStart>=0
  && reportRoundHelperEnd>reportRoundHelperStart,
);

const reportRoundHelper=
  reportRoundUiSourceD1B1B2B.slice(
    reportRoundHelperStart,
    reportRoundHelperEnd,
  );

assert.match(
  reportRoundHelper,
  /group\?\.business_date/,
);

assert.match(
  reportRoundHelper,
  /group\?\.daily_round_no/,
);

assert.match(
  reportRoundHelper,
  /group\?\.round_status/,
);

assert.match(
  reportRoundHelper,
  /รอบประจำวัน/,
);

const reportUiStartD1B1B2B=
  reportRoundUiSourceD1B1B2B.indexOf(
    "function renderReport(",
  );

const reportUiEndD1B1B2B=
  reportRoundUiSourceD1B1B2B.indexOf(
    "let reportLoadVersion = 0;",
    reportUiStartD1B1B2B,
  );

assert.ok(
  reportUiStartD1B1B2B>=0
  && reportUiEndD1B1B2B>reportUiStartD1B1B2B,
);

const reportUiD1B1B2B=
  reportRoundUiSourceD1B1B2B.slice(
    reportUiStartD1B1B2B,
    reportUiEndD1B1B2B,
  );

assert.match(
  reportUiD1B1B2B,
  /reportRoundIdentityLabel\(g\)/,
);

assert.match(
  reportUiD1B1B2B,
  /\.map\(g=>g\.business_date\)/,
);

assert.match(
  reportUiD1B1B2B,
  /\.map\(g=>g\.round_status\)/,
);

assert.match(
  reportUiD1B1B2B,
  /reportBusinessDates\.length>1/,
);

assert.match(
  reportUiD1B1B2B,
  /reportRoundStatuses\.length>1/,
);

assert.match(
  reportUiD1B1B2B,
  /hasClosedRound&&!allReady/,
);

assert.doesNotMatch(
  reportUiD1B1B2B,
  /payload\.session\.business_date/,
);

assert.doesNotMatch(
  reportUiD1B1B2B,
  /payload\.session\.status/,
);

assert.doesNotMatch(
  reportUiD1B1B2B,
  /payload\.session\.closed_at/,
);

console.log(
  "PASS DR1B-11: Report UI derives visible identity from each Summary Group Round",
);


assert.match(
  reportRoundUiSourceD1B1B2B,
  /reportSessionSelect/,
);

console.log(
  "PASS DR1B-12: parent settlement remains report history\/container selector",
);



const specialPointRoundApi=
  fs.readFileSync(
    new URL(
      "./netlify/functions/special-points.mjs",
      import.meta.url,
    ),
    "utf8",
  );

assert.match(
  specialPointRoundApi,
  /id,round_no,business_date,daily_round_no,status/,
);

assert.match(
  specialPointRoundApi,
  /business_date:\s*[\s\S]*roundRead\.round\?\.business_date/,
);

assert.match(
  specialPointRoundApi,
  /daily_round_no:\s*[\s\S]*roundRead\.round\?\.daily_round_no/,
);

console.log(
  "PASS DR1B-13: Special Point API exposes selected Round date and daily identity",
);


assert.match(
  reportRoundUiSourceD1B1B2B,
  /state\.specialPointBusinessDate/,
);

assert.match(
  reportRoundUiSourceD1B1B2B,
  /state\.specialPointDailyRoundNo/,
);

assert.match(
  reportRoundUiSourceD1B1B2B,
  /reportRoundIdentityLabel\(\{/,
);

assert.match(
  reportRoundUiSourceD1B1B2B,
  /ข้อมูลเดิม · ยังไม่มี Round/,
);

console.log(
  "PASS DR1B-14: Special Point editor displays selected Round identity instead of parent settlement identity",
);


console.log(
  "PASS: Daily Summary Group Round API/UI v1",
);
