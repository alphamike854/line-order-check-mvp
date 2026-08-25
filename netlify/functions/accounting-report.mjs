import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
import { reducedQuantity, reconciliationTotal } from "../../src/lib/settlement-calculations.mjs";

async function resolveSession(url) {
  const explicit = url.searchParams.get("session_id");
  if (explicit) {
    const { data, error } = await supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at").eq("id", explicit).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from("settlement_sessions").select("id,business_date,status,opened_at,closed_at").eq("status", "OPEN").maybeSingle();
  if (error) throw error;
  return data;
}

export default async (req) => {
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req); if (denied) return denied;
  try {
    const url = new URL(req.url);
    const session = await resolveSession(url);
    if (!session) return json({ ok: true, session: null, groups: [] });
    const selectedSummary = url.searchParams.get("group");
    const selectedLine = url.searchParams.get("line_group");

    let configQuery = supabase.from("settlement_line_group_config")
      .select("line_group_id,line_group_name,summary_group_id,reduction_pct")
      .eq("settlement_session_id", session.id).order("line_group_name");
    if (selectedSummary && selectedSummary !== "ALL") configQuery = configQuery.eq("summary_group_id", selectedSummary);
    if (selectedLine && selectedLine !== "ALL") configQuery = configQuery.eq("line_group_id", selectedLine);

    const [{ data: configs, error: configError }, { data: pointRules, error: pointError }] = await Promise.all([
      configQuery,
      supabase.from("settlement_special_point_rules").select("category,code,multiplier").eq("settlement_session_id", session.id),
    ]);
    if (configError) throw configError; if (pointError) throw pointError;
    const pointMap = new Map((pointRules ?? []).map((r) => [`${r.category}|${r.code}`, Number(r.multiplier)]));
    const lineIds = (configs ?? []).map((g) => g.line_group_id);
    if (!lineIds.length) return json({ ok: true, session, special_point_rules: pointRules ?? [], groups: [] });

    const [{ data: messages, error: msgError }, { data: items, error: itemError }] = await Promise.all([
      supabase.from("messages").select("id,line_group_id,event_timestamp,parse_status,message_type")
        .eq("settlement_session_id", session.id).in("line_group_id", lineIds).order("event_timestamp", { ascending: true }),
      supabase.from("order_items").select("message_record_id,line_group_id,category,code,quantity")
        .eq("settlement_session_id", session.id).in("line_group_id", lineIds),
    ]);
    if (msgError) throw msgError; if (itemError) throw itemError;

    const itemsByMessage = new Map();
    for (const item of items ?? []) {
      if (!itemsByMessage.has(item.message_record_id)) itemsByMessage.set(item.message_record_id, []);
      itemsByMessage.get(item.message_record_id).push(item);
    }

    const groups = (configs ?? []).map((cfg) => {
      const groupMessages = (messages ?? []).filter((m) => m.line_group_id === cfg.line_group_id);
      let received = 0; let special = 0;
      const specialCodeMap = new Map();
      const ledger = groupMessages.map((message, index) => {
        const msgItems = itemsByMessage.get(message.id) ?? [];
        const qty = msgItems.reduce((sum, x) => sum + Number(x.quantity), 0);
        received += qty;
        const specialDetails = [];
        for (const item of msgItems) {
          const multiplier = pointMap.get(`${item.category}|${item.code}`);
          if (!multiplier) continue;
          const points = Number(item.quantity) * multiplier;
          special += points;
          const key = `${item.category}|${item.code}`;
          const prev = specialCodeMap.get(key) ?? { category:item.category, code:item.code, quantity:0, multiplier, points:0 };
          prev.quantity += Number(item.quantity); prev.points += points; specialCodeMap.set(key, prev);
          specialDetails.push({ category:item.category, code:item.code, quantity:Number(item.quantity), multiplier, points });
        }
        return { sequence:index + 1, event_timestamp:message.event_timestamp, summary_quantity:qty, has_special_point:specialDetails.length>0, special_points:specialDetails };
      });
      const afterReduction = reducedQuantity(received, cfg.reduction_pct);
      return {
        ...cfg,
        received_total: received,
        after_reduction: afterReduction,
        reduction_amount: Math.round((received-afterReduction)*100)/100,
        special_point_total: special,
        reconciliation_total: reconciliationTotal(received, cfg.reduction_pct, special),
        message_count: ledger.length,
        special_point_codes: [...specialCodeMap.values()].sort((a,b)=>a.category.localeCompare(b.category)||a.code.localeCompare(b.code)),
        ledger,
      };
    });
    return json({ ok: true, session, special_point_rules: pointRules ?? [], groups });
  } catch (error) {
    console.error("accounting-report failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};
export const config = { path: "/api/accounting-report" };
