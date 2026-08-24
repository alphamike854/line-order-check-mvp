import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const REVIEW_PREVIEW_TOKEN_VERSION = "v1";
export const REVIEW_PREVIEW_TTL_SECONDS = 15 * 60;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeBase64urlJson(value) {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function parserConfigFingerprint(config = {}) {
  return sha256(stableStringify({
    aliases: config.aliases ?? {},
    defaultCategoryByCodeLength: config.defaultCategoryByCodeLength ?? {},
  }));
}

export function reviewPreviewFingerprint({
  reviewId,
  messageRecordId,
  correctedText,
  normalizedText,
  parserVersion,
  items,
  parserConfig,
  summaryGroupId,
}) {
  return sha256(stableStringify({
    review_id: Number(reviewId),
    message_record_id: String(messageRecordId ?? ""),
    corrected_text_hash: sha256(correctedText),
    normalized_text: String(normalizedText ?? ""),
    parser_version: String(parserVersion ?? ""),
    items: (items ?? []).map((item) => ({
      category: String(item.category ?? ""),
      code: String(item.code ?? ""),
      quantity: Number(item.quantity ?? 0),
    })),
    parser_config_fingerprint: parserConfigFingerprint(parserConfig),
    summary_group_id: String(summaryGroupId ?? ""),
  }));
}

function signingKey(explicitKey) {
  const key = explicitKey || process.env.REVIEW_PREVIEW_SIGNING_KEY || process.env.DASHBOARD_ACCESS_KEY;
  if (!key) throw new Error("REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED");
  return key;
}

export function createReviewPreviewToken({
  reviewId,
  messageRecordId,
  fingerprint,
  nowMs = Date.now(),
  ttlSeconds = REVIEW_PREVIEW_TTL_SECONDS,
  key,
}) {
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: REVIEW_PREVIEW_TOKEN_VERSION,
    review_id: Number(reviewId),
    message_record_id: String(messageRecordId),
    fingerprint: String(fingerprint),
    iat: issuedAt,
    exp: issuedAt + Number(ttlSeconds),
  };
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", signingKey(key)).update(encoded, "utf8").digest("hex");
  return {
    token: `${REVIEW_PREVIEW_TOKEN_VERSION}.${encoded}.${signature}`,
    fingerprint: payload.fingerprint,
    issued_at: new Date(payload.iat * 1000).toISOString(),
    expires_at: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyReviewPreviewToken({
  token,
  reviewId,
  messageRecordId,
  expectedFingerprint,
  nowMs = Date.now(),
  key,
}) {
  if (!token) return { ok: false, error: "PREVIEW_REQUIRED" };
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts[0] !== REVIEW_PREVIEW_TOKEN_VERSION) {
    return { ok: false, error: "PREVIEW_TOKEN_INVALID" };
  }

  const [, encoded, suppliedSignature] = parts;
  let payload;
  try {
    payload = decodeBase64urlJson(encoded);
  } catch {
    return { ok: false, error: "PREVIEW_TOKEN_INVALID" };
  }

  const expectedSignature = createHmac("sha256", signingKey(key)).update(encoded, "utf8").digest("hex");
  if (!safeEqualHex(suppliedSignature, expectedSignature)) {
    return { ok: false, error: "PREVIEW_TOKEN_INVALID" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds) {
    return { ok: false, error: "PREVIEW_EXPIRED" };
  }

  if (
    Number(payload.review_id) !== Number(reviewId)
    || String(payload.message_record_id) !== String(messageRecordId)
    || !safeEqualHex(payload.fingerprint, expectedFingerprint)
  ) {
    return { ok: false, error: "PREVIEW_STALE" };
  }

  return {
    ok: true,
    fingerprint: payload.fingerprint,
    issued_at: new Date(Number(payload.iat) * 1000).toISOString(),
    expires_at: new Date(Number(payload.exp) * 1000).toISOString(),
  };
}
