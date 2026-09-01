import { fetchOpenSettlementSession, json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

export default async(req)=>{
  if(req.method!=="GET")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);

  const denied=requireDashboardAccess(req);
  if(denied)return denied;

  try{
    const session=await fetchOpenSettlementSession();

    if(!session){
      return json({
        ok:true,
        settlement_session:null,
        freshness:{
          version:"NO_OPEN_SETTLEMENT",
        },
      });
    }

    const [
      {data:msg,error:me},
      {data:batches,error:be},
      {data:points,error:pe},
      {data:settings,error:se},
    ]=await Promise.all([
      supabase
        .from("messages")
        .select("event_timestamp")
        .eq("settlement_session_id",session.id)
        .order("event_timestamp",{ascending:false})
        .limit(1),

      supabase
        .from("settlement_transfer_batches")
        .select("confirmed_at")
        .eq("settlement_session_id",session.id)
        .order("confirmed_at",{ascending:false})
        .limit(1),

      supabase
        .from("settlement_summary_group_actual_special_point_codes")
        .select("summary_group_id,category,code,created_at")
        .eq("settlement_session_id",session.id)
        .order("summary_group_id")
        .order("category")
        .order("code"),

      supabase
        .from("settings_change_events")
        .select("changed_at")
        .order("changed_at",{ascending:false})
        .limit(1),
    ]);

    if(me)throw me;
    if(be)throw be;
    if(pe)throw pe;
    if(se)throw se;

    const pointSignature=
      (points??[])
        .map(
          r=>
            `${r.summary_group_id}|${r.category}${r.code}@${r.created_at}`,
        )
        .join(",");

    const freshness={
      message_at:
        msg?.[0]?.event_timestamp??null,
      transfer_at:
        batches?.[0]?.confirmed_at??null,
      points_signature:
        pointSignature,
      settings_at:
        settings?.[0]?.changed_at??null,
    };

    freshness.version=[
      session.id,
      freshness.message_at??"",
      freshness.transfer_at??"",
      freshness.points_signature,
      freshness.settings_at??"",
    ].join("|");

    return json({
      ok:true,
      settlement_session:session,
      freshness,
    });
  }catch(error){
    console.error(
      "dashboard-freshness failed",
      error,
    );

    return json({
      ok:false,
      error:error?.message??String(error),
    },500);
  }
};

export const config={
  path:"/api/dashboard-freshness",
};
