"use strict";

const MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024;
const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

export function cleanOcrText(text) {
  let value = String(text ?? "").trim();
  value = value.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return value;
}

export function hasOcrUncertainty(text) {
  const value = String(text ?? "");
  return value.includes("?") || /\[UNCLEAR\]/i.test(value) || /ไม่ชัด/i.test(value);
}

export async function downloadLineImage(messageId, channelAccessToken) {
  if (!messageId) throw new Error("LINE_IMAGE_MESSAGE_ID_MISSING");
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN_MISSING");

  const response = await fetch(
    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${channelAccessToken}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LINE_IMAGE_DOWNLOAD_FAILED_${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const mimeType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!mimeType.startsWith("image/")) {
    throw new Error(`LINE_CONTENT_NOT_IMAGE: ${mimeType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("LINE_IMAGE_EMPTY");
  if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`IMAGE_TOO_LARGE_FOR_INLINE_OCR: ${bytes.length}`);
  }

  return {
    bytes,
    mimeType,
    sizeBytes: bytes.length,
  };
}

function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  return cleanOcrText(parts.map((part) => part?.text || "").join("\n"));
}

export async function transcribeOrderImage({
  bytes,
  mimeType,
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING");
  if (!bytes?.length) throw new Error("OCR_IMAGE_BYTES_MISSING");
  if (!mimeType?.startsWith("image/")) throw new Error(`OCR_UNSUPPORTED_MIME: ${mimeType}`);

  const prompt = [
    "Transcribe the order text visible in this image exactly enough for a deterministic parser.",
    "Rules:",
    "- Return ONLY the transcription. No explanation, no markdown, no JSON.",
    "- Preserve line breaks when they separate order lines.",
    "- Preserve leading zeros, for example 01 and 001.",
    "- Preserve these symbols exactly when visible: = x X * / - : ( )",
    "- Preserve Latin letters A B C D E F G and Thai text exactly when visible.",
    "- Do NOT calculate, normalize, infer, or correct the order.",
    "- If any character or token cannot be read confidently, write ? at that position instead of guessing.",
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GEMINI_OCR_FAILED_${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const payload = await response.json();
  const text = responseText(payload);
  if (!text) throw new Error("GEMINI_OCR_EMPTY_RESPONSE");

  return {
    text,
    provider: "GEMINI",
    model,
    uncertain: hasOcrUncertainty(text),
  };
}
