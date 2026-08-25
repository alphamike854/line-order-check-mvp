import { fetchOpenSettlementSession, json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
export default async(req)=>{
  if(req.method!=="GET")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const denied=requireDashboardAccess(req);if(denied)return denied;
  try{
    const session=await fetchOpenSettlementSession();
    if(!session)return json({ok:true,settlement_session:null,freshness:{version:"NO_OPEN_SETTLEMENT"}});
    const [{data:msg,error:me},{data:alloc,error:ae},{data:points,error:pe}]=await Promise.all([
      supabase.from("messages").select("event_timestamp").eq("settlement_session_id",session.id).order("event_timestamp",{ascending:false}).limit(1),
      supabase.from("allocation_confirmation_events").select("confirmed_at").eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(1),
      supabase.from("settlement_special_point_rules").select("category,code,multiplier,updated_at").eq("settlement_session_id",session.id).order("updated_at",{ascending:false}),
    ]);
    if(me)throw me;if(ae)throw ae;if(pe)throw pe;
    const freshness={message_at:msg?.[0]?.event_timestamp??null,allocation_at:alloc?.[0]?.confirmed_at??null,points_at:points?.[0]?.updated_at??null};
    freshness.version=[session.id,freshness.message_at??"",freshness.allocation_at??"",freshness.points_at??""].join("|");
    return json({ok:true,settlement_session:session,freshness});
  }catch(error){console.error("dashboard-freshness failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard-freshness"};
