import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const worker =
  fs.readFileSync(
    "netlify/functions/line-image-media-qstash.mjs",
    "utf8",
  );

assert.match(
  source,
  /async function loadImageOcrCheckpoint\(/,
);

assert.match(
  source,
  /\.select\([\s\S]*ocr_text[\s\S]*ocr_provider[\s\S]*ocr_model[\s\S]*ocr_status[\s\S]*image_content_type[\s\S]*image_size_bytes/,
);

assert.match(
  source,
  /\["DONE", "UNCERTAIN"\]\.includes\([\s\S]*data\.ocr_status/,
);

assert.match(
  source,
  /if \(mediaWorker\) \{[\s\S]*await loadImageOcrCheckpoint\([\s\S]*message\.id/,
);

assert.match(
  source,
  /ocrCheckpoint[\s\S]*ocr = \{[\s\S]*text:[\s\S]*ocrCheckpoint\.ocr_text/,
);

const checkpointRead =
  source.indexOf(
    "await loadImageOcrCheckpoint(",
  );

const guardedHeavy =
  source.indexOf(
    "if (!ocr) {",
    checkpointRead,
  );

const lineDownload =
  source.indexOf(
    "image = await downloadLineImage(",
    guardedHeavy,
  );

const gemini =
  source.indexOf(
    "ocr = await transcribeOrderImage({",
    lineDownload,
  );

const checkpointWrite =
  source.indexOf(
    "error: checkpointError",
    gemini,
  );

const parser =
  source.indexOf(
    "const config = await loadParserConfig();",
    checkpointWrite,
  );

assert.ok(
  checkpointRead >= 0
  && checkpointRead < guardedHeavy
  && guardedHeavy < lineDownload
  && lineDownload < gemini
  && gemini < checkpointWrite
  && checkpointWrite < parser,
  "checkpoint ordering must be read -> guarded heavy OCR -> checkpoint write -> parser",
);

assert.match(
  source,
  /if \(!ocrCheckpoint\) \{[\s\S]*\.from\("messages"\)[\s\S]*\.update\([\s\S]*baseUpdate[\s\S]*\.eq\([\s\S]*"id"[\s\S]*message\.id/,
);

assert.match(
  source,
  /ocr_status:[\s\S]*ocr\.uncertain[\s\S]*"UNCERTAIN"[\s\S]*"DONE"/,
);

assert.match(
  source,
  /image_content_type:[\s\S]*image\?\.mimeType[\s\S]*ocrCheckpoint\?\.image_content_type/,
);

assert.match(
  source,
  /image_size_bytes:[\s\S]*image\?\.sizeBytes[\s\S]*ocrCheckpoint\?\.image_size_bytes/,
);

/*
 * A resumed checkpoint that later needs Review may fetch the original
 * image again for evidence, but must not call Gemini again.
 */
assert.match(
  source,
  /if \(ocr\.uncertain\) \{[\s\S]*if \(!image\) \{[\s\S]*downloadLineImage\(/,
);

assert.match(
  source,
  /if \(parserNeedsHumanReview\) \{[\s\S]*if \(!image\) \{[\s\S]*downloadLineImage\(/,
);

/*
 * Existing bounded retry semantics remain unchanged.
 */
assert.match(
  source,
  /retryableProviderFailure[\s\S]*Number\(processingAttempt \|\| 1\) < 3/,
);

assert.match(
  source,
  /IMAGE_OCR_FAILED/,
);

/*
 * Q2B media transport / serialization remains intact.
 */
assert.match(
  source,
  /deduplicationId:[\s\S]*line-image-media-/,
);

assert.match(
  source,
  /key:[\s\S]*"line-image-media-v1"[\s\S]*parallelism:\s*1/,
);

assert.match(
  worker,
  /upstash-retried/,
);

assert.match(
  worker,
  /retried \+ 1/,
);

/*
 * No new current-Round admission is introduced in the media worker.
 */
assert.doesNotMatch(
  worker,
  /line_webhook_ingress_admission|readLineWebhookIngressAdmission/,
);

console.log(
  "PASS Q2C-01: OCR checkpoint uses existing message columns",
);
console.log(
  "PASS Q2C-02: media retry reads checkpoint before heavy OCR",
);
console.log(
  "PASS Q2C-03: fresh OCR checkpoint is persisted before parser",
);
console.log(
  "PASS Q2C-04: DONE/UNCERTAIN checkpoints are resumable",
);
console.log(
  "PASS Q2C-05: review may redownload image without re-running Gemini",
);
console.log(
  "PASS Q2C-06: bounded OCR attempt-3 terminal semantics retained",
);
console.log(
  "PASS Q2C-07: media parallelism remains 1",
);
console.log(
  "PASS Q2C-08: immutable Round admission model unchanged",
);
console.log(
  "PASS: Q2C OCR checkpoint/resume contract",
);
