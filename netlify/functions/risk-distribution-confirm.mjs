import { json, requireDashboardAccess, supabase } from '../../src/lib/dashboard-api.mjs';
import { verifyDistributionRunToken } from '../../src/lib/distribution-run-safety.mjs';

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || 'DASHBOARD';

function mapRpc(message) {
  for (const code of [
    'RISK_STATE_STALE','NO_RISK_DISTRIBUTION_REQUIRED','DESTINATION_LIMIT_NOT_CONFIGURED',
    'TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT','TRANSFER_EXCEEDS_CODE_AVAILABLE',
    'TRANSFER_CODE_NOT_FOUND','SETTLEMENT_NOT_OPEN','DISTRIBUTION_ROUNDS_REQUIRED'
  ]) {
    if (message.includes(code)) return [code,409];
  }
  return null;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ ok:false,error:'METHOD_NOT_ALLOWED' },405);
  const denied = requireDashboardAccess(req); if (denied) return denied;
  try {
    const body = await req.json();
    const verified = verifyDistributionRunToken({ token:body.confirmation_token });
    if (!verified.ok) return json({ ok:false,error:verified.error },verified.error === 'CONFIRMATION_EXPIRED' ? 409 : 400);
    const s = verified.snapshot;
    const { data,error } = await supabase.rpc('confirm_risk_distribution_run_budget_safe',{
      p_request_id:verified.request_id,
      p_settlement_session_id:s.settlement_session_id,
      p_summary_group_id:s.summary_group_id,
      p_expected_risk_mode:s.risk_mode,
      p_expected_adjusted_received:s.adjusted_received,
      p_expected_risk_point_total:s.risk_point_total,
      p_expected_safety_margin:s.safety_margin,
      p_expected_risk_pct:s.risk_pct,
      p_expected_point_loss_tolerance:s.point_loss_tolerance,
      p_expected_risk_budget:s.risk_budget,
      p_expected_excess_point_risk:s.excess_point_risk,
      p_expected_confirmed_cut_total:s.confirmed_cut_total,
      p_rounds:verified.rounds,
      p_confirmed_by:OPERATOR,
    });
    if (error) {
      const mapped = mapRpc(String(error.message || ''));
      if (mapped) return json({ ok:false,error:mapped[0] },mapped[1]);
      throw error;
    }
    return json({ ok:true,run:data });
  } catch (error) {
    console.error('risk-distribution-confirm failed',error);
    return json({ ok:false,error:error?.message ?? String(error) },500);
  }
};
export const config = { path:'/api/risk-distribution-confirm' };
