import { json, requireDashboardAccess, supabase } from '../../src/lib/dashboard-api.mjs';
import { buildRiskDistributionPlan, projectRiskAfterTransfers } from '../../src/lib/risk-engine.mjs';
import { splitDistributionRounds } from '../../src/lib/distribution-round-planner.mjs';
import { createDistributionRunToken } from '../../src/lib/distribution-run-safety.mjs';

function normalizeSelectedCodes(items = []) {
  return new Set((Array.isArray(items) ? items : [])
    .map((item) => `${String(item.category || '').toUpperCase()}|${String(item.code || '').trim()}`)
    .filter((key) => /^[ABEFGHL]\|.+$/.test(key)));
}

export default async (req) => {
  if (req.method !== 'POST') return json({ ok:false,error:'METHOD_NOT_ALLOWED' },405);
  const denied = requireDashboardAccess(req); if (denied) return denied;
  try {
    const body = await req.json();
    const summaryGroupId = String(body.summary_group_id || '').trim();
    const riskPool = String(body.risk_pool || 'MAIN').trim().toUpperCase();
    const destinations = [...new Set((Array.isArray(body.destinations) ? body.destinations : []).map((x) => String(x || '').trim()).filter(Boolean))];
    const selected = normalizeSelectedCodes(body.selected_codes);
    if (!summaryGroupId) return json({ ok:false,error:'INVALID_SUMMARY_GROUP_ID' },400);
    if (!['MAIN','H','L'].includes(riskPool)) return json({ ok:false,error:'INVALID_RISK_POOL' },400);
    if (!destinations.length) return json({ ok:false,error:'WAREHOUSE_SELECTION_REQUIRED' },400);

    const { data:session,error:sessionError } = await supabase.from('settlement_sessions').select('id,status').eq('status','OPEN').maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok:false,error:'SETTLEMENT_NOT_OPEN' },409);

    const riskQuery = riskPool === 'MAIN'
      ? supabase.from('session_overall_risk_state')
          .select('settlement_session_id,summary_group_id,risk_mode,adjusted_received,risk_point_total,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk,confirmed_cut_total')
          .eq('settlement_session_id',session.id).eq('summary_group_id',summaryGroupId).maybeSingle()
      : supabase.from('session_risk_pool_state')
          .select('settlement_session_id,summary_group_id,risk_pool,risk_mode,adjusted_received,risk_point_total,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk,confirmed_cut_total,multiplier_configured')
          .eq('settlement_session_id',session.id).eq('summary_group_id',summaryGroupId).eq('risk_pool',riskPool).maybeSingle();

    const [{data:risk,error:riskError},{data:codes,error:codeError},{data:warehouseRows,error:warehouseError}] = await Promise.all([
      riskQuery,
      supabase.from('session_code_risk_state')
        .select('category,code,order_total,confirmed_cut,available_to_cut,retained_quantity,effective_multiplier,max_special_codes,reserve_candidate,retained_point_exposure')
        .eq('settlement_session_id',session.id).eq('summary_group_id',summaryGroupId),
      supabase.from('warehouse_transfer_limits')
        .select('destination,max_batch_quantity,enabled')
        .in('destination',destinations).eq('enabled',true),
    ]);
    if (riskError) throw riskError; if (codeError) throw codeError; if (warehouseError) throw warehouseError;
    if (!risk) return json({ ok:false,error:'RISK_STATE_NOT_FOUND' },404);
    if (riskPool !== 'MAIN' && risk.multiplier_configured === false) return json({ ok:false,error:'POINT_MULTIPLIER_NOT_CONFIGURED' },409);
    if (Number(risk.excess_point_risk || 0) <= 0) return json({ ok:false,error:'NO_RISK_DISTRIBUTION_REQUIRED' },409);

    const warehouseMap = new Map((warehouseRows || []).map((row) => [row.destination,row]));
    const missing = destinations.filter((destination) => !warehouseMap.has(destination));
    if (missing.length) return json({ ok:false,error:'DESTINATION_LIMIT_NOT_CONFIGURED',destinations:missing },409);
    const warehouses = destinations.map((destination) => warehouseMap.get(destination));

    const poolCodes = (codes || []).filter((row) => riskPool === 'MAIN' ? ['A','B','E','F','G'].includes(row.category) : row.category === riskPool);
    const plan = buildRiskDistributionPlan({
      rows: poolCodes,
      adjustedTotal: Number(risk.adjusted_received || 0),
      pointLossTolerance: Number(risk.point_loss_tolerance || 0),
    });
    const codeMap = new Map(poolCodes.map((row) => [`${row.category}|${row.code}`,row]));
    const recommendations = (plan.recommendations || []).filter((row) => Number(row.recommended_transfer || 0) > 0 && (!selected.size || selected.has(`${row.category}|${row.code}`)));
    if (!recommendations.length) return json({ ok:false,error:'NO_SELECTED_DISTRIBUTION_TARGETS' },409);

    const targets = recommendations.map((row) => {
      const current = codeMap.get(`${row.category}|${row.code}`);
      return {
        category: row.category,
        code: row.code,
        quantity: Math.min(Number(row.recommended_transfer || 0), Number(current?.available_to_cut || current?.retained_quantity || 0)),
        expected_retained_quantity: Number(current?.retained_quantity || 0),
        expected_effective_multiplier: Number(current?.effective_multiplier || 0),
      };
    }).filter((row) => Number.isSafeInteger(row.quantity) && row.quantity > 0);
    if (!targets.length) return json({ ok:false,error:'NO_SELECTED_DISTRIBUTION_TARGETS' },409);

    const roundPlan = splitDistributionRounds({ targets, warehouses });
    const projectionItems = targets.map((row) => ({ category:row.category,code:row.code,quantity:row.quantity }));
    const projected = projectRiskAfterTransfers({
      rows: poolCodes,
      adjustedTotal: Number(risk.adjusted_received || 0),
      pointLossTolerance: Number(risk.point_loss_tolerance || 0),
      items: projectionItems,
    });
    const signed = createDistributionRunToken({ riskState:{...risk,risk_pool:riskPool},rounds:roundPlan.rounds,projectedRisk:projected });

    return json({
      ok:true,
      risk_pool:riskPool,
      confirmation_token:signed.token,
      confirmation_request_id:signed.request_id,
      confirmation_expires_at:signed.expires_at,
      planned_quantity:signed.planned_quantity,
      planned_rounds:signed.planned_rounds,
      selected_code_count:targets.length,
      selected_warehouse_count:warehouses.length,
      destinations:warehouses,
      targets,
      rounds:signed.rounds,
      risk_snapshot:signed.snapshot,
      projected_point_reserve:signed.projected_point_reserve,
      projected_excess_point_risk:signed.projected_excess_point_risk,
      transfer_required_total:Number(plan.transfer_required_total || 0),
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    const status = message.includes('WAREHOUSE') || message.includes('DISTRIBUTION') || message.includes('RISK_') ? 409 : message.includes('REQUIRED') || message.includes('INVALID') ? 400 : 500;
    console.error('risk-distribution-preview failed',error);
    return json({ ok:false,error:message },status);
  }
};
export const config = { path:'/api/risk-distribution-preview' };
