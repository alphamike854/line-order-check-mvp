import { json, requireDashboardAccess, supabase } from "../../src/lib/dashboard-api.mjs";
import { reducedQuantity, reconciliationTotal } from "../../src/lib/settlement-calculations.mjs";
import { effectiveMultiplier, round2 } from "../../src/lib/risk-engine.mjs";
import { firstLedgerCode } from "../../src/lib/report-ledger.mjs";

const REPORT_PAGE_SIZE = 500;

async function fetchAllPages(makeQuery) {
  const rows = [];

  for (
    let from = 0;
    ;
    from += REPORT_PAGE_SIZE
  ) {
    const { data, error } =
      await makeQuery().range(
        from,
        from + REPORT_PAGE_SIZE - 1,
      );

    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < REPORT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

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

    const [configResult,profileResult,promoResult,actualResult,statusResult] = await Promise.all([
      configQuery,
      supabase.from("settlement_point_profiles").select("category,special_multiplier,max_special_codes").eq("settlement_session_id",session.id),
      supabase.from("settlement_point_promotions").select("summary_group_id,category,code,point_factor_pct").eq("settlement_session_id",session.id),
      supabase.from("settlement_summary_group_actual_special_point_codes").select("summary_group_id,category,code").eq("settlement_session_id",session.id),
      supabase.from("session_summary_group_actual_point_status").select("summary_group_id,actual_codes_ready,category_counts").eq("settlement_session_id",session.id),
    ]);
    for(const r of [configResult,profileResult,promoResult,actualResult,statusResult]) if(r.error) throw r.error;
    const configs=configResult.data??[];
    const profiles=profileResult.data??[];
    const promotions=promoResult.data??[];
    const actualCodes=actualResult.data??[];
    const statusRows=statusResult.data??[];
    const relevantSummaryIds=new Set(configs.map(g=>g.summary_group_id));
    const relevantActualCodes=actualCodes.filter(r=>relevantSummaryIds.has(r.summary_group_id));
    const relevantStatusRows=statusRows.filter(r=>relevantSummaryIds.has(r.summary_group_id));
    const statusMap=new Map(relevantStatusRows.map(r=>[r.summary_group_id,r]));
    const profileMap=new Map(profiles.map(r=>[r.category,Number(r.special_multiplier)]));
    const promoMap=new Map(promotions.map(r=>[`${r.summary_group_id}|${r.category}|${r.code}`,Number(r.point_factor_pct)]));
    const actualSet=new Set(relevantActualCodes.map(r=>`${r.summary_group_id}|${r.category}|${r.code}`));
    const readySummaryGroupCount=[...relevantSummaryIds].filter(id=>statusMap.get(id)?.actual_codes_ready===true).length;
    const aggregateStatus=relevantSummaryIds.size?{
      actual_codes_ready:readySummaryGroupCount===relevantSummaryIds.size,
      summary_group_count:relevantSummaryIds.size,
      ready_summary_group_count:readySummaryGroupCount,
    }:null;
    const lineIds=configs.map(g=>g.line_group_id);
    if(!lineIds.length) return json({ok:true,session,actual_point_status:aggregateStatus,actual_point_statuses:relevantStatusRows,actual_special_codes:relevantActualCodes,groups:[]});

    const [messages,items] = await Promise.all([
      fetchAllPages(() =>
        supabase
          .from("messages")
          .select(
            "id,line_group_id,event_timestamp,parse_status,message_type,raw_text,normalized_text,ocr_text,first_order_code"
          )
          .eq(
            "settlement_session_id",
            session.id,
          )
          .in(
            "line_group_id",
            lineIds,
          )
          .order(
            "event_timestamp",
            { ascending:true },
          )
          .order(
            "id",
            { ascending:true },
          )
      ),
      fetchAllPages(() =>
        supabase
          .from("order_items")
          .select(
            "id,message_record_id,line_group_id,category,code,quantity"
          )
          .eq(
            "settlement_session_id",
            session.id,
          )
          .in(
            "line_group_id",
            lineIds,
          )
          .order(
            "id",
            { ascending:true },
          )
      ),
    ]);

    const itemsByMessage=new Map();
    for(const item of items??[]){if(!itemsByMessage.has(item.message_record_id))itemsByMessage.set(item.message_record_id,[]);itemsByMessage.get(item.message_record_id).push(item);}

    const groups=configs.map(cfg=>{
      // Accounting ledger contains order-bearing messages only. Unrelated/ignored LINE chat
      // stays outside the ledger, while unsent orders remain because their derived items remain.
      const groupMessages=(messages??[]).filter(m=>m.line_group_id===cfg.line_group_id && itemsByMessage.has(m.id));
      let received=0;let special=0;const specialCodeMap=new Map();
      const ledger=groupMessages.map((message,index)=>{
        const msgItems=itemsByMessage.get(message.id)??[];
        const qty=msgItems.reduce((s,x)=>s+Number(x.quantity),0);received+=qty;
        const specialDetails=[];
        for(const item of msgItems){
          const key=`${item.category}|${item.code}`;
          if(!actualSet.has(`${cfg.summary_group_id}|${key}`)) continue;
          const base=profileMap.get(item.category)??0;
          const factor=promoMap.get(`${cfg.summary_group_id}|${key}`)??100;
          const multiplier=effectiveMultiplier(base,factor);
          const points=round2(Number(item.quantity)*multiplier);
          special+=points;
          const prev=specialCodeMap.get(key)??{category:item.category,code:item.code,quantity:0,multiplier,promotion_factor_pct:factor,points:0};
          prev.quantity+=Number(item.quantity);prev.points=round2(prev.points+points);specialCodeMap.set(key,prev);
          specialDetails.push({category:item.category,code:item.code,quantity:Number(item.quantity),multiplier,promotion_factor_pct:factor,points});
        }
        const sourceText=message.raw_text??message.ocr_text??message.normalized_text??"";
        const firstCode=message.first_order_code||firstLedgerCode(msgItems,sourceText)||"";
        return {sequence:index+1,event_timestamp:message.event_timestamp,first_code:firstCode,summary_quantity:qty,has_special_point:specialDetails.length>0,special_points:specialDetails};
      });
      special=round2(special);
      const afterReduction=reducedQuantity(received,cfg.reduction_pct);
      const pointSpecified=relevantActualCodes.some(r=>r.summary_group_id===cfg.summary_group_id);
      const actualPointStatus=statusMap.get(cfg.summary_group_id)??null;
      return {...cfg,point_specified:pointSpecified,actual_point_status:actualPointStatus,received_total:received,after_reduction:afterReduction,reduction_amount:round2(received-afterReduction),special_point_total:special,reconciliation_total:reconciliationTotal(received,cfg.reduction_pct,special),message_count:groupMessages.length,special_point_codes:[...specialCodeMap.values()].sort((a,b)=>a.category.localeCompare(b.category)||a.code.localeCompare(b.code)),ledger};
    });

    return json({ok:true,session,actual_point_status:aggregateStatus,actual_point_statuses:relevantStatusRows,point_profiles:profiles,promotions,actual_special_codes:relevantActualCodes,groups});
  } catch(error){console.error("accounting-report failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/accounting-report"};
