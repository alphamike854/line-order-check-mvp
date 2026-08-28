import { json, requireDashboardAccess, supabase } from '../../src/lib/dashboard-api.mjs';

import {
  buildRiskDistributionPlan,
  projectRiskAfterTransfers,
} from '../../src/lib/risk-engine.mjs';

import {
  splitDistributionRounds,
  splitLineGroupDistributionRounds,
} from '../../src/lib/distribution-round-planner.mjs';

import {
  createDistributionRunToken,
  createLineGroupDistributionRunToken,
} from '../../src/lib/distribution-run-safety.mjs';


function normalizeSelectedCodes(items = []) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map(
        (item) =>
          `${String(item.category || '').toUpperCase()}|${String(item.code || '').trim()}`,
      )
      .filter((key) => /^[ABEFGHL]\|.+$/.test(key)),
  );
}


function poolAllowsCategory(riskPool, category) {
  if (riskPool === 'MAIN') {
    return ['A', 'B', 'E', 'F', 'G'].includes(category);
  }

  return category === riskPool;
}


function statusForError(message) {
  if (
    message.includes('WAREHOUSE')
    || message.includes('DISTRIBUTION')
    || message.includes('RISK_')
    || message.includes('LINE_GROUP_')
    || message.includes('POINT_MULTIPLIER')
    || message.includes('NO_SELECTED')
    || message.includes('NO_RISK')
  ) {
    return 409;
  }

  if (
    message.includes('REQUIRED')
    || message.includes('INVALID')
  ) {
    return 400;
  }

  return 500;
}


/**
 * v8.9.4 LINE Group CATEGORY_RETENTION preview.
 *
 * This path is selected only when body.line_group_id is present.
 * It intentionally does NOT use the legacy unit-by-unit Risk planner.
 */
async function previewLineGroupRetention({
  session,
  lineGroupId,
  requestedSummaryGroupId,
  riskPool,
  destinations,
  selected,
}) {
  const [
    { data: risk, error: riskError },
    { data: codes, error: codeError },
    { data: warehouseRows, error: warehouseError },
  ] = await Promise.all([
    supabase
      .from('session_line_group_risk_state')
      .select(
        [
          'settlement_session_id',
          'business_date',
          'line_group_id',
          'line_group_name',
          'summary_group_id',
          'reduction_pct',
          'enabled',
          'gross_received',
          'calculation_band',
          'risk_budget_pct',
          'risk_budget',
          'amount_to_next_band',
          'calculation_status',
          'multiplier_configured',
          'risk_calculation_ready',
          'risk_status',
          'cut_required',
          'risk_model',
          'over_limit_code_count',
          'recommended_cut_total',
          'recommended_point_reduction',
          'confirmed_cut_total',
          'retained_total',
          'over_cut_code_count',
        ].join(','),
      )
      .eq('settlement_session_id', session.id)
      .eq('line_group_id', lineGroupId)
      .maybeSingle(),

    supabase
      .from('session_line_group_code_retention_state')
      .select(
        [
          'settlement_session_id',
          'line_group_id',
          'summary_group_id',
          'category',
          'code',
          'order_total',
          'confirmed_cut',
          'retained_quantity',
          'effective_multiplier',
          'retention_limit',
          'recommended_cut',
          'projected_retained',
          'recommended_point_reduction',
          'retention_status',
          'confirmed_cut_exceeds_order_total',
        ].join(','),
      )
      .eq('settlement_session_id', session.id)
      .eq('line_group_id', lineGroupId),

    supabase
      .from('warehouse_transfer_limits')
      .select('destination,max_batch_quantity,enabled')
      .in('destination', destinations)
      .eq('enabled', true),
  ]);


  if (riskError) throw riskError;
  if (codeError) throw codeError;
  if (warehouseError) throw warehouseError;

  if (!risk) {
    return json(
      {
        ok: false,
        error: 'RISK_STATE_NOT_FOUND',
      },
      404,
    );
  }


  if (
    requestedSummaryGroupId
    && risk.summary_group_id !== requestedSummaryGroupId
  ) {
    return json(
      {
        ok: false,
        error: 'RISK_STATE_STALE',
      },
      409,
    );
  }


  if (risk.risk_model !== 'CATEGORY_RETENTION') {
    return json(
      {
        ok: false,
        error: 'RISK_STATE_STALE',
      },
      409,
    );
  }


  if (risk.enabled === false) {
    return json(
      {
        ok: false,
        error: 'LINE_GROUP_DISABLED',
      },
      409,
    );
  }


  if (
    Number(risk.over_cut_code_count || 0) > 0
    || risk.risk_status === 'DATA_INTEGRITY_ERROR'
  ) {
    return json(
      {
        ok: false,
        error: 'RISK_DATA_INTEGRITY_ERROR',
      },
      409,
    );
  }


  if (risk.calculation_status !== 'READY') {
    return json(
      {
        ok: false,
        error: 'RISK_BAND_NOT_READY',
        calculation_status: risk.calculation_status,
        amount_to_next_band: Number(
          risk.amount_to_next_band || 0,
        ),
      },
      409,
    );
  }


  const warehouseMap = new Map(
    (warehouseRows || []).map(
      (row) => [row.destination, row],
    ),
  );

  const missing = destinations.filter(
    (destination) => !warehouseMap.has(destination),
  );

  if (missing.length) {
    return json(
      {
        ok: false,
        error: 'DESTINATION_LIMIT_NOT_CONFIGURED',
        destinations: missing,
      },
      409,
    );
  }

  const warehouses = destinations.map(
    (destination) => warehouseMap.get(destination),
  );


  const poolCodes = (codes || []).filter(
    (row) =>
      poolAllowsCategory(
        riskPool,
        String(row.category || '').toUpperCase(),
      ),
  );


  if (
    poolCodes.some(
      (row) =>
        row.retention_status === 'UNCONFIGURED'
        || Number(row.effective_multiplier || 0) <= 0,
    )
  ) {
    return json(
      {
        ok: false,
        error: 'POINT_MULTIPLIER_NOT_CONFIGURED',
      },
      409,
    );
  }


  if (
    poolCodes.some(
      (row) =>
        row.retention_status === 'DATA_INTEGRITY_ERROR'
        || row.confirmed_cut_exceeds_order_total === true,
    )
  ) {
    return json(
      {
        ok: false,
        error: 'RISK_DATA_INTEGRITY_ERROR',
      },
      409,
    );
  }


  const recommendations = poolCodes.filter((row) => {
    const category = String(
      row.category || '',
    ).toUpperCase();

    const code = String(
      row.code || '',
    ).trim();

    const key = `${category}|${code}`;

    return (
      row.retention_status === 'CUT_REQUIRED'
      && Number(row.recommended_cut || 0) > 0
      && (
        !selected.size
        || selected.has(key)
      )
    );
  });


  if (!recommendations.length) {
    return json(
      {
        ok: false,
        error: selected.size
          ? 'NO_SELECTED_DISTRIBUTION_TARGETS'
          : 'NO_RISK_DISTRIBUTION_REQUIRED',
      },
      409,
    );
  }


  const targets = recommendations
    .map((row) => ({
      line_group_id: lineGroupId,

      category: String(
        row.category || '',
      ).toUpperCase(),

      code: String(
        row.code || '',
      ).trim(),

      // Direct retention recommendation.
      // No unit-by-unit simulation.
      quantity: Number(
        row.recommended_cut || 0,
      ),

      expected_retained_quantity: Number(
        row.retained_quantity || 0,
      ),

      expected_effective_multiplier: Number(
        row.effective_multiplier || 0,
      ),

      retention_limit: Number(
        row.retention_limit,
      ),
    }))
    .filter(
      (row) =>
        Number.isSafeInteger(row.quantity)
        && row.quantity > 0
        && Number.isSafeInteger(
          row.expected_retained_quantity,
        )
        && row.expected_retained_quantity >= 0
        && Number.isFinite(
          row.expected_effective_multiplier,
        )
        && row.expected_effective_multiplier > 0
        && Number.isSafeInteger(
          row.retention_limit,
        )
        && row.retention_limit >= 0,
    );


  if (!targets.length) {
    return json(
      {
        ok: false,
        error: 'NO_SELECTED_DISTRIBUTION_TARGETS',
      },
      409,
    );
  }


  const roundPlan =
    splitLineGroupDistributionRounds({
      targets,
      warehouses,
    });


  const signed =
    createLineGroupDistributionRunToken({
      riskState: {
        ...risk,
        risk_pool: riskPool,
      },

      rounds: roundPlan.rounds,
    });


  const selectedPointReduction =
    targets.reduce(
      (sum, row) =>
        sum
        + (
          row.quantity
          * row.expected_effective_multiplier
        ),
      0,
    );


  const transferRequiredTotal =
    poolCodes.reduce(
      (sum, row) =>
        sum
        + (
          row.retention_status === 'CUT_REQUIRED'
            ? Number(row.recommended_cut || 0)
            : 0
        ),
      0,
    );


  return json({
    ok: true,

    preview_mode:
      'LINE_GROUP_CATEGORY_RETENTION',

    confirmation_token_version:
      'v3',

    line_group_id:
      lineGroupId,

    line_group_name:
      risk.line_group_name,

    summary_group_id:
      risk.summary_group_id,

    risk_pool:
      riskPool,

    risk_model:
      risk.risk_model,

    confirmation_token:
      signed.token,

    confirmation_request_id:
      signed.request_id,

    confirmation_expires_at:
      signed.expires_at,

    planned_quantity:
      signed.planned_quantity,

    planned_rounds:
      signed.planned_rounds,

    selected_code_count:
      targets.length,

    selected_warehouse_count:
      warehouses.length,

    destinations:
      warehouses,

    targets,

    rounds:
      signed.rounds,

    risk_snapshot:
      signed.snapshot,

    gross_received:
      Number(risk.gross_received || 0),

    calculation_band:
      Number(risk.calculation_band || 0),

    risk_budget:
      Number(risk.risk_budget || 0),

    retained_total:
      Number(risk.retained_total || 0),

    confirmed_cut_total:
      Number(risk.confirmed_cut_total || 0),

    recommended_cut_total:
      Number(risk.recommended_cut_total || 0),

    transfer_required_total:
      transferRequiredTotal,

    selected_point_reduction:
      selectedPointReduction,

    projected_retained_total:
      Math.max(
        0,
        Number(risk.retained_total || 0)
          - signed.planned_quantity,
      ),

    projected_recommended_cut_total:
      Math.max(
        0,
        Number(risk.recommended_cut_total || 0)
          - signed.planned_quantity,
      ),
  });
}


/**
 * Legacy Summary Group Risk preview.
 *
 * Keep this path unchanged while dashboard/UI callers still depend on it.
 */
async function previewLegacySummaryGroup({
  session,
  summaryGroupId,
  riskPool,
  destinations,
  selected,
}) {
  const riskQuery = riskPool === 'MAIN'
    ? supabase
      .from('session_overall_risk_state')
      .select(
        'settlement_session_id,summary_group_id,risk_mode,adjusted_received,risk_point_total,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk,confirmed_cut_total',
      )
      .eq(
        'settlement_session_id',
        session.id,
      )
      .eq(
        'summary_group_id',
        summaryGroupId,
      )
      .maybeSingle()

    : supabase
      .from('session_risk_pool_state')
      .select(
        'settlement_session_id,summary_group_id,risk_pool,risk_mode,adjusted_received,risk_point_total,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk,confirmed_cut_total,multiplier_configured',
      )
      .eq(
        'settlement_session_id',
        session.id,
      )
      .eq(
        'summary_group_id',
        summaryGroupId,
      )
      .eq(
        'risk_pool',
        riskPool,
      )
      .maybeSingle();


  const [
    { data: risk, error: riskError },
    { data: codes, error: codeError },
    { data: warehouseRows, error: warehouseError },
  ] = await Promise.all([
    riskQuery,

    supabase
      .from('session_code_risk_state')
      .select(
        'category,code,order_total,confirmed_cut,available_to_cut,retained_quantity,effective_multiplier,max_special_codes,reserve_candidate,retained_point_exposure',
      )
      .eq(
        'settlement_session_id',
        session.id,
      )
      .eq(
        'summary_group_id',
        summaryGroupId,
      ),

    supabase
      .from('warehouse_transfer_limits')
      .select(
        'destination,max_batch_quantity,enabled',
      )
      .in(
        'destination',
        destinations,
      )
      .eq(
        'enabled',
        true,
      ),
  ]);


  if (riskError) throw riskError;
  if (codeError) throw codeError;
  if (warehouseError) throw warehouseError;

  if (!risk) {
    return json(
      {
        ok: false,
        error: 'RISK_STATE_NOT_FOUND',
      },
      404,
    );
  }

  if (
    riskPool !== 'MAIN'
    && risk.multiplier_configured === false
  ) {
    return json(
      {
        ok: false,
        error: 'POINT_MULTIPLIER_NOT_CONFIGURED',
      },
      409,
    );
  }

  if (
    Number(risk.excess_point_risk || 0)
    <= 0
  ) {
    return json(
      {
        ok: false,
        error: 'NO_RISK_DISTRIBUTION_REQUIRED',
      },
      409,
    );
  }


  const warehouseMap = new Map(
    (warehouseRows || []).map(
      (row) => [row.destination, row],
    ),
  );

  const missing = destinations.filter(
    (destination) =>
      !warehouseMap.has(destination),
  );

  if (missing.length) {
    return json(
      {
        ok: false,
        error: 'DESTINATION_LIMIT_NOT_CONFIGURED',
        destinations: missing,
      },
      409,
    );
  }

  const warehouses = destinations.map(
    (destination) =>
      warehouseMap.get(destination),
  );


  const poolCodes = (codes || []).filter(
    (row) =>
      poolAllowsCategory(
        riskPool,
        row.category,
      ),
  );


  const plan =
    buildRiskDistributionPlan({
      rows: poolCodes,

      adjustedTotal:
        Number(risk.adjusted_received || 0),

      pointLossTolerance:
        Number(
          risk.point_loss_tolerance || 0,
        ),
    });


  const codeMap = new Map(
    poolCodes.map(
      (row) => [
        `${row.category}|${row.code}`,
        row,
      ],
    ),
  );


  const recommendations =
    (plan.recommendations || []).filter(
      (row) =>
        Number(
          row.recommended_transfer || 0,
        ) > 0
        && (
          !selected.size
          || selected.has(
            `${row.category}|${row.code}`,
          )
        ),
    );


  if (!recommendations.length) {
    return json(
      {
        ok: false,
        error:
          'NO_SELECTED_DISTRIBUTION_TARGETS',
      },
      409,
    );
  }


  const targets = recommendations
    .map((row) => {
      const current = codeMap.get(
        `${row.category}|${row.code}`,
      );

      return {
        category:
          row.category,

        code:
          row.code,

        quantity:
          Math.min(
            Number(
              row.recommended_transfer || 0,
            ),

            Number(
              current?.available_to_cut
              || current?.retained_quantity
              || 0,
            ),
          ),

        expected_retained_quantity:
          Number(
            current?.retained_quantity || 0,
          ),

        expected_effective_multiplier:
          Number(
            current?.effective_multiplier || 0,
          ),
      };
    })
    .filter(
      (row) =>
        Number.isSafeInteger(row.quantity)
        && row.quantity > 0,
    );


  if (!targets.length) {
    return json(
      {
        ok: false,
        error:
          'NO_SELECTED_DISTRIBUTION_TARGETS',
      },
      409,
    );
  }


  const roundPlan =
    splitDistributionRounds({
      targets,
      warehouses,
    });


  const projectionItems =
    targets.map(
      (row) => ({
        category:
          row.category,

        code:
          row.code,

        quantity:
          row.quantity,
      }),
    );


  const projected =
    projectRiskAfterTransfers({
      rows:
        poolCodes,

      adjustedTotal:
        Number(risk.adjusted_received || 0),

      pointLossTolerance:
        Number(
          risk.point_loss_tolerance || 0,
        ),

      items:
        projectionItems,
    });


  const signed =
    createDistributionRunToken({
      riskState: {
        ...risk,
        risk_pool: riskPool,
      },

      rounds:
        roundPlan.rounds,

      projectedRisk:
        projected,
    });


  return json({
    ok: true,

    preview_mode:
      'LEGACY_SUMMARY_GROUP',

    risk_pool:
      riskPool,

    confirmation_token:
      signed.token,

    confirmation_request_id:
      signed.request_id,

    confirmation_expires_at:
      signed.expires_at,

    planned_quantity:
      signed.planned_quantity,

    planned_rounds:
      signed.planned_rounds,

    selected_code_count:
      targets.length,

    selected_warehouse_count:
      warehouses.length,

    destinations:
      warehouses,

    targets,

    rounds:
      signed.rounds,

    risk_snapshot:
      signed.snapshot,

    projected_point_reserve:
      signed.projected_point_reserve,

    projected_excess_point_risk:
      signed.projected_excess_point_risk,

    transfer_required_total:
      Number(
        plan.transfer_required_total || 0,
      ),
  });
}


export default async (req) => {
  if (req.method !== 'POST') {
    return json(
      {
        ok: false,
        error: 'METHOD_NOT_ALLOWED',
      },
      405,
    );
  }

  const denied =
    requireDashboardAccess(req);

  if (denied) return denied;


  try {
    const body =
      await req.json();

    const lineGroupId =
      String(
        body.line_group_id || '',
      ).trim();

    const summaryGroupId =
      String(
        body.summary_group_id || '',
      ).trim();

    const riskPool =
      String(
        body.risk_pool || 'MAIN',
      )
        .trim()
        .toUpperCase();

    const destinations = [
      ...new Set(
        (
          Array.isArray(body.destinations)
            ? body.destinations
            : []
        )
          .map(
            (value) =>
              String(value || '').trim(),
          )
          .filter(Boolean),
      ),
    ];

    const selected =
      normalizeSelectedCodes(
        body.selected_codes,
      );


    if (
      !lineGroupId
      && !summaryGroupId
    ) {
      return json(
        {
          ok: false,
          error:
            'INVALID_SUMMARY_GROUP_ID',
        },
        400,
      );
    }


    if (
      !['MAIN','H','L']
        .includes(riskPool)
    ) {
      return json(
        {
          ok: false,
          error:
            'INVALID_RISK_POOL',
        },
        400,
      );
    }


    if (!destinations.length) {
      return json(
        {
          ok: false,
          error:
            'WAREHOUSE_SELECTION_REQUIRED',
        },
        400,
      );
    }


    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from('settlement_sessions')
      .select(
        'id,status',
      )
      .eq(
        'status',
        'OPEN',
      )
      .maybeSingle();


    if (sessionError) {
      throw sessionError;
    }


    if (!session) {
      return json(
        {
          ok: false,
          error:
            'SETTLEMENT_NOT_OPEN',
        },
        409,
      );
    }


    // v8.9.4 new path:
    // LINE Group CATEGORY_RETENTION.
    if (lineGroupId) {
      return await previewLineGroupRetention({
        session,
        lineGroupId,
        requestedSummaryGroupId:
          summaryGroupId,
        riskPool,
        destinations,
        selected,
      });
    }


    // Existing production path remains available until
    // dashboard/UI migration is complete.
    return await previewLegacySummaryGroup({
      session,
      summaryGroupId,
      riskPool,
      destinations,
      selected,
    });

  } catch (error) {
    const message =
      error?.message ?? String(error);

    console.error(
      'risk-distribution-preview failed',
      error,
    );

    return json(
      {
        ok: false,
        error: message,
      },
      statusForError(message),
    );
  }
};


export const config = {
  path: '/api/risk-distribution-preview',
};
