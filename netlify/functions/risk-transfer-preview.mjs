import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
import { buildRiskDistributionPlan, projectRiskAfterTransfers } from "../../src/lib/risk-engine.mjs";
import { createRiskTransferToken } from "../../src/lib/risk-transfer-safety.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const denied=requireDashboardAccess(req); if(denied)return denied;
  try {
    const body=await req.json();
    const summaryGroupId=String(body.summary_group_id||"").trim();
    const destination=String(body.destination||"").trim();
    const items=Array.isArray(body.items)?body.items:[];
    if(!summaryGroupId) return json({ok:false,error:"INVALID_SUMMARY_GROUP_ID"},400);
    if(!destination) return json({ok:false,error:"DESTINATION_REQUIRED"},400);

    const {data:session,error:sessionError}=await supabase.from("settlement_sessions").select("id,status").eq("status","OPEN").maybeSingle();
    if(sessionError) throw sessionError;
    if(!session) return json({ok:false,error:"SETTLEMENT_NOT_OPEN"},409);

    const [{data:risk,error:riskError},{data:codes,error:codeError},{data:limitRow,error:limitError}]=await Promise.all([
      supabase.from("session_overall_risk_state")
        .select("settlement_session_id,summary_group_id,risk_mode,adjusted_received,risk_point_total,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk,confirmed_cut_total")
        .eq("settlement_session_id",session.id).eq("summary_group_id",summaryGroupId).maybeSingle(),
      supabase.from("session_code_risk_state")
        .select("category,code,order_total,confirmed_cut,available_to_cut,retained_quantity,effective_multiplier,max_special_codes,reserve_candidate,retained_point_exposure")
        .eq("settlement_session_id",session.id).eq("summary_group_id",summaryGroupId),
      supabase.from("warehouse_transfer_limits")
        .select("destination,max_batch_quantity,enabled")
        .eq("destination",destination).eq("enabled",true).maybeSingle(),
    ]);
    if(riskError) throw riskError; if(codeError) throw codeError; if(limitError) throw limitError;
    if(!risk) return json({ok:false,error:"RISK_STATE_NOT_FOUND"},404);
    if(!limitRow) return json({ok:false,error:"DESTINATION_LIMIT_NOT_CONFIGURED"},409);
    if(Number(risk.excess_point_risk||0)<=0) return json({ok:false,error:"NO_RISK_DISTRIBUTION_REQUIRED"},409);

    const plan=buildRiskDistributionPlan({
      rows:codes??[],
      adjustedTotal:Number(risk.adjusted_received||0),
      pointLossTolerance:Number(risk.point_loss_tolerance||0),
    });
    const recommendationMap=new Map(plan.recommendations.map((row)=>[`${row.category}|${row.code}`,row]));
    const codeMap=new Map((codes??[]).map(r=>[`${r.category}|${r.code}`,r]));
    const enriched=[];
    let batchTotal=0;
    for(const item of items){
      const category=String(item.category||"").toUpperCase();
      const code=String(item.code||"").trim();
      const key=`${category}|${code}`;
      const state=codeMap.get(key);
      const recommendation=recommendationMap.get(key);
      if(!state) return json({ok:false,error:"TRANSFER_CODE_NOT_FOUND",code:key},400);
      const qty=Number(item.quantity||0);
      if(!Number.isSafeInteger(qty)||qty<=0) return json({ok:false,error:"INVALID_TRANSFER_QUANTITY",code:key},400);
      if(!state.reserve_candidate) return json({ok:false,error:"TRANSFER_CODE_NOT_CURRENT_RISK_CANDIDATE",code:key},409);
      if(!recommendation || Number(recommendation.recommended_transfer||0)<=0) return json({ok:false,error:"TRANSFER_CODE_NOT_RECOMMENDED",code:key},409);
      if(qty>Number(state.available_to_cut||0)) return json({ok:false,error:"TRANSFER_EXCEEDS_CODE_AVAILABLE",code:key,available:Number(state.available_to_cut||0)},409);
      if(qty>Number(recommendation.recommended_transfer||0)) return json({ok:false,error:"TRANSFER_EXCEEDS_CODE_RECOMMENDATION",code:key,recommended:Number(recommendation.recommended_transfer||0)},409);
      batchTotal+=qty;
      enriched.push({
        category,code,quantity:qty,
        expected_retained_quantity:Number(state.retained_quantity||0),
        expected_effective_multiplier:Number(state.effective_multiplier||0),
        expected_recommended_transfer:Number(recommendation.recommended_transfer||0),
      });
    }
    const destinationLimit=Number(limitRow.max_batch_quantity||0);
    if(batchTotal>destinationLimit) return json({ok:false,error:"TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT",limit:destinationLimit},409);

    const projected=projectRiskAfterTransfers({
      rows:codes??[],
      adjustedTotal:Number(risk.adjusted_received||0),
      pointLossTolerance:Number(risk.point_loss_tolerance||0),
      items:enriched,
    });
    const signed=createRiskTransferToken({riskState:risk,destination,destinationLimit,items:enriched,projectedRisk:projected});
    return json({
      ok:true,
      confirmation_token:signed.token,
      confirmation_request_id:signed.request_id,
      confirmation_expires_at:signed.expires_at,
      cut_total:signed.cut_total,
      lines:signed.lines,
      destination_limit:destinationLimit,
      risk_snapshot:signed.snapshot,
      projected_point_reserve:signed.projected_point_reserve,
      projected_excess_point_risk:signed.projected_excess_point_risk,
      transfer_required_total:plan.transfer_required_total,
      items:signed.items,
    });
  } catch(error){
    const message=error?.message??String(error);
    const status=message.includes("DISTRIBUTION")||message.includes("WAREHOUSE")||message.includes("RECOMMEND")||message.includes("CODE_AVAILABLE")?409:message.includes("REQUIRED")||message.includes("INVALID")?400:500;
    console.error("risk-transfer-preview failed",error);
    return json({ok:false,error:message},status);
  }
};
export const config={path:"/api/risk-transfer-preview"};
