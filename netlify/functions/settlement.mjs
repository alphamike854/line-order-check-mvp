import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

async function getPayload() {
  const [{ data: open, error: openError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at,opened_by,closed_by").eq("status", "OPEN").maybeSingle(),
    supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at,opened_by,closed_by").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(50),
  ]);
  if (openError) throw openError;
  if (historyError) throw historyError;

  let promotions = [];
  if (open?.id) {
    const { data, error } = await supabase.from("settlement_promotion_rules")
      .select("summary_group_id,category,code,threshold,destination")
      .eq("settlement_session_id", open.id)
      .order("summary_group_id").order("category").order("code");
    if (error) throw error;
    promotions = data ?? [];
  }
  return { open_session: open ?? null, promotions, closed_sessions: history ?? [] };
}

function mapError(message) {
  if (message.includes("SETTLEMENT_ALREADY_OPEN")) return [409, "SETTLEMENT_ALREADY_OPEN"];
  if (message.includes("SETTLEMENT_NOT_OPEN")) return [409, "SETTLEMENT_NOT_OPEN"];
  if (message.includes("SETTLEMENT_NOT_FOUND")) return [404, "SETTLEMENT_NOT_FOUND"];
  if (message.includes("INVALID_PROMOTION")) return [400, "INVALID_PROMOTION_RULE"];
  return [500, message];
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;
  try {
    if (req.method === "GET") return json({ ok: true, ...(await getPayload()) });
    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    const body = await req.json();
    const action = String(body.action ?? "").toUpperCase();
    if (action === "OPEN") {
      const businessDate = String(body.business_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return json({ ok: false, error: "INVALID_BUSINESS_DATE" }, 400);
      const promotions = Array.isArray(body.promotions) ? body.promotions : [];
      const { data, error } = await supabase.rpc("open_settlement_session", {
        p_business_date: businessDate,
        p_promotions: promotions,
        p_opened_by: OPERATOR,
      });
      if (error) { const [status, code] = mapError(error.message); return json({ ok: false, error: code }, status); }
      return json({ ok: true, settlement_session_id: data, ...(await getPayload()) });
    }
    if (action === "CLOSE") {
      const sessionId = String(body.settlement_session_id ?? "");
      const { data, error } = await supabase.rpc("close_settlement_session", { p_session_id: sessionId, p_closed_by: OPERATOR });
      if (error) { const [status, code] = mapError(error.message); return json({ ok: false, error: code }, status); }
      return json({ ok: true, closed: data, ...(await getPayload()) });
    }
    return json({ ok: false, error: "INVALID_SETTLEMENT_ACTION" }, 400);
  } catch (error) {
    console.error("settlement failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};
export const config = { path: "/api/settlement" };
