import assert from "node:assert/strict";
import fs from "node:fs";

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

function between(
  startMarker,
  endMarker,
) {
  const start =
    app.indexOf(startMarker);

  const end =
    app.indexOf(
      endMarker,
      start + 1,
    );

  assert.ok(
    start >= 0 && end > start,
    `missing block ${startMarker}`,
  );

  return app.slice(
    start,
    end,
  );
}

const display =
  between(
    "/* Review display order v3 */",
    "function staffVerificationClaimStatusHtml(",
  );

assert.match(
  display,
  /staffVerificationSourceDisplayItems/,
);

assert.match(
  display,
  /ตามข้อความ/,
);

assert.match(
  display,
  /ตามหมวดและรหัส/,
);

assert.match(
  display,
  /staffVerificationComparisonHtml/,
);

console.log(
  "PASS RVD3-01: source/category presentation helpers exist",
);

const card =
  between(
    "function staffVerificationCardHtml(",
    "function hydrateStaffVerificationCards(",
  );

assert.match(
  card,
  /Review #/,
);

assert.match(
  card,
  /🖼 รูปภาพ/,
);

assert.match(
  card,
  /💬 ข้อความ/,
);

assert.match(
  card,
  /staffVerificationItemsHtml\([\s\S]*sourceText/,
);

assert.doesNotMatch(
  card,
  /staff-verification-technical/,
);

assert.doesNotMatch(
  card,
  /Parser:/,
);

console.log(
  "PASS RVD3-02: operator card is user-facing only",
);

const preview =
  between(
    "function staffVerificationPreviewHtml(",
    "function clearStaffVerificationPreview(",
  );

assert.match(
  preview,
  /originalItem\s*=\s*\{\}/,
);

assert.match(
  preview,
  /staffVerificationComparisonHtml/,
);

assert.match(
  preview,
  /originalItem\?\.items/,
);

assert.doesNotMatch(
  preview,
  /Parser:/,
);

console.log(
  "PASS RVD3-03: Preview compares Before/After per code",
);

const action =
  between(
    "async function previewStaffVerificationCorrection(",
    "async function applyStaffVerificationCorrection(",
  );

assert.match(
  action,
  /staffVerificationPreviewHtml\([\s\S]*card\._staffVerificationItem/,
);

for (const forbidden of [
  "corrected_order_items:",
  "corrected_parser_version:",
  "allowed_line_group_ids:",
  "staff_id:",
]) {
  assert.equal(
    action.includes(forbidden),
    false,
    `browser must not inject ${forbidden}`,
  );
}

console.log(
  "PASS RVD3-04: correction trust boundary is unchanged",
);

assert.match(
  css,
  /Review display order v3/,
);

assert.match(
  css,
  /staff-verification-items-toggle/,
);

assert.match(
  css,
  /staff-verification-comparison/,
);

console.log(
  "PASS: Staff Verification Review display v3",
);
