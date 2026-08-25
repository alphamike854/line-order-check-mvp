import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
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

    const [{data:risk,error:riskError},{data:codes,error:codeError}]=await Promise.all([
      supabase.from("session_overall_risk_state").select("settlement_session_id,summary_group_id,risk_mode,adjusted_received,risk_point_total,net_safe_capacity,confirmed_cut_total,remaining_safe_capacity").eq("settlement_session_id",session.id).eq("summary_group_id",summaryGroupId).maybeSingle(),
      supabase.from("session_code_risk_state").select("category,code,available_to_cut,order_total,confirmed_cut").eq("settlement_session_id",session.id).eq("summary_group_id",summaryGroupId),
    ]);
    if(riskError) throw riskError; if(codeError) throw codeError;
    if(!risk) return json({ok:false,error:"RISK_STATE_NOT_FOUND"},404);
    const codeMap=new Map((codes??[]).map(r=>[`${r.category}|${r.code}`,r]));
    for(const item of items){
      const key=`${String(item.category||"").toUpperCase()}|${String(item.code||"").trim()}`;
      const state=codeMap.get(key);
      if(!state) return json({ok:false,error:"TRANSFER_CODE_NOT_FOUND",code:key},400);
      const qty=Number(item.quantity||0);
      if(!Number.isSafeInteger(qty)||qty<=0) return json({ok:false,error:"INVALID_TRANSFER_QUANTITY",code:key},400);
      if(qty>Number(state.available_to_cut||0)) return json({ok:false,error:"TRANSFER_EXCEEDS_CODE_AVAILABLE",code:key,available:Number(state.available_to_cut||0)},409);
    }
    const signed=createRiskTransferToken({riskState:risk,destination,items});
    return json({ok:true,confirmation_token:signed.token,confirmation_request_id:signed.request_id,confirmation_expires_at:signed.expires_at,cut_total:signed.cut_total,lines:signed.lines,risk_snapshot:signed.snapshot,items:signed.items});
  } catch(error){
    const message=error?.message??String(error);
    const status=message.includes("SAFE_CAPACITY")?409:message.includes("REQUIRED")||message.includes("INVALID")?400:500;
    console.error("risk-transfer-preview failed",error);
    return json({ok:false,error:message},status);
  }
};
export const config={path:"/api/risk-transfer-preview"};
