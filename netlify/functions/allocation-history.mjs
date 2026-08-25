import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
import { compactTransferLines } from "../../src/lib/risk-engine.mjs";

export default async(req)=>{
  if(req.method!=="GET") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const denied=requireDashboardAccess(req);if(denied)return denied;
  try{
    const url=new URL(req.url);const group=url.searchParams.get("group");
    const {data:session,error:sessionError}=await supabase.from("settlement_sessions").select("id").eq("status","OPEN").maybeSingle();
    if(sessionError) throw sessionError;if(!session)return json({ok:true,history:[]});
    let q=supabase.from("settlement_transfer_batches")
      .select("id,batch_number,distribution_run_id,summary_group_id,destination,risk_mode,adjusted_received,risk_point_total,net_safe_capacity,safety_margin,risk_pct,point_loss_tolerance,risk_budget,excess_point_risk_before,warehouse_batch_limit,projected_point_reserve,projected_excess_point_risk,confirmed_cut_before,cut_total,confirmed_by,confirmed_at")
      .eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(500);
    if(group&&group!=="ALL") q=q.eq("summary_group_id",group);
    const {data:batches,error}=await q;if(error)throw error;
    const ids=(batches??[]).map(b=>b.id);let items=[];
    if(ids.length){const r=await supabase.from("settlement_transfer_batch_items").select("batch_id,category,code,quantity,retained_before,effective_multiplier,recommended_transfer_before").in("batch_id",ids);if(r.error)throw r.error;items=r.data??[];}
    const byBatch=new Map();for(const item of items){if(!byBatch.has(item.batch_id))byBatch.set(item.batch_id,[]);byBatch.get(item.batch_id).push(item);}
    return json({ok:true,history:(batches??[]).map(b=>({...b,items:byBatch.get(b.id)??[],lines:compactTransferLines(byBatch.get(b.id)??[])}))});
  }catch(error){console.error("allocation-history failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/allocation-history"};
