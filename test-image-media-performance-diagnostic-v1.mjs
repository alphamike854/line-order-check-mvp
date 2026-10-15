"use strict";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  startImageMediaTiming,
  timeImageMediaStep,
  imageMediaTimingMeta,
  safeImageMediaTiming,
  logImageMediaTiming,
} from "./src/lib/image-media-perf.mjs";

const worker = fs.readFileSync("netlify/functions/line-image-media-qstash.mjs", "utf8");
const gateway = fs.readFileSync("netlify/functions/line-webhook.mjs", "utf8");
const helper = fs.readFileSync("src/lib/image-media-perf.mjs", "utf8");

assert.match(worker, /const imagePerf = startImageMediaTiming\(\)/);
assert.match(worker, /perf: imagePerf/);
assert.match(worker, /finally\s*\{\s*logImageMediaTiming\(/);
assert.match(gateway, /perf = null/);
assert.match(gateway, /timeImageMediaStep\(perf, "gemini_ocr_ms"/);
assert.match(gateway, /timeImageMediaStep\(perf, "line_download_ms"/);
assert.match(gateway, /timeImageMediaStep\(perf, "checkpoint_write_ms"/);
assert.match(gateway, /timeImageMediaStep\(perf, "evidence_store_ms"/);
assert.match(gateway, /timeImageMediaStep\(perf, "persist_ms"/);
// Preserve the independent production Golden G5 OCR fail-closed source contract.
const g5Parse = gateway.indexOf("const result = parseOrder(ocr.text, config);");
const g5Persist = gateway.indexOf("return persistParsedResult(", g5Parse);
assert.ok(g5Parse >= 0 && g5Persist > g5Parse, "Golden G5 Parse/Persist anchors");
const g5Between = gateway.slice(g5Parse, g5Persist);
assert.match(g5Between, /shouldReviewOcrParseResult/);
assert.match(g5Between, /OCR_PARSE_LOW_CONFIDENCE/);
assert.match(g5Between, /status:\s*"REVIEW"[\s\S]*items:\s*\[\]/);
assert.match(gateway, /timeImageMediaStep\(perf, "parse_ms"/);
assert.match(helper, /queue_wait_ms: null/);
assert.doesNotMatch(helper, /JSON\.stringify\(result\)|JSON\.stringify\(error\)/);

const timing = startImageMediaTiming();
assert.equal(await timeImageMediaStep(timing, "gemini_ocr_ms", async () => "ok"), "ok");
const sentinel = new Error("PRIVATE_PROVIDER_BODY_DO_NOT_LOG");
await assert.rejects(timeImageMediaStep(timing, "line_download_ms", async () => {
  throw sentinel;
}), (err) => err === sentinel);
assert.equal(timing.line_download_calls, 1);
imageMediaTimingMeta(timing, "image_bytes", 1024);
imageMediaTimingMeta(timing, "gemini_attempts", 2);
imageMediaTimingMeta(timing, "checkpoint_reused", true);
imageMediaTimingMeta(timing, "token", "SECRET_MUST_NOT_LOG");

const sample = safeImageMediaTiming(timing, {
  status: "PARSED",
  raw_text: "PRIVATE_OCR_TEXT_DO_NOT_LOG",
  webhookEventId: "PRIVATE_EVENT_ID_DO_NOT_LOG",
});
assert.equal(sample.outcome, "PARSED");
assert.equal(sample.gemini_attempts, 2);
assert.equal(sample.image_bytes, 1024);
assert.equal(sample.queue_wait_ms, null);
assert.ok(sample.total_ms >= 0);
assert.equal(sample.checkpoint_reused, true);
for (const secret of ["SECRET_MUST_NOT_LOG", "PRIVATE_OCR_TEXT_DO_NOT_LOG", "PRIVATE_EVENT_ID_DO_NOT_LOG", "PRIVATE_PROVIDER_BODY_DO_NOT_LOG"]) {
  assert.equal(JSON.stringify(sample).includes(secret), false);
}
assert.equal(safeImageMediaTiming(timing, { skipped: "RETIRED_ROUND" }).outcome, "SKIPPED");
assert.equal(safeImageMediaTiming(timing, {}, true).outcome, "ERROR");
assert.equal(await timeImageMediaStep(null, "gemini_ocr_ms", async () => "off"), "off");

const oldInfo = console.info;
try {
  console.info = () => { throw new Error("LOGGER_FAILURE"); };
  assert.doesNotThrow(() => logImageMediaTiming(timing, {}, true));
} finally {
  console.info = oldInfo;
}
console.log("PASS: IMAGE MEDIA PERF V1 safe durations, failure neutrality, metadata whitelist and source contract");
