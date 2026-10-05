import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

function sliceBetween(
  source,
  startMarker,
  endMarker,
) {
  const start =
    source.indexOf(
      startMarker,
    );

  assert.ok(
    start >= 0,
    `missing start marker: ${startMarker}`,
  );

  const end =
    source.indexOf(
      endMarker,
      start + startMarker.length,
    );

  assert.ok(
    end > start,
    `missing end marker: ${endMarker}`,
  );

  return source.slice(
    start,
    end,
  );
}

const staffEntry =
  sliceBetween(
    app,
    "async function enterStaffSession",
    "async function enterDashboardSession",
  );

console.log(
  "===== Staff Browser Loading State v9.22 =====",
);

assert.match(
  staffEntry,
  /\$\("#freshness"\)/,
);

console.log(
  "PASS SLS-01: Staff entry controls header status",
);

assert.match(
  staffEntry,
  /กำลังโหลดรายการตรวจ\.\.\./,
);

console.log(
  "PASS SLS-02: Staff loading text is Staff-specific",
);

assert.match(
  staffEntry,
  /await loadReviews\(\);/,
);

assert.match(
  staffEntry,
  /พร้อมใช้งาน/,
);

console.log(
  "PASS SLS-03: successful Review load clears loading state",
);

assert.match(
  staffEntry,
  /catch\s*\(error\)/,
);

assert.match(
  staffEntry,
  /โหลดรายการตรวจไม่สำเร็จ/,
);

assert.match(
  staffEntry,
  /throw error;/,
);

console.log(
  "PASS SLS-04: failed Review load exposes failure and preserves error flow",
);

assert.doesNotMatch(
  staffEntry,
  /loadDashboard\(/,
);

assert.doesNotMatch(
  staffEntry,
  /startFreshnessPolling/,
);

console.log(
  "PASS SLS-05: Staff mode still avoids Dashboard load/polling",
);

const loadPosition =
  staffEntry.indexOf(
    "กำลังโหลดรายการตรวจ...",
  );

const reviewPosition =
  staffEntry.indexOf(
    "await loadReviews();",
  );

const readyPosition =
  staffEntry.indexOf(
    "พร้อมใช้งาน",
  );

assert.ok(
  loadPosition >= 0
  && reviewPosition > loadPosition
  && readyPosition > reviewPosition,
  "Staff status order must be loading -> Review load -> ready",
);

console.log(
  "PASS SLS-06: status transition order is correct",
);

console.log(
  "PASS: Staff Browser Loading State v9.22",
);
