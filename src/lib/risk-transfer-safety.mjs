import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { compactTransferLines, round2 } from "./risk-engine.mjs";

export const RISK_TRANSFER_TOKEN_VERSION = "v3";
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
    if (!["A","B","E","F","G","H","L"].includes(category) || !code || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("INVALID_TRANSFER_ITEM");
    const key = `${category}|${code}`;
    if (seen.has(key)) throw new Error("DUPLICATE_TRANSFER_ITEM");
    seen.add(key);
    const expectedRetained = Number(item.expected_retained_quantity);
    const expectedMultiplier = Number(item.expected_effective_multiplier);
    const expectedRecommended = Number(item.expected_recommended_transfer);
    return {
      category,
      code,
      quantity,
      expected_retained_quantity: Number.isFinite(expectedRetained) ? expectedRetained : null,
      expected_effective_multiplier: Number.isFinite(expectedMultiplier) ? round2(expectedMultiplier) : null,
      expected_recommended_transfer: Number.isFinite(expectedRecommended) ? expectedRecommended : null,
    };
  }).sort((a,b)=>a.category.localeCompare(b.category)||a.code.localeCompare(b.code));
}
function normalizeRiskState(state) {
  const snapshot = {
    settlement_session_id: String(state.settlement_session_id || ""),
    summary_group_id: String(state.summary_group_id || ""),
    risk_mode: String(state.risk_mode || "RESERVE"),
    adjusted_received: round2(state.adjusted_received),
    risk_point_total: round2(state.risk_point_total),
    safety_margin: round2(state.safety_margin ?? state.net_safe_capacity),
    risk_pct: round2(state.risk_pct),
    point_loss_tolerance: round2(state.point_loss_tolerance),
    risk_budget: round2(state.risk_budget),
    excess_point_risk: round2(state.excess_point_risk),
    confirmed_cut_total: round2(state.confirmed_cut_total),
  };
  if (!/^[0-9a-f-]{36}$/i.test(snapshot.settlement_session_id)) throw new Error("INVALID_SETTLEMENT_SESSION_ID");
  if (!snapshot.summary_group_id) throw new Error("INVALID_SUMMARY_GROUP_ID");
  if (snapshot.risk_mode !== "RESERVE") throw new Error("INVALID_RISK_MODE");
  for (const value of [snapshot.adjusted_received,snapshot.risk_point_total,snapshot.safety_margin,snapshot.risk_pct,snapshot.point_loss_tolerance,snapshot.risk_budget,snapshot.excess_point_risk,snapshot.confirmed_cut_total]) {
    if (!Number.isFinite(value)) throw new Error("INVALID_RISK_STATE");
  }
  return snapshot;
}

export function createRiskTransferToken({ riskState, destination, destinationLimit, items, projectedRisk = null, requestId = randomUUID(), nowMs = Date.now(), ttlSeconds = RISK_TRANSFER_TTL_SECONDS, key }) {
  const snapshot = normalizeRiskState(riskState);
  if (snapshot.excess_point_risk <= 0) throw new Error("NO_RISK_DISTRIBUTION_REQUIRED");
  const normalizedItems = normalizeItems(items);
  const cutTotal = normalizedItems.reduce((sum,item)=>sum+item.quantity,0);
  const limit = Number(destinationLimit);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("INVALID_WAREHOUSE_BATCH_LIMIT");
  if (cutTotal > limit) throw new Error("TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT");
  for (const item of normalizedItems) {
    if (item.expected_recommended_transfer != null && item.quantity > item.expected_recommended_transfer) throw new Error("TRANSFER_EXCEEDS_CODE_RECOMMENDATION");
  }
  const dest = String(destination || "").trim();
  if (!dest) throw new Error("DESTINATION_REQUIRED");
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: RISK_TRANSFER_TOKEN_VERSION,
    request_id: String(requestId),
    ...snapshot,
    destination: dest,
    destination_limit: limit,
    items: normalizedItems,
    cut_total: cutTotal,
    projected_point_reserve: projectedRisk == null ? null : round2(projectedRisk.projected_point_reserve),
    projected_excess_point_risk: projectedRisk == null ? null : round2(projectedRisk.projected_excess_point_risk),
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
    destination_limit: limit,
    projected_point_reserve: payload.projected_point_reserve,
    projected_excess_point_risk: payload.projected_excess_point_risk,
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
    const destinationLimit = Number(payload.destination_limit);
    if (!destination || !payload.request_id || !Number.isSafeInteger(destinationLimit) || destinationLimit <= 0) throw new Error("INVALID");
    return {
      ok:true,
      request_id:String(payload.request_id),
      snapshot,
      items,
      destination,
      destination_limit:destinationLimit,
      cut_total:items.reduce((s,i)=>s+i.quantity,0),
      projected_point_reserve:payload.projected_point_reserve == null ? null : round2(payload.projected_point_reserve),
      projected_excess_point_risk:payload.projected_excess_point_risk == null ? null : round2(payload.projected_excess_point_risk),
      expires_at:new Date(payload.exp*1000).toISOString(),
    };
  } catch {
    return {ok:false,error:"CONFIRMATION_TOKEN_INVALID"};
  }
}
