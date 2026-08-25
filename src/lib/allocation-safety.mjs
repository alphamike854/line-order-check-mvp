import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ALLOCATION_CONFIRM_TOKEN_VERSION = "v1";
export const ALLOCATION_CONFIRM_TTL_SECONDS = 10 * 60;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeBase64urlJson(value) {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function safeEqualString(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function signingKey(explicitKey) {
  const key = explicitKey || process.env.ALLOCATION_CONFIRM_SIGNING_KEY || process.env.DASHBOARD_ACCESS_KEY;
  if (!key) throw new Error("ALLOCATION_CONFIRM_SIGNING_KEY_NOT_CONFIGURED");
  return key;
}

function integer(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`INVALID_${field}`);
  return number;
}

function normalizedSnapshot(row) {
  const snapshot = {
    settlement_session_id: String(row.settlement_session_id ?? ""),
    business_date: String(row.business_date ?? ""),
    summary_group_id: String(row.summary_group_id ?? ""),
    category: String(row.category ?? "").trim().toUpperCase(),
    code: String(row.code ?? "").trim(),
    order_total: integer(row.order_total, "ORDER_TOTAL"),
    threshold: integer(row.threshold, "THRESHOLD"),
    destination: row.destination == null || String(row.destination).trim() === "" ? null : String(row.destination),
    should_transfer: integer(row.should_transfer, "SHOULD_TRANSFER"),
    confirmed_transfer: integer(row.confirmed_transfer, "CONFIRMED_TRANSFER"),
    transfer_now: integer(row.transfer_now, "TRANSFER_NOW"),
  };

  if (!/^[0-9a-f-]{36}$/i.test(snapshot.settlement_session_id)) throw new Error("INVALID_SETTLEMENT_SESSION_ID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.business_date)) throw new Error("INVALID_BUSINESS_DATE");
  if (!snapshot.summary_group_id) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!["A", "B", "E", "F", "G"].includes(snapshot.category)) throw new Error("INVALID_CATEGORY");
  if (!snapshot.code) throw new Error("INVALID_CODE");
  if (snapshot.threshold <= 0) throw new Error("INVALID_THRESHOLD");
  if (snapshot.transfer_now <= 0) throw new Error("NO_TRANSFER_REQUIRED");
  if (snapshot.should_transfer - snapshot.confirmed_transfer !== snapshot.transfer_now) {
    throw new Error("INVALID_ALLOCATION_SNAPSHOT");
  }

  return snapshot;
}

export function createAllocationConfirmationToken({
  allocation,
  requestId = randomUUID(),
  nowMs = Date.now(),
  ttlSeconds = ALLOCATION_CONFIRM_TTL_SECONDS,
  key,
}) {
  const issuedAt = Math.floor(nowMs / 1000);
  const snapshot = normalizedSnapshot(allocation);
  const payload = {
    v: ALLOCATION_CONFIRM_TOKEN_VERSION,
    request_id: String(requestId),
    ...snapshot,
    iat: issuedAt,
    exp: issuedAt + Number(ttlSeconds),
  };
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", signingKey(key)).update(encoded, "utf8").digest("hex");
  return {
    token: `${ALLOCATION_CONFIRM_TOKEN_VERSION}.${encoded}.${signature}`,
    request_id: payload.request_id,
    issued_at: new Date(payload.iat * 1000).toISOString(),
    expires_at: new Date(payload.exp * 1000).toISOString(),
    snapshot,
  };
}

export function verifyAllocationConfirmationToken({ token, nowMs = Date.now(), key }) {
  if (!token) return { ok: false, error: "CONFIRMATION_REQUIRED" };
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts[0] !== ALLOCATION_CONFIRM_TOKEN_VERSION) {
    return { ok: false, error: "CONFIRMATION_TOKEN_INVALID" };
  }

  const [, encoded, suppliedSignature] = parts;
  let payload;
  try {
    payload = decodeBase64urlJson(encoded);
  } catch {
    return { ok: false, error: "CONFIRMATION_TOKEN_INVALID" };
  }

  const expectedSignature = createHmac("sha256", signingKey(key)).update(encoded, "utf8").digest("hex");
  if (!safeEqualString(suppliedSignature, expectedSignature)) {
    return { ok: false, error: "CONFIRMATION_TOKEN_INVALID" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds) {
    return { ok: false, error: "CONFIRMATION_EXPIRED" };
  }

  if (!payload.request_id || payload.v !== ALLOCATION_CONFIRM_TOKEN_VERSION) {
    return { ok: false, error: "CONFIRMATION_TOKEN_INVALID" };
  }

  let snapshot;
  try {
    snapshot = normalizedSnapshot(payload);
  } catch {
    return { ok: false, error: "CONFIRMATION_TOKEN_INVALID" };
  }

  return {
    ok: true,
    request_id: String(payload.request_id),
    issued_at: new Date(Number(payload.iat) * 1000).toISOString(),
    expires_at: new Date(Number(payload.exp) * 1000).toISOString(),
    snapshot,
  };
}
