import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const styles =
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

const summaryStart =
  app.indexOf(
    "function staffVerificationTimelineItemSummary("
  );

assert.ok(
  summaryStart >= 0,
);

const summary =
  app.slice(
    summaryStart,
    summaryStart + 2200,
  );

assert.match(
  summary,
  /Review operational clarity v1/,
);

assert.match(
  summary,
  /staffVerificationSourceDisplayItems/,
);

assert.doesNotMatch(
  summary,
  /\.slice\(\s*0\s*,\s*5\s*\)/,
);

assert.match(
  summary,
  /\}\s*=\s*\$\{formatNumber\(/,
);

assert.match(
  app,
  /🟠 ยอดสูง · ระบบอ่านแล้ว/,
);

const sortedStart =
  app.indexOf(
    "function staffVerificationTimelineSortedItems("
  );

assert.ok(
  sortedStart >= 0,
);

const sorted =
  app.slice(
    sortedStart,
    sortedStart + 4200,
  );

assert.match(
  sorted,
  /\?\?\s*"OLDEST"/,
);

assert.match(
  sorted,
  /sortMode\s*===\s*"OLDEST"/,
);

assert.match(
  sorted,
  /sortMode\s*===\s*"HIGHEST"/,
);

assert.match(
  app,
  /_verificationTimelineSort\s*=\s*"OLDEST"/,
);

const controlsStart =
  app.indexOf(
    "function staffVerificationUpdateTimelineControls("
  );

assert.ok(
  controlsStart >= 0,
);

const controls =
  app.slice(
    controlsStart,
    controlsStart + 5000,
  );

assert.match(
  controls,
  /\.verification-timeline-sort/,
);

assert.match(
  controls,
  /sortControl\.value/,
);

assert.match(
  styles,
  /Review operational clarity v1/,
);

console.log(
  "PASS: Review operational clarity v1",
);
