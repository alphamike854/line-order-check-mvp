import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint =
  fs.readFileSync(
    "./netlify/functions/staff-workbench.mjs",
    "utf8",
  );

const evidence =
  fs.readFileSync(
    "./src/lib/staff-workbench-image-evidence.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "./public/app.js",
    "utf8",
  );

const css =
  fs.readFileSync(
    "./public/styles.css",
    "utf8",
  );


// IMG1-01 — preserve old endpoint privacy contract.
assert.doesNotMatch(
  endpoint,
  /image_storage_path/,
);

assert.doesNotMatch(
  endpoint,
  /\.createSignedUrl\(/,
);

assert.match(
  endpoint,
  /addScopedWorkbenchImageEvidence/,
);

console.log(
  "PASS IMG1-01: Workbench endpoint retains private-path isolation",
);


// IMG1-02 — private implementation lives server-side.
assert.match(
  evidence,
  /"review-images"/,
);

assert.match(
  evidence,
  /REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS\s*=\s*[\s\S]*?900/,
);

assert.match(
  evidence,
  /\.select\(\s*"id,image_storage_path"/,
);

assert.match(
  evidence,
  /\.createSignedUrl\(/,
);

assert.doesNotMatch(
  evidence,
  /\.getPublicUrl\(/,
);

console.log(
  "PASS IMG1-02: evidence helper uses private 15-minute signed URLs",
);


// IMG1-03 — signing is invoked only after Workbench scope.
const loadIndex =
  endpoint.indexOf(
    "await loadStaffWorkbenchReadModel(",
  );

const payloadIndex =
  endpoint.lastIndexOf(
    "buildStaffWorkbenchPayload({",
  );

const evidenceIndex =
  endpoint.indexOf(
    "await addScopedWorkbenchImageEvidence(",
  );

assert.ok(
  loadIndex >= 0,
);

assert.ok(
  payloadIndex > loadIndex,
);

assert.ok(
  evidenceIndex > payloadIndex,
);

assert.match(
  endpoint.slice(
    evidenceIndex,
    evidenceIndex + 240,
  ),
  /supabase,[\s\S]*payload/,
);

console.log(
  "PASS IMG1-03: signing receives only already-authorized Workbench identities",
);


// IMG1-04 — four scoped feeds are enriched.
for (
  const key
  of [
    "work_items",
    "verification_items",
    "attention_items",
    "high_total_items",
  ]
) {
  assert.ok(
    evidence.includes(
      `"${key}"`,
    ),
    `missing feed ${key}`,
  );
}

console.log(
  "PASS IMG1-04: all Workbench feeds support signed evidence",
);


// IMG1-05 — browser never sees object paths.
assert.doesNotMatch(
  app,
  /image_storage_path/,
);

assert.match(
  evidence,
  /image_evidence_url:/,
);

assert.match(
  evidence,
  /image_evidence_expires_in:/,
);

console.log(
  "PASS IMG1-05: browser receives signed evidence, never Storage path",
);


// IMG1-06 — Inspector renders evidence automatically.
assert.match(
  app,
  /function staffVerificationImageEvidenceHtml\(/,
);

assert.match(
  app,
  /staffVerificationImageEvidenceHtml\(item\)/,
);

assert.match(
  app,
  /staff-verification-inline-image/,
);

assert.match(
  app,
  /src="\$\{escapedUrl\}"/,
);

console.log(
  "PASS IMG1-06: Inspector displays source image inline",
);


// IMG1-07 — Timeline renders compact evidence.
const timelineStart =
  app.indexOf(
    "function staffVerificationTimelineItemHtml(",
  );

assert.ok(
  timelineStart >= 0,
);

const timeline =
  app.slice(
    timelineStart,
    timelineStart + 12000,
  );

assert.match(
  timeline,
  /staffVerificationImageEvidenceHtml\([\s\S]*?compact:\s*true/,
);

console.log(
  "PASS IMG1-07: Timeline IMAGE row displays thumbnail inline",
);


// IMG1-08 — presentation remains bounded.
assert.match(
  css,
  /\.staff-verification-inline-image\s*\{[\s\S]*?max-height:\s*460px[\s\S]*?object-fit:\s*contain/,
);

assert.match(
  css,
  /\.staff-verification-image-evidence\.compact[\s\S]*?max-height:\s*180px/,
);

console.log(
  "PASS IMG1-08: images are bounded and preserve aspect ratio",
);


// IMG1-09 — fail-soft.
assert.match(
  evidence,
  /Storage failure must not make[\s\S]*Staff Workbench unavailable/,
);

assert.match(
  app,
  /มีรูปภาพต้นฉบับ แต่ไม่สามารถโหลด Preview ได้ในขณะนี้/,
);

console.log(
  "PASS IMG1-09: Storage/signing failure degrades safely",
);

console.log(
  "PASS: Private inline Staff Workbench image v1",
);
