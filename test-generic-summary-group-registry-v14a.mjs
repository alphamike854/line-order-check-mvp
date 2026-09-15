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

const oldRemap =
  fs.readFileSync(
    "supabase/migrations/20260827053000_live_summary_group_remap.sql",
    "utf8",
  );

// V14A-01
assert.match(
  settlement,
  /Generic Summary Group Registry v14A/,
);

assert.match(
  settlement,
  /\.from\("summary_groups"\)[\s\S]*\.select\("id,name,enabled"\)/,
);

console.log(
  "PASS V14A-01: summary_groups is registry authority",
);

// V14A-02
assert.match(
  settlement,
  /enabledMasterGroupIds[\s\S]*row\.enabled !== false/,
);

assert.match(
  settlement,
  /groupIds = \[[\s\S]*enabledMasterGroupIds[\s\S]*configResult\.data[\s\S]*roundResult\.data/,
);

console.log(
  "PASS V14A-02: master-only groups enter group-state union",
);

// V14A-03
assert.match(
  settlement,
  /mapped_line_group_count:[\s\S]*mappedLineGroupCount/,
);

assert.match(
  settlement,
  /has_enabled_mapping:[\s\S]*mappedLineGroupCount > 0/,
);

assert.match(
  settlement,
  /round_status:[\s\S]*"NOT_STARTED"/,
);

console.log(
  "PASS V14A-03: unmapped group is explicit NOT_STARTED",
);

// V14A-04
assert.match(
  settlement,
  /\.from\("settlement_line_group_config"\)[\s\S]*"summary_group_id"[\s\S]*summaryGroupId[\s\S]*\.eq\("enabled", true\)[\s\S]*SUMMARY_GROUP_NOT_IN_SETTLEMENT/,
);

console.log(
  "PASS V14A-04: OPEN_GROUP remains mapping-gated",
);

// V14A-05
assert.match(
  app,
  /currentGroupState\?\.has_enabled_mapping[\s\S]*=== false[\s\S]*ยังไม่มี LINE Group/,
);

console.log(
  "PASS V14A-05: browser blocks OPEN for unmapped group",
);

// V14A-06
assert.match(
  app,
  /payload\.summary_group_states[\s\S]*\.filter\([\s\S]*has_enabled_mapping[\s\S]*!== false[\s\S]*\.map/,
);

console.log(
  "PASS V14A-06: Point workflow remains mapping-scoped",
);

// V14A-07
const implementation =
  settlement + "\n" + app;

for (const hardcoded of [
  '"EAST"',
  '"WEST"',
  '"CENTRAL"',
]) {
  assert.equal(
    implementation.includes(hardcoded),
    false,
    `unexpected hard-coded group ${hardcoded}`,
  );
}

console.log(
  "PASS V14A-07: EAST/WEST/future groups remain data-driven",
);

// V14A-08
// V14A deliberately does not alter old remap semantics.
// Round-safe remap is isolated to V14B.
assert.match(
  oldRemap,
  /update public\.messages[\s\S]*set summary_group_id = p_summary_group_id/,
);

assert.match(
  oldRemap,
  /update public\.order_items[\s\S]*set summary_group_id = p_summary_group_id/,
);

console.log(
  "PASS V14A-08: legacy remap remains isolated for V14B",
);

// V14A-09
assert.match(
  app,
  /const hasEnabledMapping =[\s\S]*item\.has_enabled_mapping !== false/,
);

assert.match(
  app,
  /!accepting[\s\S]*&& !hasEnabledMapping[\s\S]*disabled[\s\S]*ต้องผูก LINE Group ที่เปิดใช้งานก่อน/,
);

assert.match(
  app,
  /!accepting[\s\S]*&& !hasEnabledMapping[\s\S]*รอผูก LINE Group/,
);

console.log(
  "PASS V14A-09: unmapped OPEN affordance is disabled at render time",
);

// V14A-10
assert.match(
  app,
  /item\.summary_group_name[\s\S]*\|\| groupName\(id\)[\s\S]*\|\| id/,
);

assert.match(
  app,
  /const mappingText =[\s\S]*mappedLineGroupCount[\s\S]*LINE Group/,
);

assert.match(
  app,
  /ยังไม่มี LINE Group ที่เปิดใช้งาน/,
);

console.log(
  "PASS V14A-10: generic label and mapping state are operator-visible",
);

// V14A-11
assert.match(
  app,
  /!accepting[\s\S]*&& !hasEnabledMapping[\s\S]*\? `disabled/,
);

assert.match(
  app,
  /: accepting[\s\S]*\? "ปิดรับยอด"/,
);

console.log(
  "PASS V14A-11: an already OPEN Round retains CLOSE affordance",
);

console.log(
  "PASS: Generic Summary Group Registry v14A",
);
