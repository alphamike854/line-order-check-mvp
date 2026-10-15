"use strict";

// Observational timing only. Never include LINE identifiers, text, images,
// tokens, URLs, error messages or request bodies in diagnostic output.
const STAGES = Object.freeze([
  "message_lookup_ms",
  "checkpoint_read_ms",
  "line_download_ms",
  "gemini_ocr_ms",
  "checkpoint_write_ms",
  "evidence_store_ms",
  "parser_config_ms",
  "parse_ms",
  "persist_ms",
]);
const STATUS = new Set(["PARSED", "REVIEW", "PENDING", "IGNORED"]);
const SKIPPED = new Set(["RETIRED_ROUND", "MESSAGE_ALREADY_COMPLETE"]);

export function startImageMediaTiming() {
  return {
    started: performance.now(),
    stages: Object.fromEntries(STAGES.map((key) => [key, 0])),
    image_bytes: null,
    gemini_attempts: null,
    checkpoint_reused: false,
    line_download_calls: 0,
  };
}

export async function timeImageMediaStep(timing, stage, operation) {
  if (!timing) return operation();
  if (!STAGES.includes(stage)) throw new Error("UNKNOWN_IMAGE_PERF_STAGE");
  const began = performance.now();
  try {
    return await operation();
  } finally {
    timing.stages[stage] += Math.max(0, performance.now() - began);
    if (stage === "line_download_ms") timing.line_download_calls += 1;
  }
}

export function imageMediaTimingMeta(timing, field, value) {
  if (!timing) return;
  if (field === "checkpoint_reused") {
    timing.checkpoint_reused = value === true;
  } else if (field === "image_bytes") {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 15 * 1024 * 1024) {
      timing.image_bytes = n;
    }
  } else if (field === "gemini_attempts") {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 1 && n <= 3) {
      timing.gemini_attempts = n;
    }
  }
}

export function safeImageMediaTiming(timing, result, failed = false) {
  const totalMs = Math.max(0, Math.round(performance.now() - timing.started));
  const stages = Object.fromEntries(STAGES.map((key) => [
    key, Math.max(0, Math.round(timing.stages[key] || 0)),
  ]));
  const measured = Object.values(stages).reduce((a, b) => a + b, 0);
  const rawStatus = String(result?.status || "");
  const rawSkipped = String(result?.skipped || "");
  return {
    event: "LOC_IMAGE_MEDIA_PERF_V1",
    outcome: failed ? "ERROR" :
      SKIPPED.has(rawSkipped) ? "SKIPPED" :
      STATUS.has(rawStatus) ? rawStatus : "OTHER",
    skipped_reason: SKIPPED.has(rawSkipped) ? rawSkipped : null,
    total_ms: totalMs,
    stages_ms: stages,
    unmeasured_ms: Math.max(0, totalMs - measured),
    checkpoint_reused: timing.checkpoint_reused === true,
    line_download_calls: timing.line_download_calls,
    gemini_attempts: timing.gemini_attempts,
    image_bytes: timing.image_bytes,
    // QStash queue wait is NOT observed by this worker-only measurement.
    queue_wait_ms: null,
  };
}

export function logImageMediaTiming(timing, result, failed = false) {
  try {
    console.info("LOC_IMAGE_MEDIA_PERF_V1", JSON.stringify(
      safeImageMediaTiming(timing, result, failed),
    ));
  } catch {
    // Diagnostics must NEVER change QStash ACK or retry behavior.
  }
}
