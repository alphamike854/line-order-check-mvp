import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const backend =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

console.log(
  "===== Staff Verification Parse Status UI Gate v1 =====",
);

assert.match(
  app,
  /function staffVerificationParseReady\([\s\S]*?parse_status[\s\S]*?=== "PARSED"/,
);

console.log(
  "PASS VPG-01: UI defines exact PARSED eligibility",
);

const claimStart =
  app.indexOf(
    "function staffVerificationClaimStatusHtml(",
  );

const resolutionStart =
  app.indexOf(
    "function staffVerificationResolutionHtml(",
    claimStart,
  );

assert.ok(
  claimStart >= 0
  && resolutionStart > claimStart,
);

const claimHtml =
  app.slice(
    claimStart,
    resolutionStart,
  );

assert.match(
  claimHtml,
  /!staffVerificationParseReady\(item\)/,
);

assert.match(
  claimHtml,
  /รายการนี้ไม่พร้อมตรวจยืนยัน/,
);

assert.match(
  claimHtml,
  /อ่านอย่างเดียว/,
);

console.log(
  "PASS VPG-02: non-PARSED PENDING items expose no claim/renew workflow",
);

const mutateStart =
  app.indexOf(
    "function staffVerificationCanMutate(",
  );

const mutateEnd =
  app.indexOf(
    "function staffVerificationIssueText(",
    mutateStart,
  );

const mutate =
  app.slice(
    mutateStart,
    mutateEnd,
  );

assert.match(
  mutate,
  /staffVerificationParseReady\(/,
);

console.log(
  "PASS VPG-03: confirm/correction mutation is also PARSED-gated",
);

const resolutionEnd =
  app.indexOf(
    "function staffVerificationImageEvidenceHtml(",
    resolutionStart,
  );

const resolution =
  app.slice(
    resolutionStart,
    resolutionEnd,
  );

assert.match(
  resolution,
  /!staffVerificationParseReady\(/,
);

console.log(
  "PASS VPG-04: correction controls stay hidden for non-PARSED items",
);

assert.match(
  backend,
  /message\.parse_status[\s\S]*?!== "PARSED"[\s\S]*?MESSAGE_NOT_READY_FOR_VERIFICATION/,
);

console.log(
  "PASS VPG-05: authoritative backend guard remains intact",
);

console.log(
  "PASS: Staff Verification Parse Status UI Gate v1",
);
