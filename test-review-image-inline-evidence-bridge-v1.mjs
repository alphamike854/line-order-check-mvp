import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const marker =
  "/* Review IMAGE inline evidence bridge v1 */";

const bridgeStart =
  app.indexOf(marker);

const loadStart =
  app.indexOf(
    "async function loadReviews() {",
    bridgeStart,
  );

assert.ok(
  bridgeStart >= 0,
  "IMAGE evidence bridge exists",
);

assert.ok(
  loadStart > bridgeStart,
  "bridge is defined before loadReviews",
);

const bridgeSource =
  app.slice(
    bridgeStart,
    loadStart,
  );

for (
  const contract
  of [
    "verification_items",
    "attention_items",
    "high_total_items",
    "review_id",
    "image_evidence_url",
    "image_evidence_expires_in",
    "ocr_text",
    "raw_text",
    "normalized_text",
    "has_image_evidence",
  ]
) {
  assert.ok(
    bridgeSource.includes(
      contract,
    ),
    `missing bridge contract: ${contract}`,
  );
}

const factory =
  new Function(`
    ${bridgeSource}

    return {
      staffVerificationEnrichImageReviewEvidence,
    };
  `);

const {
  staffVerificationEnrichImageReviewEvidence,
} = factory();

const signedUrl =
  "https://example.invalid/private-image";

const payload = {
  verification_items: [
    {
      review_id: 101,
      message_type: "IMAGE",
      ocr_text: null,
      image_evidence_url: null,
      has_image_evidence: true,
    },
  ],

  attention_items: [
    {
      review_id: 101,
      message_type: "IMAGE",
      ocr_text: "",
    },
  ],

  high_total_items: [
    {
      review_id: 101,
      message_type: "IMAGE",
      ocr_text:
        "WORKBENCH OCR MUST WIN",
    },
  ],
};

const reviews = [
  {
    id: 101,
    message_type: "image",
    ocr_text:
      "12=50 21=50",
    raw_text: null,
    normalized_text:
      "12=50 21=50",
    image_evidence_url:
      signedUrl,
    image_evidence_expires_in:
      300,
  },
];

staffVerificationEnrichImageReviewEvidence(
  payload,
  reviews,
);

assert.equal(
  payload
    .verification_items[0]
    .ocr_text,
  "12=50 21=50",
  "missing Workbench OCR must be filled from Review",
);

assert.equal(
  payload
    .verification_items[0]
    .image_evidence_url,
  signedUrl,
  "signed Review image URL must reach Timeline item",
);

assert.equal(
  payload
    .verification_items[0]
    .has_image_evidence,
  true,
);

assert.equal(
  payload
    .attention_items[0]
    .ocr_text,
  "12=50 21=50",
  "PRIORITY feed must receive source evidence",
);

assert.equal(
  payload
    .high_total_items[0]
    .ocr_text,
  "WORKBENCH OCR MUST WIN",
  "existing canonical Workbench OCR must never be overwritten",
);

const unmatched = {
  verification_items: [
    {
      review_id: 999,
      message_type: "IMAGE",
      ocr_text: "UNCHANGED",
    },
  ],
};

staffVerificationEnrichImageReviewEvidence(
  unmatched,
  reviews,
);

assert.equal(
  unmatched
    .verification_items[0]
    .ocr_text,
  "UNCHANGED",
  "unmatched Workbench item remains unchanged",
);

const inlineStart =
  app.indexOf(
    "function staffVerificationInlineOriginalHtml(",
  );

const inlineEnd =
  app.indexOf(
    "function staffVerificationFirstSourceCodeLabel(",
    inlineStart,
  );

assert.ok(
  inlineStart >= 0
  && inlineEnd > inlineStart,
  "inline original renderer bounded",
);

const inline =
  app.slice(
    inlineStart,
    inlineEnd,
  );

assert.match(
  inline,
  /messageType\s*===\s*"IMAGE"[\s\S]*ไม่พบข้อความจาก OCR/,
  "IMAGE empty source has OCR-specific fallback",
);

assert.match(
  inline,
  /ไม่มีข้อความต้นฉบับ/,
  "TEXT fallback remains available",
);

const loadEnd =
  app.indexOf(
    "async function loadUnsends()",
    loadStart,
  );

assert.ok(
  loadEnd > loadStart,
  "loadReviews bounded",
);

const loadReviews =
  app.slice(
    loadStart,
    loadEnd,
  );

const bridgeCall =
  loadReviews.indexOf(
    "staffVerificationEnrichImageReviewEvidence(",
  );

const emptyGate =
  loadReviews.indexOf(
    "if (!items.length) {",
  );

assert.ok(
  bridgeCall >= 0,
  "loadReviews applies Review evidence bridge",
);

assert.ok(
  bridgeCall < emptyGate,
  "Review evidence bridge runs before Timeline rendering branch",
);

console.log(
  "PASS IMGREV-01: Review evidence joins Workbench by review_id",
);

console.log(
  "PASS IMGREV-02: signed image URL reaches Timeline IMAGE item",
);

console.log(
  "PASS IMGREV-03: missing OCR is filled without overriding canonical OCR",
);

console.log(
  "PASS IMGREV-04: all Timeline feeds receive evidence bridge",
);

console.log(
  "PASS IMGREV-05: IMAGE empty source says ไม่พบข้อความจาก OCR",
);

console.log(
  "PASS: Review IMAGE inline evidence bridge v1",
);
