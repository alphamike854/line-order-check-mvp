import assert from "node:assert/strict";

import {
  transcribeOrderImage,
} from "./src/lib/image-ocr.mjs";

const bytes = Buffer.from([1, 2, 3, 4]);

function geminiSuccess(text = "06=100") {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

function geminiError(status, message = "temporary") {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        message,
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}


// ============================================================
// 1. Two transient 503 responses then success.
// Must not fail after the first provider spike.
// ============================================================
{
  let fetchCalls = 0;
  const sleeps = [];

  const result = await transcribeOrderImage({
    bytes,
    mimeType: "image/jpeg",
    apiKey: "test-key",
    model: "test-model",

    fetchImpl: async () => {
      fetchCalls += 1;

      if (fetchCalls <= 2) {
        return geminiError(
          503,
          "This model is currently experiencing high demand.",
        );
      }

      return geminiSuccess("06=100");
    },

    retryDelaysMs: [10, 20],

    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(fetchCalls, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(result.text, "06=100");
  assert.equal(result.provider, "GEMINI");
  assert.equal(result.model, "test-model");
  assert.equal(result.uncertain, false);
  assert.equal(result.attempts, 3);
}


// ============================================================
// 2. Permanent client error must fail immediately.
// A 400 is not a transient provider-capacity error.
// ============================================================
{
  let fetchCalls = 0;
  const sleeps = [];

  await assert.rejects(
    () =>
      transcribeOrderImage({
        bytes,
        mimeType: "image/jpeg",
        apiKey: "test-key",
        model: "test-model",

        fetchImpl: async () => {
          fetchCalls += 1;
          return geminiError(400, "bad request");
        },

        retryDelaysMs: [10, 20],

        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
      }),
    /GEMINI_OCR_FAILED_400.*attempts=1/,
  );

  assert.equal(fetchCalls, 1);
  assert.deepEqual(sleeps, []);
}


// ============================================================
// 3. Persistent 503 gets exactly 3 total attempts.
// After bounded retries it still surfaces IMAGE_OCR_FAILED
// through the existing webhook behavior.
// ============================================================
{
  let fetchCalls = 0;
  const sleeps = [];

  await assert.rejects(
    () =>
      transcribeOrderImage({
        bytes,
        mimeType: "image/jpeg",
        apiKey: "test-key",
        model: "test-model",

        fetchImpl: async () => {
          fetchCalls += 1;
          return geminiError(
            503,
            "This model is currently experiencing high demand.",
          );
        },

        retryDelaysMs: [10, 20],

        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
      }),
    /GEMINI_OCR_FAILED_503.*attempts=3/,
  );

  assert.equal(fetchCalls, 3);
  assert.deepEqual(sleeps, [10, 20]);
}


// ============================================================
// 4. 429 rate-limit is also transient.
// ============================================================
{
  let fetchCalls = 0;

  const result = await transcribeOrderImage({
    bytes,
    mimeType: "image/png",
    apiKey: "test-key",

    fetchImpl: async () => {
      fetchCalls += 1;

      if (fetchCalls === 1) {
        return geminiError(429, "rate limited");
      }

      return geminiSuccess("23=500");
    },

    retryDelaysMs: [10, 20],
    sleepImpl: async () => {},
  });

  assert.equal(fetchCalls, 2);
  assert.equal(result.text, "23=500");
  assert.equal(result.attempts, 2);
}


console.log(
  "PASS: Gemini OCR bounded transient retry v8.10",
);
