import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

async function openSession() {
  const { data, error } = await supabase.from("settlement_sessions").select("id,business_date,status").eq("status", "OPEN").maybeSingle();
  if (error) throw error;
  return data;
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;
  try {
    const session = await openSession();
    if (!session) return json({ ok: true, open_session: null, profiles:[], promotions:[], codes:[], status:null });
    if (req.method === "GET") {
      const [profileResult,promoResult,codeResult,statusResult] = await Promise.all([
        supabase.from("settlement_point_profiles").select("category,special_multiplier,max_special_codes").eq("settlement_session_id",session.id).order("category"),
        supabase.from("settlement_point_promotions").select("category,code,point_factor_pct").eq("settlement_session_id",session.id).order("category").order("code"),
        supabase.from("settlement_actual_special_point_codes").select("category,code,created_at").eq("settlement_session_id",session.id).order("category").order("code"),
        supabase.from("session_actual_point_status").select("actual_codes_ready,category_counts").eq("settlement_session_id",session.id).maybeSingle(),
      ]);
      for(const r of [profileResult,promoResult,codeResult,statusResult]) if(r.error) throw r.error;
      return json({ok:true,open_session:session,profiles:profileResult.data??[],promotions:promoResult.data??[],codes:codeResult.data??[],status:statusResult.data??null});
    }
    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const codes = Array.isArray(body.codes) ? body.codes : [];
    const { data, error } = await supabase.rpc("replace_settlement_actual_special_codes", { p_session_id: session.id, p_codes: codes });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("SETTLEMENT_NOT_OPEN")) return json({ ok: false, error: "SETTLEMENT_NOT_OPEN" }, 409);
      if (message.includes("SPECIAL_POINT_LIMIT_")) return json({ ok:false,error:message.match(/SPECIAL_POINT_LIMIT_[A-Z]/)?.[0]??"SPECIAL_POINT_LIMIT" },400);
      if (message.includes("INVALID_POINT")) return json({ ok: false, error: "INVALID_POINT_CODE" }, 400);
      throw error;
    }
    return json({ ok: true, count: data });
  } catch (error) {
    console.error("special-points failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};
export const config = { path: "/api/special-points" };
