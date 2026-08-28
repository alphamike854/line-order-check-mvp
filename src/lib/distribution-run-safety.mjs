import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEFAULT_RISK_BAND_SIZE, round2 } from './risk-engine.mjs';

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


export const LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION = 'v3';

function round3(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 1000,
  ) / 1000;
}

function normalizeLineGroupSnapshot(state) {
  const snapshot = {
    settlement_session_id: String(
      state.settlement_session_id || '',
    ),

    line_group_id: String(
      state.line_group_id || '',
    ).trim(),

    summary_group_id: String(
      state.summary_group_id || '',
    ).trim(),

    risk_pool: String(
      state.risk_pool || 'MAIN',
    ).toUpperCase(),

    risk_model: String(
      state.risk_model
        || 'CATEGORY_RETENTION',
    ).toUpperCase(),

    gross_received: Number(
      state.gross_received,
    ),

    calculation_band: Number(
      state.calculation_band,
    ),

    reduction_pct: round3(
      state.reduction_pct,
    ),

    risk_budget: round2(
      state.risk_budget,
    ),
  };

  if (
    !/^[0-9a-f-]{36}$/i.test(
      snapshot.settlement_session_id,
    )
  ) {
    throw new Error(
      'INVALID_SETTLEMENT_SESSION_ID',
    );
  }

  if (!snapshot.line_group_id) {
    throw new Error(
      'INVALID_LINE_GROUP_ID',
    );
  }

  if (!snapshot.summary_group_id) {
    throw new Error(
      'INVALID_SUMMARY_GROUP_ID',
    );
  }

  if (
    !['MAIN','H','L'].includes(
      snapshot.risk_pool,
    )
  ) {
    throw new Error(
      'INVALID_RISK_POOL',
    );
  }

  if (
    snapshot.risk_model
    !== 'CATEGORY_RETENTION'
  ) {
    throw new Error(
      'INVALID_RISK_MODEL',
    );
  }

  if (
    !Number.isSafeInteger(
      snapshot.gross_received,
    )
    || snapshot.gross_received < 0
  ) {
    throw new Error(
      'INVALID_LINE_GROUP_GROSS_RECEIVED',
    );
  }

  if (
    !Number.isSafeInteger(
      snapshot.calculation_band,
    )
    || snapshot.calculation_band <= 0
    || snapshot.calculation_band
      % DEFAULT_RISK_BAND_SIZE !== 0
  ) {
    throw new Error(
      'INVALID_RISK_CALCULATION_BAND',
    );
  }

  if (
    snapshot.gross_received
      < snapshot.calculation_band
    || snapshot.gross_received
      >= snapshot.calculation_band
        + DEFAULT_RISK_BAND_SIZE
  ) {
    throw new Error(
      'RISK_BAND_STATE_MISMATCH',
    );
  }

  if (
    !Number.isFinite(
      snapshot.reduction_pct,
    )
    || snapshot.reduction_pct < 0
    || snapshot.reduction_pct > 100
  ) {
    throw new Error(
      'INVALID_LINE_GROUP_REDUCTION_PCT',
    );
  }

  const expectedBudget = round2(
    snapshot.calculation_band
    * (100 - snapshot.reduction_pct)
    / 100,
  );

  if (
    Math.abs(
      expectedBudget
      - snapshot.risk_budget,
    ) > 0.009
  ) {
    throw new Error(
      'RISK_BUDGET_STATE_MISMATCH',
    );
  }

  return snapshot;
}


function normalizeLineGroupRounds(rounds = []) {
  if (
    !Array.isArray(rounds)
    || !rounds.length
  ) {
    throw new Error(
      'DISTRIBUTION_ROUNDS_REQUIRED',
    );
  }

  return rounds.map((round, index) => {
    const destination = String(
      round.destination || '',
    ).trim();

    const destinationLimit = Number(
      round.destination_limit,
    );

    if (
      !destination
      || !Number.isSafeInteger(
        destinationLimit,
      )
      || destinationLimit <= 0
    ) {
      throw new Error(
        'INVALID_WAREHOUSE_BATCH_LIMIT',
      );
    }

    if (
      !Array.isArray(round.items)
      || !round.items.length
    ) {
      throw new Error(
        'TRANSFER_ITEMS_REQUIRED',
      );
    }

    const items = round.items.map(
      (item) => {
        const lineGroupId = String(
          item.line_group_id || '',
        ).trim();

        const category = String(
          item.category || '',
        ).toUpperCase();

        const code = String(
          item.code || '',
        ).trim();

        const quantity = Number(
          item.quantity,
        );

        const expectedRetained = Number(
          item.expected_retained_quantity,
        );

        const expectedMultiplier = Number(
          item.expected_effective_multiplier,
        );

        const retentionLimit = Number(
          item.retention_limit,
        );

        if (!lineGroupId) {
          throw new Error(
            'LINE_GROUP_ID_REQUIRED',
          );
        }

        if (
          !['A','B','E','F','G','H','L']
            .includes(category)
          || !code
          || !Number.isSafeInteger(quantity)
          || quantity <= 0
          || !Number.isSafeInteger(
            expectedRetained,
          )
          || expectedRetained < 0
          || !Number.isFinite(
            expectedMultiplier,
          )
          || expectedMultiplier <= 0
          || !Number.isSafeInteger(
            retentionLimit,
          )
          || retentionLimit < 0
          || expectedRetained
            <= retentionLimit
          || quantity
            > expectedRetained
              - retentionLimit
        ) {
          throw new Error(
            'INVALID_TRANSFER_ITEM',
          );
        }

        return {
          line_group_id: lineGroupId,
          category,
          code,
          quantity,
          expected_retained_quantity:
            expectedRetained,
          expected_effective_multiplier:
            round3(expectedMultiplier),
          retention_limit:
            retentionLimit,
        };
      },
    );

    const quantity = items.reduce(
      (sum, item) =>
        sum + item.quantity,
      0,
    );

    if (quantity > destinationLimit) {
      throw new Error(
        'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT',
      );
    }

    return {
      round_index: index + 1,
      destination,
      destination_limit:
        destinationLimit,
      quantity,
      items,
    };
  });
}


function validateLineGroupRoundContract(
  snapshot,
  rounds,
) {
  const allowed = snapshot.risk_pool === 'MAIN'
    ? new Set(['A','B','E','F','G'])
    : new Set([snapshot.risk_pool]);

  const totals = new Map();

  for (const round of rounds) {
    for (const item of round.items) {
      if (
        item.line_group_id
        !== snapshot.line_group_id
      ) {
        throw new Error(
          'LINE_GROUP_MISMATCH',
        );
      }

      if (!allowed.has(item.category)) {
        throw new Error(
          'INVALID_RISK_POOL_CATEGORY',
        );
      }

      const key =
        `${item.category}|${item.code}`;

      const existing = totals.get(key);

      if (!existing) {
        totals.set(key, {
          quantity: item.quantity,
          expected_retained_quantity:
            item.expected_retained_quantity,
          expected_effective_multiplier:
            item.expected_effective_multiplier,
          retention_limit:
            item.retention_limit,
        });

        continue;
      }

      if (
        existing.expected_retained_quantity
          !== item.expected_retained_quantity
        || existing.retention_limit
          !== item.retention_limit
        || Math.abs(
          existing.expected_effective_multiplier
          - item.expected_effective_multiplier,
        ) > 0.0009
      ) {
        throw new Error(
          'INCONSISTENT_TRANSFER_SNAPSHOT',
        );
      }

      existing.quantity += item.quantity;
    }
  }

  for (const state of totals.values()) {
    const expectedCut =
      state.expected_retained_quantity
      - state.retention_limit;

    if (state.quantity !== expectedCut) {
      throw new Error(
        'LINE_GROUP_RECOMMENDATION_INCOMPLETE',
      );
    }
  }
}


export function createLineGroupDistributionRunToken({
  riskState,
  rounds,
  requestId = randomUUID(),
  nowMs = Date.now(),
  ttlSeconds =
    DISTRIBUTION_RUN_TTL_SECONDS,
  key,
}) {
  const snapshot =
    normalizeLineGroupSnapshot(
      riskState,
    );

  const normalizedRounds =
    normalizeLineGroupRounds(
      rounds,
    );

  validateLineGroupRoundContract(
    snapshot,
    normalizedRounds,
  );

  const issuedAt =
    Math.floor(nowMs / 1000);

  const payload = {
    v:
      LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION,

    request_id:
      String(requestId),

    ...snapshot,

    rounds: normalizedRounds,

    planned_quantity:
      normalizedRounds.reduce(
        (sum, round) =>
          sum + round.quantity,
        0,
      ),

    planned_rounds:
      normalizedRounds.length,

    iat: issuedAt,

    exp:
      issuedAt + Number(ttlSeconds),
  };

  const encoded = encode(payload);

  const signature = createHmac(
    'sha256',
    signingKey(key),
  )
    .update(encoded, 'utf8')
    .digest('hex');

  return {
    token:
      `${LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION}.${encoded}.${signature}`,

    request_id:
      payload.request_id,

    expires_at:
      new Date(
        payload.exp * 1000,
      ).toISOString(),

    planned_quantity:
      payload.planned_quantity,

    planned_rounds:
      payload.planned_rounds,

    rounds:
      normalizedRounds,

    snapshot,
  };
}


export function verifyLineGroupDistributionRunToken({
  token,
  nowMs = Date.now(),
  key,
}) {
  if (!token) {
    return {
      ok: false,
      error: 'CONFIRMATION_REQUIRED',
    };
  }

  const parts =
    String(token).split('.');

  if (
    parts.length !== 3
    || parts[0]
      !== LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION
  ) {
    return {
      ok: false,
      error:
        'CONFIRMATION_TOKEN_INVALID',
    };
  }

  const [, encoded, supplied] = parts;

  let payload;

  try {
    payload = decode(encoded);
  } catch {
    return {
      ok: false,
      error:
        'CONFIRMATION_TOKEN_INVALID',
    };
  }

  const expected = createHmac(
    'sha256',
    signingKey(key),
  )
    .update(encoded, 'utf8')
    .digest('hex');

  if (!equal(supplied, expected)) {
    return {
      ok: false,
      error:
        'CONFIRMATION_TOKEN_INVALID',
    };
  }

  const now =
    Math.floor(nowMs / 1000);

  if (
    !Number.isFinite(payload.exp)
    || payload.exp < now
  ) {
    return {
      ok: false,
      error:
        'CONFIRMATION_EXPIRED',
    };
  }

  try {
    const snapshot =
      normalizeLineGroupSnapshot(
        payload,
      );

    const rounds =
      normalizeLineGroupRounds(
        payload.rounds,
      );

    validateLineGroupRoundContract(
      snapshot,
      rounds,
    );

    return {
      ok: true,

      request_id:
        String(payload.request_id),

      snapshot,

      rounds,

      planned_quantity:
        Number(
          payload.planned_quantity || 0,
        ),

      planned_rounds:
        Number(
          payload.planned_rounds || 0,
        ),

      expires_at:
        new Date(
          payload.exp * 1000,
        ).toISOString(),
    };
  } catch {
    return {
      ok: false,
      error:
        'CONFIRMATION_TOKEN_INVALID',
    };
  }
}
