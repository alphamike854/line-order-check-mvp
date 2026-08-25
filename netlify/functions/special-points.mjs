import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";

async function resolveSession(explicitId = "") {
  const id = String(explicitId || "").trim();
  if (id) {
    const { data, error } = await supabase
      .from("settlement_sessions")
      .select("id,business_date,status,opened_at,closed_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  const { data, error } = await supabase
    .from("settlement_sessions")
    .select("id,business_date,status,opened_at,closed_at")
    .eq("status", "OPEN")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function pointPayload(session) {
  if (!session) {
    return { session: null, open_session: null, profiles: [], promotions: [], codes: [], status: null };
  }

  const [profileResult, promoResult, codeResult, statusResult] = await Promise.all([
    supabase.from("settlement_point_profiles")
      .select("category,special_multiplier,max_special_codes")
      .eq("settlement_session_id", session.id)
      .order("category"),
    supabase.from("settlement_point_promotions")
      .select("category,code,point_factor_pct")
      .eq("settlement_session_id", session.id)
      .order("category").order("code"),
    supabase.from("settlement_actual_special_point_codes")
      .select("category,code,created_at")
      .eq("settlement_session_id", session.id)
      .order("category").order("code"),
    supabase.from("session_actual_point_status")
      .select("actual_codes_ready,category_counts")
      .eq("settlement_session_id", session.id)
      .maybeSingle(),
  ]);
  for (const result of [profileResult, promoResult, codeResult, statusResult]) {
    if (result.error) throw result.error;
  }

  return {
    session,
    open_session: session.status === "OPEN" ? session : null,
    profiles: profileResult.data ?? [],
    promotions: promoResult.data ?? [],
    codes: codeResult.data ?? [],
    status: statusResult.data ?? null,
  };
}

export default async (req) => {
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const session = await resolveSession(url.searchParams.get("session_id") || "");
      return json({ ok: true, ...(await pointPayload(session)) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

    const body = await req.json();
    const session = await resolveSession(body.settlement_session_id || "");
    if (!session) return json({ ok: false, error: "SETTLEMENT_NOT_FOUND" }, 404);

    const codes = Array.isArray(body.codes) ? body.codes : [];
    const { data, error } = await supabase.rpc("replace_settlement_actual_special_codes", {
      p_session_id: session.id,
      p_codes: codes,
    });

    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("SETTLEMENT_NOT_FOUND")) return json({ ok: false, error: "SETTLEMENT_NOT_FOUND" }, 404);
      if (message.includes("SETTLEMENT_NOT_EDITABLE")) return json({ ok: false, error: "SETTLEMENT_NOT_EDITABLE" }, 409);
      if (message.includes("SPECIAL_POINT_LIMIT_")) {
        return json({ ok: false, error: message.match(/SPECIAL_POINT_LIMIT_[A-Z]/)?.[0] ?? "SPECIAL_POINT_LIMIT" }, 400);
      }
      if (message.includes("INVALID_POINT")) return json({ ok: false, error: "INVALID_POINT_CODE" }, 400);
      throw error;
    }

    return json({ ok: true, count: data, ...(await pointPayload(session)) });
  } catch (error) {
    console.error("special-points failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/special-points" };
