import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { round2 } from './risk-engine.mjs';

export const DISTRIBUTION_RUN_TOKEN_VERSION = 'v2';
export const DISTRIBUTION_RUN_TTL_SECONDS = 10 * 60;

function signingKey(explicitKey) {
  const key = explicitKey || process.env.RISK_TRANSFER_SIGNING_KEY || process.env.DASHBOARD_ACCESS_KEY;
  if (!key) throw new Error('RISK_TRANSFER_SIGNING_KEY_NOT_CONFIGURED');
  return key;
}
function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function decode(value) { return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); }
function equal(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function normalizeSnapshot(state) {
  const snapshot = {
    settlement_session_id: String(state.settlement_session_id || ''),
    summary_group_id: String(state.summary_group_id || ''),
    risk_pool: String(state.risk_pool || 'MAIN').toUpperCase(),
    risk_mode: String(state.risk_mode || 'RESERVE'),
    adjusted_received: round2(state.adjusted_received),
    risk_point_total: round2(state.risk_point_total),
    safety_margin: round2(state.safety_margin ?? state.net_safe_capacity),
    risk_pct: round2(state.risk_pct),
    point_loss_tolerance: round2(state.point_loss_tolerance),
    risk_budget: round2(state.risk_budget),
    excess_point_risk: round2(state.excess_point_risk),
    confirmed_cut_total: round2(state.confirmed_cut_total),
  };
  if (!/^[0-9a-f-]{36}$/i.test(snapshot.settlement_session_id)) throw new Error('INVALID_SETTLEMENT_SESSION_ID');
  if (!snapshot.summary_group_id) throw new Error('INVALID_SUMMARY_GROUP_ID');
  if (!['MAIN','H','L'].includes(snapshot.risk_pool)) throw new Error('INVALID_RISK_POOL');
  if (snapshot.risk_mode !== 'RESERVE') throw new Error('INVALID_RISK_MODE');
  return snapshot;
}

function normalizeRounds(rounds = []) {
  if (!Array.isArray(rounds) || !rounds.length) throw new Error('DISTRIBUTION_ROUNDS_REQUIRED');
  return rounds.map((round, index) => {
    const destination = String(round.destination || '').trim();
    const destinationLimit = Number(round.destination_limit);
    if (!destination || !Number.isSafeInteger(destinationLimit) || destinationLimit <= 0) throw new Error('INVALID_WAREHOUSE_BATCH_LIMIT');
    if (!Array.isArray(round.items) || !round.items.length) throw new Error('TRANSFER_ITEMS_REQUIRED');
    const items = round.items.map((item) => {
      const category = String(item.category || '').toUpperCase();
      const code = String(item.code || '').trim();
      const quantity = Number(item.quantity);
      const expectedRetained = Number(item.expected_retained_quantity);
      const expectedMultiplier = Number(item.expected_effective_multiplier);
      if (!['A','B','E','F','G','H','L'].includes(category) || !code || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_TRANSFER_ITEM');
      if (!Number.isFinite(expectedRetained) || expectedRetained < 0 || !Number.isFinite(expectedMultiplier) || expectedMultiplier < 0) throw new Error('INVALID_TRANSFER_ITEM');
      return {
        category,
        code,
        quantity,
        expected_retained_quantity: Math.floor(expectedRetained),
        expected_effective_multiplier: round2(expectedMultiplier),
      };
    });
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (quantity > destinationLimit) throw new Error('TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT');
    return { round_index: index + 1, destination, destination_limit: destinationLimit, quantity, items };
  });
}

export function createDistributionRunToken({ riskState, rounds, projectedRisk, requestId = randomUUID(), nowMs = Date.now(), ttlSeconds = DISTRIBUTION_RUN_TTL_SECONDS, key }) {
  const snapshot = normalizeSnapshot(riskState);
  const normalizedRounds = normalizeRounds(rounds);
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: DISTRIBUTION_RUN_TOKEN_VERSION,
    request_id: String(requestId),
    ...snapshot,
    rounds: normalizedRounds,
    planned_quantity: normalizedRounds.reduce((sum, round) => sum + round.quantity, 0),
    planned_rounds: normalizedRounds.length,
    projected_point_reserve: projectedRisk == null ? null : round2(projectedRisk.projected_point_reserve),
    projected_excess_point_risk: projectedRisk == null ? null : round2(projectedRisk.projected_excess_point_risk),
    iat: issuedAt,
    exp: issuedAt + Number(ttlSeconds),
  };
  const encoded = encode(payload);
  const signature = createHmac('sha256', signingKey(key)).update(encoded, 'utf8').digest('hex');
  return {
    token: `${DISTRIBUTION_RUN_TOKEN_VERSION}.${encoded}.${signature}`,
    request_id: payload.request_id,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    planned_quantity: payload.planned_quantity,
    planned_rounds: payload.planned_rounds,
    rounds: normalizedRounds,
    snapshot,
    projected_point_reserve: payload.projected_point_reserve,
    projected_excess_point_risk: payload.projected_excess_point_risk,
  };
}

export function verifyDistributionRunToken({ token, nowMs = Date.now(), key }) {
  if (!token) return { ok:false,error:'CONFIRMATION_REQUIRED' };
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== DISTRIBUTION_RUN_TOKEN_VERSION) return { ok:false,error:'CONFIRMATION_TOKEN_INVALID' };
  const [,encoded,supplied] = parts;
  let payload;
  try { payload = decode(encoded); } catch { return { ok:false,error:'CONFIRMATION_TOKEN_INVALID' }; }
  const expected = createHmac('sha256', signingKey(key)).update(encoded, 'utf8').digest('hex');
  if (!equal(supplied, expected)) return { ok:false,error:'CONFIRMATION_TOKEN_INVALID' };
  const now = Math.floor(nowMs / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < now) return { ok:false,error:'CONFIRMATION_EXPIRED' };
  try {
    return {
      ok:true,
      request_id:String(payload.request_id),
      snapshot:normalizeSnapshot(payload),
      rounds:normalizeRounds(payload.rounds),
      planned_quantity:Number(payload.planned_quantity || 0),
      planned_rounds:Number(payload.planned_rounds || 0),
      projected_point_reserve:payload.projected_point_reserve == null ? null : round2(payload.projected_point_reserve),
      projected_excess_point_risk:payload.projected_excess_point_risk == null ? null : round2(payload.projected_excess_point_risk),
      expires_at:new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return { ok:false,error:'CONFIRMATION_TOKEN_INVALID' };
  }
}
