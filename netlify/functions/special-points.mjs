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
    if (!session) return json({ ok: true, open_session: null, rules: [] });
    if (req.method === "GET") {
      const { data, error } = await supabase.from("settlement_special_point_rules")
        .select("category,code,multiplier,updated_at")
        .eq("settlement_session_id", session.id).order("category").order("code");
      if (error) throw error;
      return json({ ok: true, open_session: session, rules: data ?? [] });
    }
    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const { data, error } = await supabase.rpc("replace_settlement_special_points", { p_session_id: session.id, p_rules: rules });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("SETTLEMENT_NOT_OPEN")) return json({ ok: false, error: "SETTLEMENT_NOT_OPEN" }, 409);
      if (message.includes("INVALID_POINT")) return json({ ok: false, error: "INVALID_POINT_RULE" }, 400);
      throw error;
    }
    return json({ ok: true, count: data });
  } catch (error) {
    console.error("special-points failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};
export const config = { path: "/api/special-points" };
