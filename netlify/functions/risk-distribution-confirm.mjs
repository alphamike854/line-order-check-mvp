import {
  json,
  requireDashboardAccess,
  supabase,
} from '../../src/lib/dashboard-api.mjs';

import {
  LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION,
  verifyDistributionRunToken,
  verifyLineGroupDistributionRunToken,
} from '../../src/lib/distribution-run-safety.mjs';


const OPERATOR =
  process.env.DASHBOARD_OPERATOR_NAME
  || 'DASHBOARD';


function mapRpc(message) {
  for (const code of [
    'RISK_STATE_STALE',
    'NO_RISK_DISTRIBUTION_REQUIRED',
    'DESTINATION_LIMIT_NOT_CONFIGURED',
    'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT',
    'TRANSFER_EXCEEDS_CODE_AVAILABLE',
    'TRANSFER_CODE_NOT_FOUND',
    'SETTLEMENT_NOT_OPEN',
    'DISTRIBUTION_ROUNDS_REQUIRED',
    'POINT_MULTIPLIER_NOT_CONFIGURED',
    'INVALID_RISK_POOL',

    // v8.9.4 LINE Group confirmation.
    'CONFIRMATION_REQUEST_ID_COLLISION',
    'LINE_GROUP_NOT_IN_SETTLEMENT',
    'LINE_GROUP_DISABLED',
    'INVALID_RISK_SNAPSHOT',
    'INVALID_TRANSFER_ITEM',
    'INVALID_RISK_POOL_CATEGORY',
    'LINE_GROUP_MISMATCH',
    'INCONSISTENT_TRANSFER_SNAPSHOT',
    'RETENTION_RECOMMENDATION_MISMATCH',
    'DUPLICATE_TRANSFER_ITEM',
    'POST_CONFIRM_RETENTION_MISMATCH',
  ]) {
    if (message.includes(code)) {
      return [code, 409];
    }
  }

  return null;
}


function confirmationErrorStatus(error) {
  return error === 'CONFIRMATION_EXPIRED'
    ? 409
    : 400;
}


function isLineGroupConfirmationToken(token) {
  return token.startsWith(
    `${LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION}.`,
  );
}


async function confirmLineGroupToken(token) {
  const verified =
    verifyLineGroupDistributionRunToken({
      token,
    });


  if (!verified.ok) {
    return json(
      {
        ok: false,
        error: verified.error,
      },
      confirmationErrorStatus(
        verified.error,
      ),
    );
  }


  const s = verified.snapshot;


  // Every risk-sensitive value comes exclusively from
  // the verified signed v3 token.
  const args = {
    p_request_id:
      verified.request_id,

    p_settlement_session_id:
      s.settlement_session_id,

    p_line_group_id:
      s.line_group_id,

    p_summary_group_id:
      s.summary_group_id,

    p_risk_pool:
      s.risk_pool,

    p_expected_gross_received:
      s.gross_received,

    p_expected_calculation_band:
      s.calculation_band,

    p_expected_reduction_pct:
      s.reduction_pct,

    p_expected_risk_budget:
      s.risk_budget,

    p_rounds:
      verified.rounds,

    p_confirmed_by:
      OPERATOR,
  };


  const {
    data,
    error,
  } = await supabase.rpc(
    'confirm_line_group_distribution_run',
    args,
  );


  if (error) {
    const mapped =
      mapRpc(
        String(
          error.message || '',
        ),
      );

    if (mapped) {
      return json(
        {
          ok: false,
          error: mapped[0],
        },
        mapped[1],
      );
    }

    throw error;
  }


  return json({
    ok: true,

    confirmation_mode:
      'LINE_GROUP_CATEGORY_RETENTION',

    confirmation_token_version:
      LINE_GROUP_DISTRIBUTION_RUN_TOKEN_VERSION,

    run:
      data,
  });
}


async function confirmLegacyToken(token) {
  const verified =
    verifyDistributionRunToken({
      token,
    });


  if (!verified.ok) {
    return json(
      {
        ok: false,
        error: verified.error,
      },
      confirmationErrorStatus(
        verified.error,
      ),
    );
  }


  const s =
    verified.snapshot;


  const rpcName =
    s.risk_pool === 'MAIN'
      ? 'confirm_risk_distribution_run_budget_safe'
      : 'confirm_separate_risk_distribution_run';


  const args = {
    p_request_id:
      verified.request_id,

    p_settlement_session_id:
      s.settlement_session_id,

    p_summary_group_id:
      s.summary_group_id,

    p_expected_risk_mode:
      s.risk_mode,

    p_expected_adjusted_received:
      s.adjusted_received,

    p_expected_risk_point_total:
      s.risk_point_total,

    p_expected_safety_margin:
      s.safety_margin,

    p_expected_risk_pct:
      s.risk_pct,

    p_expected_point_loss_tolerance:
      s.point_loss_tolerance,

    p_expected_risk_budget:
      s.risk_budget,

    p_expected_excess_point_risk:
      s.excess_point_risk,

    p_expected_confirmed_cut_total:
      s.confirmed_cut_total,

    p_rounds:
      verified.rounds,

    p_confirmed_by:
      OPERATOR,
  };


  if (s.risk_pool !== 'MAIN') {
    args.p_risk_pool =
      s.risk_pool;
  }


  const {
    data,
    error,
  } = await supabase.rpc(
    rpcName,
    args,
  );


  if (error) {
    const mapped =
      mapRpc(
        String(
          error.message || '',
        ),
      );

    if (mapped) {
      return json(
        {
          ok: false,
          error: mapped[0],
        },
        mapped[1],
      );
    }

    throw error;
  }


  return json({
    ok: true,

    confirmation_mode:
      'LEGACY_SUMMARY_GROUP',

    run:
      data,
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

  if (denied) {
    return denied;
  }


  try {
    const body =
      await req.json();

    const token =
      String(
        body.confirmation_token || '',
      ).trim();


    if (!token) {
      return json(
        {
          ok: false,
          error:
            'CONFIRMATION_TOKEN_REQUIRED',
        },
        400,
      );
    }


    // Token version selects the backend confirmation path.
    // No line_group_id, Risk Band, Risk Budget or rounds
    // are accepted independently from the request body.
    if (
      isLineGroupConfirmationToken(
        token,
      )
    ) {
      return await confirmLineGroupToken(
        token,
      );
    }


    // Preserve existing v2 production behavior.
    return await confirmLegacyToken(
      token,
    );

  } catch (error) {
    console.error(
      'risk-distribution-confirm failed',
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
      },
      500,
    );
  }
};


export const config = {
  path:
    '/api/risk-distribution-confirm',
};
