import assert from "node:assert/strict";
import fs from "node:fs";

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const ingress =
  fs.readFileSync(
    "netlify/functions/line-webhook-qstash.mjs",
    "utf8",
  );

const worker =
  fs.readFileSync(
    "netlify/functions/line-image-media-qstash.mjs",
    "utf8",
  );

assert.match(
  webhook,
  /LINE_IMAGE_MEDIA_QSTASH_ENABLED/,
);

assert.match(
  webhook,
  /process\.env\.LINE_IMAGE_MEDIA_QSTASH_ENABLED[\s\S]*\?\?\s*""/,
);

assert.match(
  webhook,
  /!mediaWorker[\s\S]*isLineImageMediaQStashEnabled\(\)[\s\S]*mediaQueueUrl/,
);

const queue =
  webhook.indexOf(
    "await enqueueLineImageMediaQStash({",
  );

const download =
  webhook.indexOf(
    "image = await downloadLineImage(",
  );

const ocr =
  webhook.indexOf(
    "ocr = await transcribeOrderImage({",
  );

assert.ok(
  queue >= 0
  && queue < download
  && download < ocr,
);

assert.match(
  webhook,
  /deduplicationId:\s*[\s\S]*line-image-media-/,
);

assert.match(
  webhook,
  /key:\s*[\s\S]*"line-image-media-v1"/,
);

assert.match(
  webhook,
  /parallelism:\s*1/,
);

assert.match(
  webhook,
  /rate:\s*2/,
);

assert.match(
  webhook,
  /retries:\s*5/,
);

assert.match(
  webhook,
  /export async function processImageMediaJob/,
);

assert.match(
  webhook,
  /findMessageByWebhookEvent\([\s\S]*event\.webhookEventId/,
);

assert.match(
  webhook,
  /MESSAGE_ALREADY_COMPLETE/,
);

assert.match(
  webhook,
  /handleImageMessage\([\s\S]*processingAttempt[\s\S]*true,/,
);

assert.match(
  ingress,
  /\/api\/line-image-media-qstash/,
);

assert.match(
  ingress,
  /mediaQueueUrl:/,
);

assert.match(
  worker,
  /Receiver/,
);

assert.match(
  worker,
  /receiver\.verify/,
);

assert.match(
  worker,
  /upstash-retried/,
);

assert.match(
  worker,
  /const processingAttempt\s*=\s*[\s\S]*retried \+ 1/,
);

assert.match(
  worker,
  /processImageMediaJob/,
);

assert.match(
  worker,
  /region:\s*"sin"/,
);

assert.doesNotMatch(
  worker,
  /claimWebhookEvent|line_webhook_ingress_admission/,
);

console.log(
  "PASS Q2B-01: media gate defaults OFF",
);
console.log(
  "PASS Q2B-02: async cut precedes LINE download/OCR",
);
console.log(
  "PASS Q2B-03: media jobs use independent flow control",
);
console.log(
  "PASS Q2B-04: worker is QStash-signature protected",
);
console.log(
  "PASS Q2B-05: QStash retry count maps to OCR processing attempt",
);
console.log(
  "PASS Q2B-06: worker reuses immutable admitted message",
);
console.log(
  "PASS Q2B-07: worker bypasses webhook claim/admission",
);
console.log(
  "PASS Q2B-08: legacy/background path remains inline without mediaQueueUrl",
);
console.log(
  "PASS: Q2B image media isolation foundation",
);
