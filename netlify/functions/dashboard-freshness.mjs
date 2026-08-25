import { fetchOpenSettlementSession, json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
export default async(req)=>{
  if(req.method!=="GET")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const denied=requireDashboardAccess(req);if(denied)return denied;
  try{
    const session=await fetchOpenSettlementSession();
    if(!session)return json({ok:true,settlement_session:null,freshness:{version:"NO_OPEN_SETTLEMENT"}});
    const [{data:msg,error:me},{data:batches,error:be},{data:points,error:pe}]=await Promise.all([
      supabase.from("messages").select("event_timestamp").eq("settlement_session_id",session.id).order("event_timestamp",{ascending:false}).limit(1),
      supabase.from("settlement_transfer_batches").select("confirmed_at").eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(1),
      supabase.from("settlement_actual_special_point_codes").select("category,code,created_at").eq("settlement_session_id",session.id).order("created_at",{ascending:false}),
    ]);
    if(me)throw me;if(be)throw be;if(pe)throw pe;
    const pointSignature=(points??[]).map(r=>`${r.category}${r.code}@${r.created_at}`).join(",");
    const freshness={message_at:msg?.[0]?.event_timestamp??null,transfer_at:batches?.[0]?.confirmed_at??null,points_signature:pointSignature};
    freshness.version=[session.id,freshness.message_at??"",freshness.transfer_at??"",freshness.points_signature].join("|");
    return json({ok:true,settlement_session:session,freshness});
  }catch(error){console.error("dashboard-freshness failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard-freshness"};
