import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { compactTransferLines, round2 } from "./risk-engine.mjs";

export const RISK_TRANSFER_TOKEN_VERSION = "v1";
export const RISK_TRANSFER_TTL_SECONDS = 10 * 60;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decodeBase64urlJson(value) {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}
function signingKey(explicitKey) {
  const key = explicitKey || process.env.RISK_TRANSFER_SIGNING_KEY || process.env.DASHBOARD_ACCESS_KEY;
  if (!key) throw new Error("RISK_TRANSFER_SIGNING_KEY_NOT_CONFIGURED");
  return key;
}
function safeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
function normalizeItems(items = []) {
  if (!Array.isArray(items) || !items.length) throw new Error("TRANSFER_ITEMS_REQUIRED");
  const seen = new Set();
  return items.map((item) => {
    const category = String(item.category || "").toUpperCase();
    const code = String(item.code || "").trim();
    const quantity = Number(item.quantity);
    if (!["A","B","E","F","G"].includes(category) || !code || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("INVALID_TRANSFER_ITEM");
    const key = `${category}|${code}`;
    if (seen.has(key)) throw new Error("DUPLICATE_TRANSFER_ITEM");
    seen.add(key);
    return { category, code, quantity };
  }).sort((a,b)=>a.category.localeCompare(b.category)||a.code.localeCompare(b.code));
}
function normalizeRiskState(state) {
  const snapshot = {
    settlement_session_id: String(state.settlement_session_id || ""),
    summary_group_id: String(state.summary_group_id || ""),
    risk_mode: String(state.risk_mode || "RESERVE"),
    adjusted_received: round2(state.adjusted_received),
    risk_point_total: round2(state.risk_point_total),
    net_safe_capacity: round2(state.net_safe_capacity),
    confirmed_cut_total: round2(state.confirmed_cut_total),
    remaining_safe_capacity: round2(state.remaining_safe_capacity),
  };
  if (!/^[0-9a-f-]{36}$/i.test(snapshot.settlement_session_id)) throw new Error("INVALID_SETTLEMENT_SESSION_ID");
  if (!snapshot.summary_group_id) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (!["RESERVE","ACTUAL"].includes(snapshot.risk_mode)) throw new Error("INVALID_RISK_MODE");
  return snapshot;
}

export function createRiskTransferToken({ riskState, destination, items, requestId = randomUUID(), nowMs = Date.now(), ttlSeconds = RISK_TRANSFER_TTL_SECONDS, key }) {
  const snapshot = normalizeRiskState(riskState);
  const normalizedItems = normalizeItems(items);
  const cutTotal = normalizedItems.reduce((sum,item)=>sum+item.quantity,0);
  if (cutTotal > snapshot.remaining_safe_capacity + 1e-9) throw new Error("TRANSFER_EXCEEDS_SAFE_CAPACITY");
  const dest = String(destination || "").trim();
  if (!dest) throw new Error("DESTINATION_REQUIRED");
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: RISK_TRANSFER_TOKEN_VERSION,
    request_id: String(requestId),
    ...snapshot,
    destination: dest,
    items: normalizedItems,
    cut_total: cutTotal,
    iat: issuedAt,
    exp: issuedAt + Number(ttlSeconds),
  };
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", signingKey(key)).update(encoded, "utf8").digest("hex");
  return {
    token: `${RISK_TRANSFER_TOKEN_VERSION}.${encoded}.${signature}`,
    request_id: payload.request_id,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    cut_total: cutTotal,
    lines: compactTransferLines(normalizedItems),
    snapshot,
    items: normalizedItems,
  };
}

export function verifyRiskTransferToken({ token, nowMs = Date.now(), key }) {
  if (!token) return { ok:false,error:"CONFIRMATION_REQUIRED" };
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts[0] !== RISK_TRANSFER_TOKEN_VERSION) return { ok:false,error:"CONFIRMATION_TOKEN_INVALID" };
  const [,encoded,supplied] = parts;
  let payload;
  try { payload = decodeBase64urlJson(encoded); } catch { return {ok:false,error:"CONFIRMATION_TOKEN_INVALID"}; }
  const expected = createHmac("sha256", signingKey(key)).update(encoded,"utf8").digest("hex");
  if (!safeEqualString(supplied,expected)) return {ok:false,error:"CONFIRMATION_TOKEN_INVALID"};
  const now = Math.floor(nowMs/1000);
  if (!Number.isFinite(payload.exp) || payload.exp < now) return {ok:false,error:"CONFIRMATION_EXPIRED"};
  try {
    const snapshot = normalizeRiskState(payload);
    const items = normalizeItems(payload.items);
    const destination = String(payload.destination || "").trim();
    if (!destination || !payload.request_id) throw new Error("INVALID");
    return { ok:true, request_id:String(payload.request_id), snapshot, items, destination, cut_total:items.reduce((s,i)=>s+i.quantity,0), expires_at:new Date(payload.exp*1000).toISOString() };
  } catch {
    return {ok:false,error:"CONFIRMATION_TOKEN_INVALID"};
  }
}
