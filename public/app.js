const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  accessKey: sessionStorage.getItem("lineOrderDashboardKey") || "",
  dashboard: null,
  settings: null,
  groupsLoaded: false,
  freshnessVersion: null,
  dashboardStale: false,
  freshnessTimer: null,
  freshnessPollBusy: false,
  settlement: null,
  specialPointRules: [],
  specialPointProfiles: [],
  specialPointPromotions: [],
  specialPointSessionId: null,
  specialPointSummaryGroupId: null,
  specialPointSession: null,
  specialPointStatus: null,
  promotionDrafts: [],
  transferPreview: null,
  bulkDistributionPreview: null,
  allocationHistory: [],
  transferDestination: "",
  reportPayload: null,
};

const FRESHNESS_POLL_MS = 60_000;

const loginView = $("#loginView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const accessKeyInput = $("#accessKey");
const loginError = $("#loginError");
const businessDateInput = $("#businessDate");
const summaryGroupSelect = $("#summaryGroup");
const allocationLineGroupSelect = $("#allocationLineGroupSelect");
const refreshButton = $("#refreshButton");
const logoutButton = $("#logoutButton");

function formatNumber(value) {
  return new Intl.NumberFormat("th-TH").format(Number(value || 0));
}


function formatThaiDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", { timeZone:"Asia/Bangkok", day:"numeric", month:"short", year:"numeric" }).format(new Date(`${value}T12:00:00+07:00`));
}

function formatBangkokTime(value) {
  if (!value) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatBangkokClock(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}


function reportCsvCell(value) {
  let text = String(value ?? "");
  // Guard user-configurable names/details against spreadsheet formula injection.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function reportCsvCodeCell(value) {
  const text = String(value ?? "");
  // Keep leading zeroes (01 / 001) when opened directly in Excel/Sheets.
  if (/^0\d+$/.test(text)) return `"=""${text}"""`;
  return reportCsvCell(text);
}

function reportStatusLabel(session) {
  return session?.status === "OPEN" ? "ยอดปัจจุบัน" : "ปิดยอดแล้ว";
}

function reportSpecialDetail(row) {
  return (row?.special_points || []).map((x) => `${x.category}${x.code}=${x.quantity} ×${x.multiplier}`).join("; ");
}

function buildDailyReportCsv(payload) {
  const headers = ["วันที่","สถานะ","กลุ่มสรุป","LINE Group","ลำดับ","เวลา","รหัสแรก","จำนวน","ลด %","ยอดหลังลด","Point รวม","ยอดสุทธิเทียบ","รายละเอียด Point"];
  const lines = [headers.map(reportCsvCell).join(",")];
  const session = payload?.session || {};
  for (const group of payload?.groups || []) {
    const finalReady = Boolean(group?.actual_point_status?.actual_codes_ready);
    const pointSpecified = Boolean(group?.point_specified);
    for (const row of group.ledger || []) {
      const values = [
        session.business_date || "",
        reportStatusLabel(session),
        groupName(group.summary_group_id),
        group.line_group_name || "",
        String(row.sequence || 0).padStart(3,"0"),
        formatBangkokClock(row.event_timestamp),
        row.first_code || "",
        row.summary_quantity ?? 0,
        "", "", "", "",
        reportSpecialDetail(row),
      ];
      lines.push(values.map((value,index)=>index===6?reportCsvCodeCell(value):reportCsvCell(value)).join(","));
    }
    const totalValues = [
      session.business_date || "",
      reportStatusLabel(session),
      groupName(group.summary_group_id),
      group.line_group_name || "",
      "รวม", "", "",
      group.received_total ?? 0,
      group.reduction_pct ?? 0,
      group.after_reduction ?? 0,
      pointSpecified ? (group.special_point_total ?? 0) : "รอระบุ",
      finalReady ? (group.reconciliation_total ?? 0) : "",
      "",
    ];
    lines.push(totalValues.map(reportCsvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function exportDailyReportCsv() {
  const payload = state.reportPayload;
  if (!payload?.session || !(payload.groups || []).length) return toast("ยังไม่มีรายงานสำหรับ Export", true);
  const csv = buildDailyReportCsv(payload);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const status = payload.session.status === "OPEN" ? "current" : "closed";
  link.href = url;
  link.download = `daily-report-${payload.session.business_date || "report"}-${status}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


function aliasTargetLabel(value) {
  const labels = {
    A: "หมวด A",
    B: "หมวด B",
    AB: "A+B",
    C: "กลับรหัส",
    ABC: "A+B+กลับ",
    D: "ชุดหลักสิบ",
    E: "หมวด E",
    F: "หมวด F",
    G: "หมวด G",
    H: "H",
    L: "L",
    DOUBLE: "เลขเบิ้ล",
    PERMUTE_ALL: "สลับเลข 3 หลัก",
  };
  return labels[String(value || "").toUpperCase()] || String(value || "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("x-dashboard-key", state.accessKey);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({ ok: false, error: `HTTP_${response.status}` }));

  if (response.status === 401) {
    sessionStorage.removeItem("lineOrderDashboardKey");
    state.accessKey = "";
    showLogin("Access Key ไม่ถูกต้อง");
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function showLogin(message = "") {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  loginError.textContent = message;
  loginError.classList.toggle("hidden", !message);
  setTimeout(() => accessKeyInput.focus(), 0);
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden", "error-toast");
  if (isError) el.classList.add("error-toast");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function selectedQuery() {
  const date = businessDateInput.value;
  const group = summaryGroupSelect.value || "ALL";
  return `date=${encodeURIComponent(date)}&group=${encodeURIComponent(group)}`;
}

function setDashboardStale(stale) {
  state.dashboardStale = Boolean(stale);
  const banner = $("#staleBanner");
  if (banner) banner.classList.toggle("hidden", !state.dashboardStale);
  const confirm = $(".risk-transfer-confirm");
  if (confirm) confirm.disabled = state.dashboardStale;
  const bulkButton = $("#runBulkDistributionButton");
  if (bulkButton && state.dashboardStale) bulkButton.disabled = true;
  if (state.dashboardStale) clearTransferPreview("ข้อมูลเปลี่ยน กรุณาอัปเดต");
}

function stopFreshnessPolling() {
  if (state.freshnessTimer) clearInterval(state.freshnessTimer);
  state.freshnessTimer = null;
}

async function checkFreshness() {
  if (document.hidden || !state.accessKey || !state.dashboard || state.freshnessPollBusy || state.dashboardStale) return;
  state.freshnessPollBusy = true;
  try {
    const payload = await api(`/api/dashboard-freshness?${selectedQuery()}`);
    if (state.freshnessVersion != null && payload.freshness?.version !== state.freshnessVersion) {
      const activeTab = $(".tab.active")?.dataset.tab;
      if (activeTab === "review") {
        // Keep the Review workbench stable while the operator is checking items.
        // Incoming LINE messages continue to be stored normally by the webhook.
        // Do not reload, reorder or stale the current Review screen.
      } else {
        // Incoming data must not rebuild the operator's screen automatically.
        // Mark the current snapshot stale and let the operator refresh when ready.
        setDashboardStale(true);
      }
    }
  } catch (error) {
    if (error.message !== "UNAUTHORIZED") console.warn("freshness check failed", error);
  } finally {
    state.freshnessPollBusy = false;
  }
}

function startFreshnessPolling() {
  stopFreshnessPolling();
  state.freshnessTimer = setInterval(checkFreshness, FRESHNESS_POLL_MS);
}

function renderMetrics(metrics) {
  const selectedGroup =
    summaryGroupSelect.value || "ALL";

  const lineGroupRows =
    (
      state.dashboard?.line_group_risk || []
    ).filter(
      (row) =>
        row.enabled !== false
        && (
          selectedGroup === "ALL"
          || row.summary_group_id === selectedGroup
        )
    );

  const sumLineGroup =
    (field) =>
      lineGroupRows.reduce(
        (sum, row) =>
          sum + Number(row[field] || 0),
        0
      );

  const useLineGroupModel =
    lineGroupRows.length > 0;

  const recommendedCut =
    useLineGroupModel
      ? sumLineGroup("recommended_cut_total")
      : Number(
          metrics.transfer_required_total || 0
        );

  const confirmedCut =
    useLineGroupModel
      ? sumLineGroup("confirmed_cut_total")
      : 0;

  const cards =
    useLineGroupModel
      ? [
          [
            "ยอดรับ",
            sumLineGroup("gross_received"),
            "",
          ],
          [
            "Risk Budget",
            sumLineGroup("risk_budget"),
            "",
          ],
          [
            "ต้องตัด",
            recommendedCut,
            recommendedCut > 0
              ? "alert"
              : "",
          ],
          [
            "ตัดแล้ว",
            confirmedCut,
            confirmedCut > 0
              ? "success"
              : "",
          ],
          [
            "คงเหลือ",
            sumLineGroup("retained_total"),
            "",
          ],
          [
            "รอตรวจ",
            Number(metrics.review_open || 0),
            Number(metrics.review_open || 0) > 0
              ? "attention"
              : "",
          ],
        ]
      : [
          [
            "ยอดรับ",
            metrics.gross_received,
            "",
          ],
          [
            "หลังหัก %",
            metrics.adjusted_received,
            "",
          ],
          [
            "Point สำรอง",
            metrics.risk_point_total,
            Number(metrics.excess_point_risk) > 0
              ? "alert"
              : "",
          ],
          [
            "ระดับที่รับได้",
            metrics.risk_budget,
            "",
          ],
          [
            "Point เกิน",
            metrics.excess_point_risk,
            Number(metrics.excess_point_risk) > 0
              ? "alert"
              : "",
          ],
          [
            "ควรตัด",
            metrics.distribution_point_pending
              ? "รอระบุ Point"
              : metrics.distribution_incomplete
                ? "คำนวณไม่สำเร็จ"
                : metrics.transfer_required_total,
            (
              !metrics.distribution_point_pending
              && !metrics.distribution_incomplete
              && Number(
                metrics.transfer_required_total || 0
              ) > 0
            )
              ? "alert"
              : "",
          ],
        ];

  $("#metrics").innerHTML =
    cards.map(
      ([label, value, tone]) => `
        <article class="metric ${tone}">
          <div class="label">
            ${escapeHtml(label)}
          </div>
          <div class="value">
            ${
              typeof value === "string"
                ? escapeHtml(value)
                : formatNumber(value)
            }
          </div>
        </article>
      `
    ).join("");

  $("#reviewBadge").textContent =
    formatNumber(metrics.review_open);

  $("#freshness").textContent =
    `ล่าสุด ${formatBangkokClock(metrics.last_event_at)}`
    + ` · ${formatNumber(metrics.messages_total)} ข้อความ`;
}

function groupName(id) {
  return state.dashboard?.summary_groups?.find((g) => g.id === id)?.name
    || state.settings?.summary_groups?.find((g) => g.id === id)?.name
    || id;
}

function riskClass(riskPct) {
  const risk = Number(riskPct || 0);
  if (risk >= 100) return "risk-critical";
  if (risk >= 80) return "risk-high";
  if (risk >= 60) return "risk-watch";
  return "risk-safe";
}

function categoryRiskFor(groupId, category) {
  return (state.dashboard?.category_risk || []).find((r) => r.summary_group_id === groupId && r.category === category) || null;
}

function overallRiskFor(groupId) {
  return (state.dashboard?.overall_risk || []).find((r) => r.summary_group_id === groupId) || null;
}

function riskPoolFor(groupId, riskPool = "MAIN") {
  return (state.dashboard?.risk_pools || []).find((r) => r.summary_group_id === groupId && r.risk_pool === riskPool) || null;
}

function distributionPlanFor(groupId, riskPool = "MAIN") {
  return (state.dashboard?.distribution_plans || []).find((r) => r.summary_group_id === groupId && (r.risk_pool || "MAIN") === riskPool) || null;
}

function distributionPlanCalculationFailed(groupId, riskPool = "MAIN") {
  return distributionPlanFor(groupId, riskPool)?.calculation_status === "LIMIT";
}

function anyDistributionPlanCalculationFailed(groupId) {
  return ["MAIN","H","L"].some((pool) => distributionPlanCalculationFailed(groupId, pool));
}

function distributionTransferLabel(groupId, riskPool = "MAIN") {
  const plan = distributionPlanFor(groupId, riskPool);

  if (
    plan?.calculation_status === "LIMIT"
  ) {
    return "คำนวณไม่สำเร็จ";
  }

  if (
    plan?.calculation_status === "NOT_READY"
  ) {
    return "รอระบุ Point";
  }

  return formatNumber(
    plan?.transfer_required_total || 0
  );
}

function riskPoolLabel(pool) {
  return pool === "H" ? "H" : pool === "L" ? "L" : "หมวดหลัก";
}

function categoryCodeLength(category) {
  if (["H","L"].includes(category)) return 1;
  if (["A","B"].includes(category)) return 2;
  return 3;
}

function warehouseLimitFor(destination) {
  return (state.dashboard?.warehouse_limits || []).find((r) => r.destination === destination && r.enabled !== false) || null;
}

function profileFor(category) {
  return (state.dashboard?.point_profiles || state.settlement?.point_profiles || []).find((r) => r.category === category) || null;
}

function codeRowsFor(groupId, category) {
  const rows = (state.dashboard?.risk_codes || []).filter((r) => r.summary_group_id === groupId && r.category === category);
  const map = new Map(rows.map((r) => [r.code, r]));
  if (["A", "B"].includes(category)) {
    for (let i = 0; i < 100; i += 1) {
      const code = String(i).padStart(2, "0");
      if (!map.has(code)) map.set(code, { summary_group_id: groupId, category, code, order_total: 0, adjusted_total: 0, point_exposure: 0, retained_point_exposure: 0, retained_quantity: 0, reserve_candidate: false, actual_special_point: false, promotion_factor_pct: 100, confirmed_cut: 0, available_to_cut: 0 });
    }
  }
  if (["H", "L"].includes(category)) {
    for (let i = 0; i < 10; i += 1) {
      const code = String(i);
      if (!map.has(code)) map.set(code, { summary_group_id: groupId, category, code, order_total: 0, adjusted_total: 0, point_exposure: 0, retained_point_exposure: 0, retained_quantity: 0, reserve_candidate: false, actual_special_point: false, promotion_factor_pct: 100, confirmed_cut: 0, available_to_cut: 0 });
    }
  }
  return [...map.values()]
    .filter((row) => ["A", "B", "H", "L"].includes(category) || Number(row.order_total) > 0)
    .sort((a, b) => Number(b.order_total) - Number(a.order_total) || String(a.code).localeCompare(String(b.code)));
}

function promotionFactorForSummaryCode(
  summaryGroupId,
  category,
  code
) {
  if (!summaryGroupId) return 100;

  const row = (
    state.dashboard?.risk_codes || []
  ).find(
    (item) =>
      item.summary_group_id === summaryGroupId
      && item.category === category
      && String(item.code) === String(code)
  );

  return Number(
    row?.promotion_factor_pct ?? 100
  );
}


function promotionCodeClass(factor) {
  const pct = Number(factor ?? 100);

  return Number.isFinite(pct) && pct < 100
    ? "promotion-code-row"
    : "";
}


function promotionCodeCue(factor) {
  const pct = Number(factor ?? 100);

  if (!Number.isFinite(pct) || pct >= 100) {
    return "";
  }

  return `<small
    class="promotion-code-cue"
    title="Promotion ${formatNumber(pct)}%"
  >${formatNumber(pct)}%</small>`;
}


function renderRankedOverflow(rowHtml) {
  if (!rowHtml.length) return "";

  return `<details class="ranked-overflow">
    <summary>ดูอีก ${formatNumber(rowHtml.length)} รหัส</summary>
    <div class="ranked-overflow-list">${rowHtml.join("")}</div>
  </details>`;
}

function renderCategoryColumn(groupId, category) {
  const risk = categoryRiskFor(groupId, category);
  const profile = profileFor(category);
  const rows = codeRowsFor(groupId, category);
  const maxQty = Math.max(1, ...rows.map((r) => Number(r.order_total || 0)));
  const overall = overallRiskFor(groupId);
  const orderShare = Number(overall?.gross_received || 0) > 0 ? Number(risk?.order_total || 0) / Number(overall.gross_received) * 100 : 0;
  const useActual = overall?.risk_mode === "ACTUAL";
  const pointValue = useActual ? Number(risk?.actual_point || 0) : Number(risk?.point_reserve || 0);
  const categorySafe = Number(risk?.adjusted_total || 0) - pointValue;
  const categoryRiskPct = Number(risk?.adjusted_total || 0) > 0 ? pointValue / Number(risk.adjusted_total) * 100 : (pointValue > 0 ? 100 : 0);
  const header = `<div class="board-column-head ${riskClass(categoryRiskPct)}">
    <div class="category-title"><strong>${escapeHtml(category)}</strong><span>×${formatNumber(profile?.special_multiplier || risk?.special_multiplier || 0)} · ${useActual ? `Point ${formatNumber(risk?.actual_selected_count || 0)} รหัส` : `สำรอง ${formatNumber(profile?.max_special_codes || risk?.max_special_codes || 0)} รหัส`}</span></div>
    <div class="category-risk-mini"><span>รับ ${formatNumber(risk?.order_total || 0)}</span><span>หลังหัก ${formatNumber(risk?.adjusted_total || 0)}</span><span>Point ${formatNumber(pointValue)}</span><strong>เสี่ยง ${formatNumber(categoryRiskPct)}%</strong></div>
  </div>`;
  const renderedRows = rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const width = qty > 0 ? Math.max(3, qty / maxQty * 100) : 0;
    const promotionFactor =
      promotionFactorForSummaryCode(
        groupId,
        category,
        row.code
      );
    const promotionClass =
      promotionCodeClass(promotionFactor);
    const promotionCue =
      promotionCodeCue(promotionFactor);
    const reserve = row.reserve_candidate && qty > 0 ? `<span class="reserve-badge">สำรอง</span>` : "";
    const actual = row.actual_special_point ? `<span class="point-badge">★ Point จริง</span>` : "";
    return `<div class="board-code-row ${promotionClass} ${qty === 0 ? "zero" : ""} ${row.reserve_candidate ? "reserve" : ""} ${row.actual_special_point ? "actual" : ""}">
      <div class="board-code-main"><strong>${escapeHtml(row.code)}${promotionCue}</strong><span>${formatNumber(qty)}</span></div>
      <div class="board-code-badges">${actual}${reserve}${Number(row.confirmed_cut||0)>0?`<span class="promo-badge">คงคลัง ${formatNumber(row.retained_quantity ?? row.available_to_cut ?? 0)}</span>`:""}</div>
      <div class="qty-track"><div class="qty-fill" style="width:${width}%"></div></div>
    </div>`;
  });
  const primaryRows = renderedRows.slice(0, 20);
  const overflowRows = renderedRows.slice(20);
  const list = renderedRows.length
    ? `${primaryRows.join("")}${renderRankedOverflow(overflowRows)}`
    : `<div class="empty compact">ยังไม่มีออเดอร์</div>`;
  return `<section class="board-column summary-ranked-column">${header}<div class="board-code-list">${list}</div></section>`;
}

function renderOneDigitSummaryCategory(groupId, category) {
  const rows = codeRowsFor(groupId, category);
  const risk = categoryRiskFor(groupId, category);
  const pool = riskPoolFor(groupId, category);
  const profile = profileFor(category);
  const configured = Number(profile?.special_multiplier || 0) > 0;
  const plan = distributionPlanFor(groupId, category);
  const list = rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const retained = Number(row.retained_quantity ?? row.available_to_cut ?? qty);
    const promotionFactor =
      promotionFactorForSummaryCode(
        groupId,
        category,
        row.code
      );
    const promotionClass =
      promotionCodeClass(promotionFactor);
    const promotionCue =
      promotionCodeCue(promotionFactor);
    return `<div class="one-digit-code ${promotionClass} ${qty === 0 ? "zero" : ""} ${row.reserve_candidate ? "reserve" : ""} ${row.actual_special_point ? "actual" : ""}">
      <strong>${escapeHtml(category)}${escapeHtml(row.code)}${promotionCue}</strong>
      <span>${formatNumber(qty)}</span>
      ${Number(row.confirmed_cut || 0) > 0 ? `<small>คง ${formatNumber(retained)}</small>` : row.actual_special_point ? `<small>★ Point</small>` : row.reserve_candidate ? `<small>สำรอง</small>` : `<small></small>`}
    </div>`;
  }).join("");
  return `<section class="one-digit-category ${pool?.excess_point_risk > 0 ? "risk-active" : ""}">
    <div class="one-digit-head">
      <div><strong>${escapeHtml(category)}</strong></div>
      <div class="one-digit-head-metrics">
        <span>${configured ? `×${formatNumber(profile?.special_multiplier || 0)}` : "ตั้งตัวคูณ"}</span>
        <span>รับ ${formatNumber(pool?.gross_received || 0)}</span>
        ${configured ? `<span>Point ${formatNumber(pool?.risk_point_total || 0)}</span><strong>ควรตัด ${distributionTransferLabel(groupId, category)}</strong>` : `<strong>ยังไม่คำนวณ Risk</strong>`}
      </div>
    </div>
    <div class="one-digit-code-grid">${list}</div>
  </section>`;
}

function renderOneDigitSummaryPair(groupId) {
  const hasRows = ["H","L"].some((category) => codeRowsFor(groupId, category).some((row) => Number(row.order_total || 0) > 0));
  const configured = ["H","L"].some((category) => Number(profileFor(category)?.special_multiplier || 0) > 0);
  if (!hasRows && !configured) return "";
  return `<div class="one-digit-board">${["H","L"].map((category) => renderOneDigitSummaryCategory(groupId, category)).join("")}</div>`;
}

function renderGroupBoard(groupId) {
  const overall = overallRiskFor(groupId);
  const gRows = codeRowsFor(groupId, "G");
  return `<section class="summary-group-board">
    <div class="group-risk-header ${riskClass(overall?.risk_pct)}">
      <div><h3>${escapeHtml(groupName(groupId))}</h3><span>${overall?.risk_mode === "ACTUAL" ? "Point จริง" : "Point สำรอง"}</span></div>
      <div class="group-risk-summary">
        <div class="group-risk-metrics"><span>รับ <strong>${formatNumber(overall?.gross_received || 0)}</strong></span><span>หลังหัก <strong>${formatNumber(overall?.adjusted_received || 0)}</strong></span><span>Point <strong>${formatNumber(overall?.risk_point_total || 0)}</strong></span><span>ควรตัด <strong>${distributionTransferLabel(groupId, "MAIN")}</strong></span></div>
        <details class="group-risk-details"><summary>ดูรายละเอียด</summary><div><span>ยอมขาดทุน <strong>${formatNumber(overall?.point_loss_tolerance || 0)}</strong></span><span>รับได้ <strong>${formatNumber(overall?.risk_budget || 0)}</strong></span><span>Point เกิน <strong>${formatNumber(overall?.excess_point_risk || 0)}</strong></span><span>เสี่ยง <strong>${formatNumber(overall?.risk_pct || 0)}%</strong></span></div></details>
      </div>
    </div>
    <div class="four-column-board">${["A","B","E","F"].map((c) => renderCategoryColumn(groupId,c)).join("")}</div>
    ${gRows.length ? `<div class="g-board"><div class="category-heading"><h3>หมวด G</h3><span>×${formatNumber(profileFor("G")?.special_multiplier || 20)} · สูงสุด ${formatNumber(profileFor("G")?.max_special_codes || 4)} รหัส</span></div><div class="g-code-grid">${gRows.map((row)=>`<div class="g-code ${promotionCodeClass(promotionFactorForSummaryCode(groupId, "G", row.code))} ${row.reserve_candidate?"reserve":""} ${row.actual_special_point?"actual":""}"><strong>G${escapeHtml(row.code)}${promotionCodeCue(promotionFactorForSummaryCode(groupId, "G", row.code))}</strong><span>${formatNumber(row.order_total)}</span>${row.actual_special_point?`<em>★</em>`:row.reserve_candidate?`<em>สำรอง</em>`:""}</div>`).join("")}</div></div>` : ""}
    ${renderOneDigitSummaryPair(groupId)}
  </section>`;
}

function renderSummary() {
  const board = $("#summaryBoard");
  if (!state.dashboard?.settlement_session) { board.innerHTML = `<div class="empty">ยังไม่ได้เปิดยอด</div>`; return; }
  const groups = (state.dashboard.overall_risk || []).map((r) => r.summary_group_id);
  if (!groups.length) {
    const candidate = summaryGroupSelect.value !== "ALL" ? [summaryGroupSelect.value] : (state.dashboard.summary_groups || []).map((g) => g.id);
    board.innerHTML = candidate.map(renderGroupBoard).join("") || `<div class="empty">ยังไม่มีออเดอร์ในชุดยอดปัจจุบัน</div>`;
    return;
  }
  board.innerHTML = [...new Set(groups)].map(renderGroupBoard).join("");
}


function transferRoundMap() {
  const map = new Map();
  for (const batch of state.allocationHistory || []) {
    for (const item of batch.items || []) {
      const key = `${batch.summary_group_id}|${item.category}|${item.code}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        batch_number: Number(batch.batch_number || 0),
        destination: batch.destination || "-",
        quantity: Number(item.quantity || 0),
        confirmed_at: batch.confirmed_at || null,
      });
    }
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => a.batch_number - b.batch_number || String(a.confirmed_at || "").localeCompare(String(b.confirmed_at || "")));
  }
  return map;
}

function renderPostCutCategoryColumn(groupId, category, roundsByCode) {
  const allRows = codeRowsFor(groupId, category);
  const rows = allRows.filter(
    (row) =>
      Number(row.order_total || 0) > 0
      || Number(row.confirmed_cut || 0) > 0
  );

  const transferredTotal = allRows.reduce(
    (sum, row) =>
      sum + Number(row.confirmed_cut || 0),
    0
  );

  const receivedTotal = allRows.reduce(
    (sum, row) =>
      sum + Number(row.order_total || 0),
    0
  );

  const retainedTotal = allRows.reduce(
    (sum, row) =>
      sum + Number(
        row.retained_quantity
        ?? row.available_to_cut
        ?? row.order_total
        ?? 0
      ),
    0
  );

  const categoryRounds = new Set();

  for (const row of allRows) {
    for (
      const round of
      roundsByCode.get(
        `${groupId}|${category}|${row.code}`
      ) || []
    ) {
      categoryRounds.add(
        round.batch_number
      );
    }
  }

  const header = `<div class="board-column-head postcut-column-head">
    <div class="category-title">
      <strong>${escapeHtml(category)}</strong>
      <span>
        ตัด ${formatNumber(transferredTotal)}
        · ${formatNumber(categoryRounds.size)} รอบ
      </span>
    </div>
    <div class="category-risk-mini">
      <span>รับ ${formatNumber(receivedTotal)}</span>
      <span>ตัด ${formatNumber(transferredTotal)}</span>
      <span>คง ${formatNumber(retainedTotal)}</span>
    </div>
  </div>`;

  const topCodes = new Set(
    rows
      .slice(0, 20)
      .map((row) => String(row.code))
  );

  const renderedRows = rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const cut = Number(row.confirmed_cut || 0);

    const retained = Number(
      row.retained_quantity
      ?? row.available_to_cut
      ?? Math.max(0, qty - cut)
    );

    const rounds =
      roundsByCode.get(
        `${groupId}|${category}|${row.code}`
      ) || [];

    const top =
      topCodes.has(String(row.code));

    // Transaction safety:
    // any code actually cut must remain visible
    // even when it falls outside Top 20.
    const visible =
      top || cut > 0;

    const roundHtml =
      rounds.length
        ? `<details class="postcut-round-details">
            <summary>
              ${formatNumber(rounds.length)} รอบ
            </summary>
            <div class="postcut-rounds">
              ${rounds.map(
                (round) =>
                  `<span class="round-chip">
                    #${formatNumber(round.batch_number)}
                    ${escapeHtml(round.destination)}
                    ${formatNumber(round.quantity)}
                  </span>`
              ).join("")}
            </div>
          </details>`
        : "";

    const promotionFactor =
      promotionFactorForSummaryCode(
        groupId,
        category,
        row.code
      );
    const promotionClass =
      promotionCodeClass(promotionFactor);
    const promotionCue =
      promotionCodeCue(promotionFactor);

    const html = `<div class="board-code-row postcut-code-row postcut-summary-row ${promotionClass} ${qty === 0 ? "zero" : ""} ${cut > 0 ? "has-cut" : ""}">
      <div class="postcut-summary-main">
        <strong class="postcut-code">
          ${escapeHtml(row.code)}${promotionCue}
        </strong>

        <span class="postcut-received">
          ${formatNumber(qty)}
        </span>

        <span class="postcut-cut">
          ${cut > 0 ? formatNumber(cut) : "—"}
        </span>

        <strong class="postcut-retained">
          ${formatNumber(retained)}
        </strong>
      </div>

      ${roundHtml}
    </div>`;

    return {
      html,
      top,
      visible,
      cut,
    };
  });

  const primaryRows =
    renderedRows
      .filter((row) => row.visible)
      .map((row) => row.html);

  const overflowRows =
    renderedRows
      .filter((row) => !row.visible)
      .map((row) => row.html);

  const tableHead = `
    <div class="postcut-table-head">
      <span>รหัส</span>
      <span>รับ</span>
      <span>ตัด</span>
      <span>คง</span>
    </div>
  `;

  const list =
    renderedRows.length
      ? `
          ${tableHead}
          ${primaryRows.join("")}
          ${renderRankedOverflow(
            overflowRows
          )}
        `
      : `<div class="empty compact">
          ยังไม่มีรายการ
        </div>`;

  return `<section class="board-column postcut-board-column">
    ${header}
    <div class="board-code-list">
      ${list}
    </div>
  </section>`;
}

function renderPostCutGroupBoard(groupId, roundsByCode) {
  const rows = (state.dashboard?.risk_codes || []).filter((row) => row.summary_group_id === groupId);
  const received = rows.reduce((sum, row) => sum + Number(row.order_total || 0), 0);
  const transferred = rows.reduce((sum, row) => sum + Number(row.confirmed_cut || 0), 0);
  const retained = rows.reduce((sum, row) => sum + Number(row.retained_quantity ?? row.available_to_cut ?? row.order_total ?? 0), 0);
  const groupBatches = (state.allocationHistory || []).filter((batch) => batch.summary_group_id === groupId);
  const cutCodes = rows.filter((row) => Number(row.confirmed_cut || 0) > 0).length;
  const gRows = codeRowsFor(groupId, "G");

  return `<section class="summary-group-board postcut-summary-board">
    <div class="group-risk-header postcut-group-header">
      <div><h3>${escapeHtml(groupName(groupId))}</h3><span>หลังตัดยอด</span></div>
      <div class="group-risk-summary"><div class="group-risk-metrics"><span>รับ <strong>${formatNumber(received)}</strong></span><span>ตัด <strong>${formatNumber(transferred)}</strong></span><span>คง <strong>${formatNumber(retained)}</strong></span><span>รอบ <strong>${formatNumber(groupBatches.length)}</strong></span><span>รหัส <strong>${formatNumber(cutCodes)}</strong></span></div></div>
    </div>
    <div class="four-column-board">${["A","B","E","F"].map((category) => renderPostCutCategoryColumn(groupId, category, roundsByCode)).join("")}</div>
    ${gRows.length ? `<div class="g-board postcut-g-board"><div class="category-heading"><h3>หมวด G</h3><span>หลังตัดยอด</span></div><div class="g-code-grid">${gRows.map((row) => {
      const qty = Number(row.order_total || 0);
      const cut = Number(row.confirmed_cut || 0);
      const retainedQty = Number(row.retained_quantity ?? row.available_to_cut ?? Math.max(0, qty-cut));
      const rounds = roundsByCode.get(`${groupId}|G|${row.code}`) || [];
      const promotionFactor =
        promotionFactorForSummaryCode(
          groupId,
          "G",
          row.code
        );
      return `<div class="g-code postcut-g-code ${promotionCodeClass(promotionFactor)} ${cut > 0 ? "has-cut" : ""}"><strong>G${escapeHtml(row.code)}${promotionCodeCue(promotionFactor)}</strong><span>คง ${formatNumber(retainedQty)}</span><em>รับ ${formatNumber(qty)} · ตัด ${formatNumber(cut)}</em>${rounds.length ? `<small>${rounds.map((round) => `#${formatNumber(round.batch_number)} ${escapeHtml(round.destination)} ${formatNumber(round.quantity)}`).join(" · ")}</small>` : ""}</div>`;
    }).join("")}</div></div>` : ""}
    <div class="one-digit-board postcut-one-digit-board">${["H","L"].map((category) => renderPostCutCategoryColumn(groupId, category, roundsByCode)).join("")}</div>
  </section>`;
}

function renderAfterCut() {
  const board = $("#postCutBoard");
  if (!board) return;
  if (!state.dashboard?.settlement_session) {
    board.innerHTML = `<div class="empty">ยังไม่ได้เปิดยอด</div>`;
    return;
  }
  const roundsByCode = transferRoundMap();
  const selected = summaryGroupSelect.value || "ALL";
  const groups = selected !== "ALL"
    ? [selected]
    : [...new Set((state.dashboard?.overall_risk || []).map((row) => row.summary_group_id))];
  const fallback = groups.length ? groups : (state.dashboard?.summary_groups || []).map((group) => group.id);
  board.innerHTML = fallback.map((groupId) => renderPostCutGroupBoard(groupId, roundsByCode)).join("") || `<div class="empty">ยังไม่มีข้อมูล</div>`;
}

function clearTransferPreview(message = "") {
  state.transferPreview = null;
  state.bulkDistributionPreview = null;
  const root = $("#transferPreview");
  if (!root) return;
  root.innerHTML = message ? `<div class="preview-box warn">${escapeHtml(message)}</div>` : "";
}

function recommendationMapFor(groupId, riskPool = "MAIN") {
  return new Map((distributionPlanFor(groupId, riskPool)?.recommendations || []).map((row) => [`${row.category}|${row.code}`, row]));
}


function allocationLineGroupsFor(groupId) {
  if (!groupId || groupId === "ALL") return [];

  return (state.dashboard?.line_group_risk || [])
    .filter(
      (row) =>
        row.summary_group_id === groupId
        && row.enabled !== false
    )
    .sort(
      (a, b) =>
        String(a.line_group_name || a.line_group_id)
          .localeCompare(
            String(b.line_group_name || b.line_group_id)
          )
    );
}


function allocationLineGroupRiskFor(lineGroupId) {
  if (!lineGroupId) return null;

  return (
    state.dashboard?.line_group_risk || []
  ).find(
    (row) =>
      row.line_group_id === lineGroupId
  ) || null;
}


function lineGroupDistributionPlanFor(
  lineGroupId,
  riskPool = "MAIN"
) {
  if (!lineGroupId) return null;

  return (
    state.dashboard?.line_group_distribution_plans || []
  ).find(
    (row) =>
      row.line_group_id === lineGroupId
      && (row.risk_pool || "MAIN") === riskPool
  ) || null;
}


function lineGroupRecommendationMapFor(
  lineGroupId,
  riskPool = "MAIN"
) {
  return new Map(
    (
      lineGroupDistributionPlanFor(
        lineGroupId,
        riskPool
      )?.recommendations || []
    ).map(
      (row) => [
        `${row.category}|${row.code}`,
        row,
      ]
    )
  );
}


function lineGroupCodeRowsFor(
  lineGroupId,
  category
) {
  const risk =
    allocationLineGroupRiskFor(lineGroupId);

  const rows = (
    state.dashboard?.line_group_risk_codes || []
  ).filter(
    (row) =>
      row.line_group_id === lineGroupId
      && row.category === category
  );


  const map = new Map(
    rows.map(
      (row) => [row.code, row]
    )
  );


  // Preserve full 00–99 board for A/B.
  if (["A", "B"].includes(category)) {
    for (let i = 0; i < 100; i += 1) {
      const code =
        String(i).padStart(2, "0");

      if (!map.has(code)) {
        map.set(code, {
          line_group_id:
            lineGroupId,

          summary_group_id:
            risk?.summary_group_id,

          category,
          code,

          order_total:
            0,

          confirmed_cut:
            0,

          retained_quantity:
            0,

          effective_multiplier:
            Number(
              profileFor(category)
                ?.special_multiplier || 0
            ),

          retention_limit:
            0,

          recommended_cut:
            0,

          recommended_point_reduction:
            0,

          retention_status:
            "SAFE",

          confirmed_cut_exceeds_order_total:
            false,
        });
      }
    }
  }


  // Preserve H0–H9 / L0–L9 board.
  if (["H", "L"].includes(category)) {
    for (let i = 0; i < 10; i += 1) {
      const code =
        String(i);

      if (!map.has(code)) {
        map.set(code, {
          line_group_id:
            lineGroupId,

          summary_group_id:
            risk?.summary_group_id,

          category,
          code,

          order_total:
            0,

          confirmed_cut:
            0,

          retained_quantity:
            0,

          effective_multiplier:
            Number(
              profileFor(category)
                ?.special_multiplier || 0
            ),

          retention_limit:
            0,

          recommended_cut:
            0,

          recommended_point_reduction:
            0,

          retention_status:
            "SAFE",

          confirmed_cut_exceeds_order_total:
            false,
        });
      }
    }
  }


  return [...map.values()]
    .sort(
      (a, b) => {
        const orderDifference =
          Number(b.order_total || 0)
          - Number(a.order_total || 0);

        if (orderDifference !== 0) {
          return orderDifference;
        }

        return String(a.code)
          .localeCompare(String(b.code));
      }
    );
}


function syncAllocationLineGroupOptions(groupId) {
  if (!allocationLineGroupSelect) return;

  const previous =
    allocationLineGroupSelect.value;

  const rows =
    allocationLineGroupsFor(groupId);


  allocationLineGroupSelect.innerHTML =
    `<option value="">เลือก LINE Group</option>`;


  for (const row of rows) {
    const option =
      document.createElement("option");

    option.value =
      row.line_group_id;

    option.textContent =
      `${row.line_group_name || row.line_group_id}`
      + (
        Number(row.gross_received || 0) > 0
          ? ` · ${formatNumber(row.gross_received)}`
          : ""
      );

    allocationLineGroupSelect.append(option);
  }


  allocationLineGroupSelect.disabled =
    !groupId
    || groupId === "ALL"
    || rows.length === 0;


  // Keep current selection if still valid.
  if (
    previous
    && rows.some(
      (row) =>
        row.line_group_id === previous
    )
  ) {
    allocationLineGroupSelect.value =
      previous;

    return;
  }


  // If only one LINE Group exists, select it automatically.
  if (rows.length === 1) {
    allocationLineGroupSelect.value =
      rows[0].line_group_id;

    return;
  }


  allocationLineGroupSelect.value = "";
}


function lineGroupAllocationBlockReason(
  lineGroupId
) {
  const risk =
    allocationLineGroupRiskFor(lineGroupId);

  if (!risk) {
    return "LINE_GROUP_NOT_READY";
  }


  if (risk.enabled === false) {
    return "LINE_GROUP_DISABLED";
  }


  if (
    risk.risk_status === "DATA_INTEGRITY_ERROR"
    || Number(risk.over_cut_code_count || 0) > 0
  ) {
    return "DATA_INTEGRITY_ERROR";
  }


  if (
    risk.risk_model !== "CATEGORY_RETENTION"
  ) {
    return "RISK_MODEL_NOT_READY";
  }


  // WAITING_FIRST_BAND is a valid read state.
  // It simply has no cut recommendation yet.
  if (
    risk.calculation_status === "WAITING_FIRST_BAND"
  ) {
    return null;
  }


  if (
    risk.calculation_status !== "READY"
  ) {
    return (
      risk.calculation_status
      || "NOT_READY"
    );
  }


  const plans =
    ["MAIN", "H", "L"]
      .map(
        (pool) =>
          lineGroupDistributionPlanFor(
            lineGroupId,
            pool
          )
      )
      .filter(Boolean);


  if (
    plans.some(
      (plan) =>
        plan.calculation_status
        === "DATA_INTEGRITY_ERROR"
    )
  ) {
    return "DATA_INTEGRITY_ERROR";
  }


  if (
    plans.some(
      (plan) =>
        plan.calculation_status
        === "UNCONFIGURED"
    )
  ) {
    return "UNCONFIGURED";
  }


  if (
    plans.some(
      (plan) =>
        ![
          "READY",
          "WAITING_FIRST_BAND",
        ].includes(plan.calculation_status)
    )
  ) {
    return "NOT_READY";
  }


  return null;
}


function lineGroupAllocationRequired(
  lineGroupId
) {
  return ["MAIN", "H", "L"].reduce(
    (sum, pool) => {
      const value =
        lineGroupDistributionPlanFor(
          lineGroupId,
          pool
        )?.transfer_required_total;

      // Integrity state uses null deliberately.
      if (value == null) {
        return sum;
      }

      return sum + Number(value || 0);
    },
    0
  );
}


function selectedRecommendedCodes() {
  return $$(".allocation-code-select:checked").map((input) => ({
    category: input.dataset.category,
    code: input.dataset.code,
    risk_pool: input.dataset.pool || "MAIN",
    line_group_id: input.dataset.lineGroup || "",
  }));
}

function selectedWarehouseNames() {
  return $$(".warehouse-choice-input:checked").map((input) => input.value);
}

function setRecommendedSelection(checked) {
  $$(".allocation-code-select").forEach((input) => { input.checked = checked; });
  updateBulkDistributionSummary(true);
}

function persistWarehouseSelection() {
  const selected = selectedWarehouseNames();
  sessionStorage.setItem("lineOrderDistributionWarehouses", JSON.stringify(selected));
}

function savedWarehouseSelection(warehouses) {
  let saved = [];
  try { saved = JSON.parse(sessionStorage.getItem("lineOrderDistributionWarehouses") || "[]"); } catch {}
  const enabled = new Set((warehouses || []).map((row) => row.destination));
  const valid = (Array.isArray(saved) ? saved : []).filter((name) => enabled.has(name));
  return valid.length ? new Set(valid) : new Set((warehouses || []).map((row) => row.destination));
}

function renderWarehouseChoices(warehouses) {
  const root = $("#warehouseChoices");
  if (!root) return;
  if (!warehouses.length) {
    root.innerHTML = `<div class="risk-notice">ยังไม่ได้ตั้งค่าคลังปลายทาง ไปที่ <strong>ตั้งค่า → ลิมิตคลังต่อรอบ</strong></div>`;
    return;
  }
  const selected = savedWarehouseSelection(warehouses);
  root.innerHTML = warehouses.map((row) => `<label class="warehouse-choice">
    <input class="warehouse-choice-input" type="checkbox" value="${escapeHtml(row.destination)}" ${selected.has(row.destination) ? "checked" : ""} />
    <span><strong>${escapeHtml(row.destination)}</strong><small>สูงสุด ${formatNumber(row.max_batch_quantity)} / รอบ</small></span>
  </label>`).join("");
  $$(".warehouse-choice-input").forEach((input) => input.addEventListener("change", () => {
    persistWarehouseSelection();
    clearTransferPreview();
    updateBulkDistributionSummary(false);
  }));
}

function renderAllocationCategoryColumn(groupId, category, riskPool = "MAIN") {
  const profile = profileFor(category);
  const risk = categoryRiskFor(groupId, category);
  const recommendations = recommendationMapFor(groupId, riskPool);
  const rows = codeRowsFor(groupId, category);
  const maxQty = Math.max(1, ...rows.map((r) => Number(r.order_total || 0)));
  const recommendedTotal = rows.reduce((sum, row) => sum + Number(recommendations.get(`${category}|${row.code}`)?.recommended_transfer || 0), 0);
  const header = `<div class="board-column-head ${riskClass(risk?.reserve_risk_pct || 0)}">
    <div class="category-title"><strong>${escapeHtml(category)}</strong><span>×${formatNumber(profile?.special_multiplier || risk?.special_multiplier || 0)} · ควรตัด ${formatNumber(recommendedTotal)}</span></div>
    <div class="category-risk-mini"><span>รับ ${formatNumber(risk?.order_total || 0)}</span><span>หลังหัก ${formatNumber(risk?.adjusted_total || 0)}</span><span>Point ${formatNumber(risk?.point_reserve || 0)}</span></div>
  </div>`;
  const list = rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const retained = Number(row.retained_quantity ?? row.available_to_cut ?? 0);
    const rec = recommendations.get(`${category}|${row.code}`);
    const recommended = Math.min(retained, Number(rec?.recommended_transfer || 0));
    const width = qty > 0 ? Math.max(3, qty / maxQty * 100) : 0;
    const promo = Number(row.promotion_factor_pct ?? 100) < 100 ? `<span class="promo-badge">PROMO ${formatNumber(row.promotion_factor_pct)}%</span>` : "";
    const reserve = row.reserve_candidate && qty > 0 ? `<span class="reserve-badge">สำรอง</span>` : "";
    const transferred = Number(row.confirmed_cut || 0) > 0 ? `<span class="promo-badge">ส่งแล้ว ${formatNumber(row.confirmed_cut)}</span>` : "";
    return `<label class="board-code-row allocation-code-row ${qty === 0 ? "zero" : ""} ${recommended > 0 ? "recommended" : ""} ${row.reserve_candidate ? "reserve" : ""}">
      <div class="allocation-code-check">
        ${recommended > 0 ? `<input class="allocation-code-select" type="checkbox" checked data-pool="${escapeHtml(riskPool)}" data-category="${escapeHtml(category)}" data-code="${escapeHtml(row.code)}" aria-label="เลือก ${escapeHtml(category)}${escapeHtml(row.code)}" />` : `<span class="allocation-code-spacer"></span>`}
      </div>
      <div class="allocation-code-content">
        <div class="board-code-main"><strong>${escapeHtml(row.code)}</strong><span>${formatNumber(qty)}</span></div>
        <div class="board-code-badges">${reserve}${promo}${transferred}</div>
        <div class="allocation-code-meta"><span>คง ${formatNumber(retained)}</span>${recommended > 0 ? `<strong>ตัด ${formatNumber(recommended)}</strong>` : `<span>—</span>`}</div>
        <div class="qty-track"><div class="qty-fill" style="width:${width}%"></div></div>
      </div>
    </label>`;
  }).join("");
  return `<section class="board-column allocation-board-column">${header}<div class="board-code-list">${list}</div></section>`;
}


function updateBulkDistributionSummary(
  invalidatePreview = true
) {
  const groupId =
    summaryGroupSelect.value;

  const lineGroupId =
    allocationLineGroupSelect?.value || "";

  const root =
    $("#bulkDistributionSummary");

  const button =
    $("#runBulkDistributionButton");


  if (
    !groupId
    || groupId === "ALL"
  ) {
    root.className =
      "transfer-selection-bar";

    root.innerHTML =
      `<span>ตัดยอด</span><strong>เลือกกลุ่มสรุป</strong>`;

    button.disabled = true;

    if (invalidatePreview) {
      clearTransferPreview();
    }

    return;
  }


  if (!lineGroupId) {
    root.className =
      "transfer-selection-bar";

    root.innerHTML =
      `<span>ตัดยอด</span><strong>เลือก LINE Group</strong>`;

    button.disabled = true;

    if (invalidatePreview) {
      clearTransferPreview();
    }

    return;
  }


  const risk =
    allocationLineGroupRiskFor(
      lineGroupId
    );

  const blockReason =
    lineGroupAllocationBlockReason(
      lineGroupId
    );


  if (blockReason) {
    const label = {
      DATA_INTEGRITY_ERROR:
        "ข้อมูลตัดยอดไม่สอดคล้อง",

      LINE_GROUP_DISABLED:
        "LINE Group ถูกปิดใช้งาน",

      UNCONFIGURED:
        "ยังตั้งค่าไม่ครบ",

      NOT_READY:
        "ยังคำนวณไม่ได้",

      RISK_MODEL_NOT_READY:
        "โมเดล Risk ยังไม่พร้อม",

      LINE_GROUP_NOT_READY:
        "ยังไม่มีข้อมูล LINE Group",
    }[blockReason] || blockReason;


    root.className =
      "transfer-selection-bar over";

    root.innerHTML =
      `<span>${escapeHtml(
        risk?.line_group_name
        || lineGroupId
      )}</span><strong>${escapeHtml(label)}</strong>`;

    button.disabled = true;

    if (invalidatePreview) {
      clearTransferPreview();
    }

    return;
  }


  const codes =
    selectedRecommendedCodes();

  const warehouses =
    selectedWarehouseNames();


  const wrongLineGroup =
    codes.some(
      (item) =>
        item.line_group_id
        && item.line_group_id !== lineGroupId
    );


  if (wrongLineGroup) {
    root.className =
      "transfer-selection-bar over";

    root.innerHTML =
      `<span>ข้อมูลเปลี่ยน</span><strong>โหลดใหม่ก่อนตัดยอด</strong>`;

    button.disabled = true;

    if (invalidatePreview) {
      clearTransferPreview();
    }

    return;
  }


  const selectedQty =
    codes.reduce(
      (sum, item) =>
        sum
        + Number(
          lineGroupRecommendationMapFor(
            lineGroupId,
            item.risk_pool
          ).get(
            `${item.category}|${item.code}`
          )?.recommended_transfer || 0
        ),
      0
    );


  const required =
    lineGroupAllocationRequired(
      lineGroupId
    );


  if (
    risk?.calculation_status === "WAITING_FIRST_BAND"
  ) {
    root.className =
      "transfer-selection-bar";

    root.innerHTML =
      `<span>ยังไม่ถึงรอบคำนวณ</span>`
      + `<strong>รออีก ${formatNumber(
        risk.amount_to_next_band || 0
      )}</strong>`;

  } else if (!required) {
    root.className =
      "transfer-selection-bar";

    root.innerHTML =
      `<span>ยอดปัจจุบัน</span>`
      + `<strong>ยังไม่ต้องตัด</strong>`;

  } else if (!codes.length) {
    root.className =
      "transfer-selection-bar over";

    root.innerHTML =
      `<span>ควรตัด ${formatNumber(required)}</span>`
      + `<strong>เลือกรหัส</strong>`;

  } else if (!warehouses.length) {
    root.className =
      "transfer-selection-bar over";

    root.innerHTML =
      `<span>${formatNumber(codes.length)} รหัส · `
      + `${formatNumber(selectedQty)}</span>`
      + `<strong>เลือกคลัง</strong>`;

  } else {
    root.className =
      "transfer-selection-bar ready";

    root.innerHTML =
      `<span>${formatNumber(codes.length)} รหัส · `
      + `${formatNumber(selectedQty)} หน่วย</span>`
      + `<strong>${formatNumber(
        warehouses.length
      )} คลัง</strong>`;
  }


  button.disabled =
    state.dashboardStale
    || required <= 0
    || !codes.length
    || !warehouses.length;

  button.title = "";


  if (invalidatePreview) {
    clearTransferPreview();
  }
}

function renderAllocationPoolStatus(groupId, pool) {
  const stateRow = riskPoolFor(groupId, pool);
  const plan = distributionPlanFor(groupId, pool);
  if (!stateRow) return "";
  const received = Number(stateRow.gross_received || 0);
  if (received <= 0) return "";
  const configured = pool === "MAIN" || stateRow.multiplier_configured !== false;
  const calculationFailed = plan?.calculation_status === "LIMIT";
  const pointPending = plan?.calculation_status === "NOT_READY";
  const required = Number(plan?.transfer_required_total || 0);
  const excess = Number(stateRow.excess_point_risk || 0);
  return `<div class="pool-status-card ${required > 0 ? "active" : ""} ${!configured || calculationFailed || pointPending ? "unconfigured" : ""}">
    <span>${escapeHtml(riskPoolLabel(pool))}</span>
    <strong>${calculationFailed || pointPending ? "—" : configured ? formatNumber(required) : "—"}</strong>
    <small>${calculationFailed ? "คำนวณไม่สำเร็จ" : pointPending ? "รอระบุ Point" : !configured ? "ตั้งตัวคูณ Point" : required > 0 ? "ควรตัด" : "ปกติ"}</small>
    <details><summary>รายละเอียด</summary><div><span>รับ ${formatNumber(received)}</span><span>หลังหัก ${formatNumber(stateRow.adjusted_received || 0)}</span><span>Point ${formatNumber(stateRow.risk_point_total || 0)}</span><span>เกิน ${formatNumber(excess)}</span></div></details>
  </div>`;
}

function renderOneDigitAllocationCategory(groupId, category) {
  const pool = riskPoolFor(groupId, category);
  const plan = distributionPlanFor(groupId, category);
  const profile = profileFor(category);
  const rows = codeRowsFor(groupId, category);
  const recs = recommendationMapFor(groupId, category);
  const configured = Number(profile?.special_multiplier || 0) > 0;
  const calculationFailed = plan?.calculation_status === "LIMIT";
  const pointPending = plan?.calculation_status === "NOT_READY";
  const list = rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const retained = Number(row.retained_quantity ?? row.available_to_cut ?? qty);
    const rec = recs.get(`${category}|${row.code}`);
    const recommended = calculationFailed || pointPending
      ? 0
      : Math.min(retained, Number(rec?.recommended_transfer || 0));
    return `<label class="one-digit-code allocation-one-digit-code ${qty === 0 ? "zero" : ""} ${recommended > 0 ? "recommended" : ""}">
      ${recommended > 0 ? `<input class="allocation-code-select" type="checkbox" checked data-pool="${category}" data-category="${category}" data-code="${escapeHtml(row.code)}" />` : `<span class="allocation-code-spacer"></span>`}
      <strong>${category}${escapeHtml(row.code)}</strong>
      <span>${formatNumber(qty)}</span>
      <small>${calculationFailed ? "คำนวณไม่สำเร็จ" : pointPending ? "รอระบุ Point" : recommended > 0 ? `ตัด ${formatNumber(recommended)}` : Number(row.confirmed_cut||0)>0 ? `คง ${formatNumber(retained)}` : ""}</small>
    </label>`;
  }).join("");
  return `<section class="one-digit-category allocation-one-digit-category ${Number(plan?.transfer_required_total || 0)>0 ? "risk-active" : ""}">
    <div class="one-digit-head">
      <div><strong>${category}</strong></div>
      <div class="one-digit-head-metrics"><span>${configured ? `×${formatNumber(profile?.special_multiplier || 0)}` : "ยังไม่ตั้งตัวคูณ"}</span><span>รับ ${formatNumber(pool?.gross_received || 0)}</span><strong>${calculationFailed ? "คำนวณไม่สำเร็จ" : pointPending ? "รอระบุ Point" : configured ? `ตัด ${formatNumber(plan?.transfer_required_total || 0)}` : "ตั้งค่าก่อน"}</strong></div>
    </div>
    <div class="one-digit-code-grid">${list}</div>
  </section>`;
}


function renderLineGroupPoolStatus(
  lineGroupId,
  pool
) {
  const plan =
    lineGroupDistributionPlanFor(
      lineGroupId,
      pool
    );

  const risk =
    allocationLineGroupRiskFor(
      lineGroupId
    );


  if (!plan || !risk) {
    return "";
  }


  const required =
    plan.transfer_required_total == null
      ? null
      : Number(
          plan.transfer_required_total || 0
        );


  const status =
    plan.calculation_status;


  let label =
    Number(required || 0) > 0
      ? "ควรตัด"
      : "ปกติ";


  if (
    status === "WAITING_FIRST_BAND"
  ) {
    label =
      `รออีก ${formatNumber(
        risk.amount_to_next_band || 0
      )}`;

  } else if (
    status === "DATA_INTEGRITY_ERROR"
  ) {
    label =
      "ข้อมูลผิดปกติ";

  } else if (
    status === "UNCONFIGURED"
  ) {
    label =
      "ตั้งค่าไม่ครบ";

  } else if (
    status === "NOT_READY"
  ) {
    label =
      "ยังคำนวณไม่ได้";
  }


  return `
    <div class="pool-status-card ${
      Number(required || 0) > 0
        ? "active"
        : ""
    } ${
      ![
        "READY",
        "WAITING_FIRST_BAND",
      ].includes(status)
        ? "unconfigured"
        : ""
    }">

      <span>${escapeHtml(
        riskPoolLabel(pool)
      )}</span>

      <strong>${
        status === "READY"
          ? formatNumber(required || 0)
          : "—"
      }</strong>

      <small>${escapeHtml(label)}</small>

      <details>
        <summary>รายละเอียด</summary>

        <div>
          <span>
            รับ ${formatNumber(
              risk.gross_received || 0
            )}
          </span>

          <span>
            Band ${formatNumber(
              risk.calculation_band || 0
            )}
          </span>

          <span>
            งบ ${formatNumber(
              risk.risk_budget || 0
            )}
          </span>
        </div>
      </details>
    </div>
  `;
}


function topAllocationVisibleCodes(
  rows,
  limit = 20
) {
  return new Set(
    rows
      .filter(
        (row) =>
          Number(row.order_total || 0) > 0
      )
      .slice(0, limit)
      .map(
        (row) =>
          String(row.code)
      )
  );
}


function renderLineGroupAllocationCategoryColumn(
  lineGroupId,
  category,
  riskPool = "MAIN"
) {
  const rows =
    lineGroupCodeRowsFor(
      lineGroupId,
      category
    );

  const recommendations =
    lineGroupRecommendationMapFor(
      lineGroupId,
      riskPool
    );

  const visibleCodes =
    topAllocationVisibleCodes(
      rows,
      20
    );

  const renderedRows =
    rows.map((row) => {
      const qty =
        Number(
          row.order_total || 0
        );

      const retained =
        Number(
          row.retained_quantity || 0
        );

      const limit =
        Number(
          row.retention_limit || 0
        );

      const rec =
        recommendations.get(
          `${category}|${row.code}`
        );

      const recommended =
        Math.min(
          Math.max(
            0,
            retained - limit
          ),
          Number(
            rec?.recommended_transfer || 0
          )
        );

      const top =
        visibleCodes.has(
          String(row.code)
        );

      const visible =
        top || recommended > 0;

      const promotionFactor =
        promotionFactorForSummaryCode(
          row.summary_group_id
            || allocationLineGroupRiskFor(
              lineGroupId
            )?.summary_group_id,
          category,
          row.code
        );
      const promotionClass =
        promotionCodeClass(promotionFactor);
      const promotionCue =
        promotionCodeCue(promotionFactor);

      const html = `
        <label class="
          board-code-row
          allocation-code-row
          allocation-compact-row
          allocation-summary-row
          ${recommended > 0 ? "recommended" : ""}
          ${promotionClass}
        ">

          <div class="allocation-code-check">
            ${
              recommended > 0
                ? `<input
                    class="allocation-code-select"
                    type="checkbox"
                    checked
                    data-line-group="${escapeHtml(lineGroupId)}"
                    data-pool="${escapeHtml(riskPool)}"
                    data-category="${escapeHtml(category)}"
                    data-code="${escapeHtml(row.code)}"
                    aria-label="เลือก ${escapeHtml(category)}${escapeHtml(row.code)}"
                  />`
                : `<span class="allocation-code-spacer"></span>`
            }
          </div>

          <div class="allocation-compact-main allocation-summary-main">

            <strong class="allocation-compact-code">
              ${escapeHtml(row.code)}${promotionCue}
            </strong>

            <span class="allocation-compact-qty">
              ${formatNumber(qty)}
            </span>

            ${
              recommended > 0
                ? `<small class="allocation-compact-cut">
                    ตัด ${formatNumber(recommended)}
                  </small>`
                : `<span class="allocation-compact-empty"></span>`
            }

          </div>

        </label>
      `;

      return {
        html,
        top,
        visible,
        recommended,
      };
    });

  const primaryRows =
    renderedRows
      .filter((row) => row.visible)
      .map((row) => row.html);

  const overflowRows =
    renderedRows
      .filter((row) => !row.visible)
      .map((row) => row.html);

  const actionableOutsideTop =
    renderedRows.filter(
      (row) =>
        !row.top
        && row.recommended > 0
    ).length;

  return `
    <section class="board-column allocation-board-column">

      <div class="board-column-head allocation-compact-head">
        <strong>${escapeHtml(category)}</strong>
        <span>
          ${formatNumber(visibleCodes.size)} อันดับแรก${actionableOutsideTop > 0 ? ` + ต้องตัด ${formatNumber(actionableOutsideTop)}` : ""}
        </span>
      </div>

      <div class="board-code-list">
        ${primaryRows.join("")}
        ${renderRankedOverflow(overflowRows)}
      </div>

    </section>
  `;
}

function renderLineGroupOneDigitCategory(
  lineGroupId,
  category
) {
  const rows =
    lineGroupCodeRowsFor(
      lineGroupId,
      category
    );

  const recommendations =
    lineGroupRecommendationMapFor(
      lineGroupId,
      category
    );

  const visibleCodes =
    topAllocationVisibleCodes(
      rows,
      20
    );

  const renderedRows =
    rows.map((row) => {
      const qty =
        Number(
          row.order_total || 0
        );

      const retained =
        Number(
          row.retained_quantity || 0
        );

      const limit =
        Number(
          row.retention_limit || 0
        );

      const rec =
        recommendations.get(
          `${category}|${row.code}`
        );

      const recommended =
        Math.min(
          Math.max(
            0,
            retained - limit
          ),
          Number(
            rec?.recommended_transfer || 0
          )
        );

      const top =
        visibleCodes.has(
          String(row.code)
        );

      const visible =
        top || recommended > 0;

      const promotionFactor =
        promotionFactorForSummaryCode(
          row.summary_group_id
            || allocationLineGroupRiskFor(
              lineGroupId
            )?.summary_group_id,
          category,
          row.code
        );
      const promotionClass =
        promotionCodeClass(promotionFactor);
      const promotionCue =
        promotionCodeCue(promotionFactor);

      const html = `
        <label class="
          one-digit-code
          allocation-one-digit-code
          allocation-compact-row
          allocation-summary-row
          ${recommended > 0 ? "recommended" : ""}
          ${promotionClass}
        ">

          <div class="allocation-code-check">
            ${
              recommended > 0
                ? `<input
                    class="allocation-code-select"
                    type="checkbox"
                    checked
                    data-line-group="${escapeHtml(lineGroupId)}"
                    data-pool="${escapeHtml(category)}"
                    data-category="${escapeHtml(category)}"
                    data-code="${escapeHtml(row.code)}"
                    aria-label="เลือก ${escapeHtml(category)}${escapeHtml(row.code)}"
                  />`
                : `<span class="allocation-code-spacer"></span>`
            }
          </div>

          <div class="allocation-compact-main allocation-summary-main">

            <strong class="allocation-compact-code">
              ${escapeHtml(row.code)}${promotionCue}
            </strong>

            <span class="allocation-compact-qty">
              ${formatNumber(qty)}
            </span>

            ${
              recommended > 0
                ? `<small class="allocation-compact-cut">
                    ตัด ${formatNumber(recommended)}
                  </small>`
                : `<span class="allocation-compact-empty"></span>`
            }

          </div>

        </label>
      `;

      return {
        html,
        top,
        visible,
        recommended,
      };
    });

  const primaryRows =
    renderedRows
      .filter((row) => row.visible)
      .map((row) => row.html);

  const overflowRows =
    renderedRows
      .filter((row) => !row.visible)
      .map((row) => row.html);

  const actionableOutsideTop =
    renderedRows.filter(
      (row) =>
        !row.top
        && row.recommended > 0
    ).length;

  return `
    <section class="one-digit-category allocation-one-digit-category">

      <div class="one-digit-head allocation-compact-head">
        <strong>${escapeHtml(category)}</strong>

        <span>
          ${formatNumber(visibleCodes.size)} อันดับแรก${actionableOutsideTop > 0 ? ` + ต้องตัด ${formatNumber(actionableOutsideTop)}` : ""}
        </span>
      </div>

      <div class="one-digit-code-grid">
        ${primaryRows.join("")}
        ${renderRankedOverflow(overflowRows)}
      </div>

    </section>
  `;
}

function renderAllocation() {
  const riskSummary =
    $("#allocationRiskSummary");

  const board =
    $("#allocationBoard");

  const groupId =
    summaryGroupSelect.value;

  const warehouses =
    state.dashboard?.warehouse_limits || [];


  syncAllocationLineGroupOptions(
    groupId
  );


  if (
    !state.dashboard?.settlement_session
  ) {
    riskSummary.innerHTML = "";

    $("#warehouseChoices").innerHTML =
      "";

    board.innerHTML =
      `<div class="empty">ยังไม่ได้เปิดยอด</div>`;

    updateBulkDistributionSummary(false);

    return;
  }


  if (
    !groupId
    || groupId === "ALL"
  ) {
    riskSummary.innerHTML =
      `<div class="risk-notice">
        เลือก <strong>กลุ่มสรุป</strong>
        ด้านบน 1 กลุ่มก่อนตัดยอด
      </div>`;

    $("#warehouseChoices").innerHTML =
      "";

    board.innerHTML = "";

    updateBulkDistributionSummary(false);

    return;
  }


  const lineGroupId =
    allocationLineGroupSelect?.value
    || "";


  if (!lineGroupId) {
    riskSummary.innerHTML =
      `<div class="risk-notice">
        ${escapeHtml(groupName(groupId))}
        · เลือก <strong>LINE Group</strong>
        ที่ต้องการคำนวณและตัดยอด
      </div>`;

    $("#warehouseChoices").innerHTML =
      "";

    board.innerHTML = "";

    updateBulkDistributionSummary(false);

    return;
  }


  const risk =
    allocationLineGroupRiskFor(
      lineGroupId
    );


  if (!risk) {
    riskSummary.innerHTML =
      `<div class="risk-notice">
        ไม่พบสถานะความเสี่ยงของ LINE Group นี้
      </div>`;

    $("#warehouseChoices").innerHTML =
      "";

    board.innerHTML = "";

    updateBulkDistributionSummary(false);

    return;
  }


  if (
    Number(risk.gross_received || 0) <= 0
  ) {
    riskSummary.innerHTML =
      `<div class="risk-notice">
        ${escapeHtml(
          risk.line_group_name
          || lineGroupId
        )}
        ยังไม่มีออเดอร์สำหรับคำนวณ
      </div>`;

    $("#warehouseChoices").innerHTML =
      "";

    board.innerHTML = "";

    updateBulkDistributionSummary(false);

    return;
  }


  const operationalRequired =
    lineGroupAllocationRequired(
      lineGroupId
    );

  const operationalRiskTone =
    (
      risk.risk_status === "DATA_INTEGRITY_ERROR"
      || Number(
        risk.over_cut_code_count || 0
      ) > 0
    )
      ? "integrity"
      : risk.calculation_status === "WAITING_FIRST_BAND"
        ? "waiting"
        : operationalRequired > 0
          ? "required"
          : "safe";

  const operationalRiskLabel =
    operationalRiskTone === "integrity"
      ? "ต้องตรวจสอบ"
      : operationalRiskTone === "waiting"
        ? "รอครบ Band แรก"
        : operationalRiskTone === "required"
          ? "ต้องตัดยอด"
          : "อยู่ในเกณฑ์";

  riskSummary.innerHTML = `
    <section class="line-group-risk-hero ${operationalRiskTone}">
      <header class="risk-hero-header">
        <div>
          <span class="risk-hero-kicker">
            LINE GROUP
          </span>

          <strong>
            ${escapeHtml(
              risk.line_group_name
              || lineGroupId
            )}
          </strong>

          <small>
            ${escapeHtml(lineGroupId)}
          </small>
        </div>

        <span class="risk-state-badge ${operationalRiskTone}">
          ${escapeHtml(
            operationalRiskLabel
          )}
        </span>
      </header>

      <div class="risk-hero-grid">
        <div>
          <span>ยอดรับ</span>
          <strong>
            ${formatNumber(
              risk.gross_received || 0
            )}
          </strong>
        </div>

        <div>
          <span>Calculation Band</span>
          <strong>
            ${formatNumber(
              risk.calculation_band || 0
            )}
          </strong>
        </div>

        <div>
          <span>Risk Budget</span>
          <strong>
            ${formatNumber(
              risk.risk_budget || 0
            )}
          </strong>
          <small>
            ลดยอด ${formatNumber(
              risk.reduction_pct || 0
            )}%
          </small>
        </div>

        <div class="risk-hero-required">
          <span>ต้องตัดเพิ่ม</span>
          <strong>
            ${formatNumber(
              risk.recommended_cut_total
              || operationalRequired
              || 0
            )}
          </strong>
        </div>

        <div>
          <span>ตัดแล้ว</span>
          <strong>
            ${formatNumber(
              risk.confirmed_cut_total || 0
            )}
          </strong>
        </div>

        <div>
          <span>คงเหลือ</span>
          <strong>
            ${formatNumber(
              risk.retained_total || 0
            )}
          </strong>
        </div>
      </div>

      <div class="risk-pool-heading">
        สถานะตามกลุ่มความเสี่ยง
      </div>

      <section class="pool-status-strip">
        ${
          ["MAIN", "H", "L"]
            .map(
              (pool) =>
                renderLineGroupPoolStatus(
                  lineGroupId,
                  pool
                )
            )
            .join("")
        }
      </section>
    </section>
  `;


  renderWarehouseChoices(
    warehouses
  );


  const mainHasOrders =
    ["A", "B", "E", "F", "G"]
      .some(
        (category) =>
          lineGroupCodeRowsFor(
            lineGroupId,
            category
          ).some(
            (row) =>
              Number(
                row.order_total || 0
              ) > 0
          )
      );


  const gRows =
    lineGroupCodeRowsFor(
      lineGroupId,
      "G"
    );


  const gRecommendations =
    lineGroupRecommendationMapFor(
      lineGroupId,
      "MAIN"
    );


  const mainBoard =
    mainHasOrders
      ? `
        <div class="allocation-pool-section">

          <div class="allocation-pool-heading">
            <strong>หมวดหลัก</strong>
            <span>คำนวณความเสี่ยงแยกตาม LINE Group</span>
          </div>

          <div class="four-column-board">
            ${
              ["A", "B", "E", "F"]
                .map(
                  (category) =>
                    renderLineGroupAllocationCategoryColumn(
                      lineGroupId,
                      category,
                      "MAIN"
                    )
                )
                .join("")
            }
          </div>

          ${
            gRows.length
              ? `
                <div class="g-board allocation-g-board">

                  <div class="category-heading">
                    <h3>หมวด G</h3>

                    <span>
                      Point ×${formatNumber(
                        profileFor("G")
                          ?.special_multiplier || 0
                      )}
                    </span>
                  </div>

                  <div class="g-code-grid">

                    ${
                      gRows.map((row) => {
                        const retained =
                          Number(
                            row.retained_quantity || 0
                          );

                        const limit =
                          Number(
                            row.retention_limit || 0
                          );

                        const rec =
                          gRecommendations.get(
                            `G|${row.code}`
                          );


                        const recommended =
                          Math.min(
                            Math.max(
                              0,
                              retained - limit
                            ),
                            Number(
                              rec?.recommended_transfer
                              || 0
                            )
                          );


                        return `
                          <label class="g-code allocation-g-code ${
                            recommended > 0
                              ? "recommended"
                              : ""
                          }">

                            ${
                              recommended > 0
                                ? `<input
                                    class="allocation-code-select"
                                    type="checkbox"
                                    checked
                                    data-line-group="${escapeHtml(lineGroupId)}"
                                    data-pool="MAIN"
                                    data-category="G"
                                    data-code="${escapeHtml(row.code)}"
                                  />`
                                : `<span></span>`
                            }

                            <strong>
                              G${escapeHtml(row.code)}
                            </strong>

                            <span>
                              รับ ${formatNumber(
                                row.order_total
                              )}
                              · คง ${formatNumber(retained)}
                              · ลิมิต ${formatNumber(limit)}
                            </span>

                            ${
                              recommended > 0
                                ? `<em>ตัด ${formatNumber(recommended)}</em>`
                                : ""
                            }

                          </label>
                        `;
                      }).join("")
                    }

                  </div>
                </div>
              `
              : ""
          }

        </div>
      `
      : "";


  const hlHasOrders =
    ["H", "L"].some(
      (category) =>
        lineGroupCodeRowsFor(
          lineGroupId,
          category
        ).some(
          (row) =>
            Number(
              row.order_total || 0
            ) > 0
        )
    );


  const hlBoard =
    hlHasOrders
      ? `
        <div class="allocation-pool-section one-digit-allocation-section">

          <div class="allocation-pool-heading">
            <strong>วิ่ง</strong>
            <span>แยกตาม LINE Group</span>
          </div>

          <div class="one-digit-board">
            ${
              ["H", "L"]
                .map(
                  (category) =>
                    renderLineGroupOneDigitCategory(
                      lineGroupId,
                      category
                    )
                )
                .join("")
            }
          </div>

        </div>
      `
      : "";


  board.innerHTML =
    `<section class="summary-group-board allocation-summary-board">
      ${mainBoard}
      ${hlBoard}
    </section>`;


  const blockReason =
    lineGroupAllocationBlockReason(
      lineGroupId
    );


  if (blockReason) {
    const message = {
      DATA_INTEGRITY_ERROR:
        "พบข้อมูลตัดยอดไม่สอดคล้อง · ระบบปิดการตัดเพิ่มจนกว่าจะตรวจสอบ",

      LINE_GROUP_DISABLED:
        "LINE Group นี้ถูกปิดใช้งาน",

      UNCONFIGURED:
        "ยังตั้งค่าตัวคูณ Point ไม่ครบ",

      NOT_READY:
        "สถานะ Risk ยังไม่พร้อมสำหรับการตัดยอด",

      RISK_MODEL_NOT_READY:
        "LINE Group นี้ยังไม่ได้ใช้โมเดล Category Retention",

      LINE_GROUP_NOT_READY:
        "ยังไม่มีข้อมูล LINE Group",
    }[blockReason] || blockReason;


    board.insertAdjacentHTML(
      "afterbegin",
      `<div class="risk-notice">
        ${escapeHtml(message)}
      </div>`
    );

  } else if (
    risk.calculation_status
      === "WAITING_FIRST_BAND"
  ) {
    board.insertAdjacentHTML(
      "afterbegin",
      `<div class="risk-notice">
        ยังไม่ถึง 100,000 แรก
        · รออีก ${formatNumber(
          risk.amount_to_next_band || 0
        )}
        ก่อนเริ่มคำนวณ Risk
      </div>`
    );

  } else if (
    lineGroupAllocationRequired(
      lineGroupId
    ) <= 0
  ) {
    board.insertAdjacentHTML(
      "afterbegin",
      `<div class="risk-notice">
        ยังไม่ต้องตัดยอด
      </div>`
    );
  }


  $$(".allocation-code-select")
    .forEach(
      (input) =>
        input.addEventListener(
          "change",
          () =>
            updateBulkDistributionSummary(
              true
            )
        )
    );


  updateBulkDistributionSummary(false);
}


async function runBulkDistribution() {
  if (state.dashboardStale) {
    return toast(
      "ข้อมูลเปลี่ยน กรุณาอัปเดต",
      true
    );
  }


  const groupId =
    summaryGroupSelect.value;

  const lineGroupId =
    allocationLineGroupSelect?.value || "";


  if (
    !groupId
    || groupId === "ALL"
  ) {
    return toast(
      "กรุณาเลือกกลุ่มสรุป",
      true
    );
  }


  if (!lineGroupId) {
    return toast(
      "กรุณาเลือก LINE Group",
      true
    );
  }


  const risk =
    allocationLineGroupRiskFor(
      lineGroupId
    );


  if (!risk) {
    return toast(
      "ไม่พบข้อมูล Risk ของ LINE Group",
      true
    );
  }


  if (
    risk.summary_group_id !== groupId
  ) {
    setDashboardStale(true);

    return toast(
      "ข้อมูล LINE Group เปลี่ยน กรุณาอัปเดต",
      true
    );
  }


  const blockReason =
    lineGroupAllocationBlockReason(
      lineGroupId
    );


  if (blockReason) {
    const friendly = {
      DATA_INTEGRITY_ERROR:
        "พบข้อมูลตัดยอดไม่สอดคล้อง",

      LINE_GROUP_DISABLED:
        "LINE Group ถูกปิดใช้งาน",

      UNCONFIGURED:
        "ยังตั้งค่าตัวคูณ Point ไม่ครบ",

      NOT_READY:
        "สถานะ Risk ยังไม่พร้อม",

      RISK_MODEL_NOT_READY:
        "LINE Group ยังไม่ได้ใช้ Category Retention",

      LINE_GROUP_NOT_READY:
        "ยังไม่มีข้อมูล LINE Group",
    }[blockReason] || blockReason;


    return toast(
      `ยังตัดยอดไม่ได้: ${friendly}`,
      true
    );
  }


  if (
    risk.calculation_status
      === "WAITING_FIRST_BAND"
  ) {
    return toast(
      "ยังไม่ถึง 100,000 แรก จึงยังไม่ต้องตัดยอด",
      true
    );
  }


  const required =
    lineGroupAllocationRequired(
      lineGroupId
    );


  if (required <= 0) {
    return toast(
      "ยังไม่ต้องตัดเพิ่ม",
      true
    );
  }


  const selectedCodes =
    selectedRecommendedCodes();

  const destinations =
    selectedWarehouseNames();


  if (!selectedCodes.length) {
    return toast(
      "กรุณาเลือกรหัสที่ต้องการตัด",
      true
    );
  }


  if (!destinations.length) {
    return toast(
      "กรุณาเลือกคลังปลายทาง",
      true
    );
  }


  // Every selected checkbox rendered by the LINE Group
  // allocation board must carry the exact same LINE Group.
  if (
    selectedCodes.some(
      (item) =>
        !item.line_group_id
        || item.line_group_id !== lineGroupId
    )
  ) {
    setDashboardStale(true);

    return toast(
      "รายการที่เลือกไม่ตรงกับ LINE Group กรุณาอัปเดต",
      true
    );
  }


  const byPool =
    new Map();


  for (const item of selectedCodes) {
    const riskPool =
      item.risk_pool || "MAIN";


    if (
      !["MAIN", "H", "L"].includes(
        riskPool
      )
    ) {
      return toast(
        "ชุดความเสี่ยงไม่ถูกต้อง",
        true
      );
    }


    if (!byPool.has(riskPool)) {
      byPool.set(
        riskPool,
        []
      );
    }


    byPool.get(riskPool).push({
      category:
        item.category,

      code:
        item.code,
    });
  }


  const button =
    $("#runBulkDistributionButton");

  button.disabled = true;

  button.textContent =
    "กำลังจัดแผน...";


  try {
    const previews = [];


    for (
      const [riskPool, codes]
      of byPool.entries()
    ) {
      const preview =
        await api(
          "/api/risk-distribution-preview",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                line_group_id:
                  lineGroupId,

                summary_group_id:
                  groupId,

                risk_pool:
                  riskPool,

                destinations,

                selected_codes:
                  codes,
              }),
          }
        );


      // A LINE Group request must never silently fall back
      // to the legacy Summary Group confirmation contract.
      if (
        preview.preview_mode
        !== "LINE_GROUP_CATEGORY_RETENTION"
      ) {
        throw new Error(
          "LINE_GROUP_PREVIEW_REQUIRED"
        );
      }


      if (
        preview.confirmation_token_version
        !== "v3"
      ) {
        throw new Error(
          "LINE_GROUP_CONFIRMATION_TOKEN_REQUIRED"
        );
      }


      if (!preview.confirmation_token) {
        throw new Error(
          "CONFIRMATION_TOKEN_MISSING"
        );
      }


      // Validate identity when the preview response exposes
      // these fields. The signed token remains authoritative.
      if (
        preview.line_group_id
        && preview.line_group_id
          !== lineGroupId
      ) {
        throw new Error(
          "LINE_GROUP_PREVIEW_MISMATCH"
        );
      }


      if (
        preview.summary_group_id
        && preview.summary_group_id
          !== groupId
      ) {
        throw new Error(
          "SUMMARY_GROUP_PREVIEW_MISMATCH"
        );
      }


      if (
        preview.risk_pool
        && preview.risk_pool
          !== riskPool
      ) {
        throw new Error(
          "RISK_POOL_PREVIEW_MISMATCH"
        );
      }


      previews.push(
        preview
      );
    }


    state.bulkDistributionPreview =
      previews;


    const totalQty =
      previews.reduce(
        (sum, preview) =>
          sum
          + Number(
            preview.planned_quantity || 0
          ),
        0
      );


    const totalRounds =
      previews.reduce(
        (sum, preview) =>
          sum
          + Number(
            preview.planned_rounds || 0
          ),
        0
      );


    const totalCodes =
      previews.reduce(
        (sum, preview) =>
          sum
          + Number(
            preview.selected_code_count || 0
          ),
        0
      );


    const lineGroupName =
      risk.line_group_name
      || lineGroupId;


    const poolLines =
      previews.map(
        (preview) =>
          `${riskPoolLabel(
            preview.risk_pool
          )} `
          + `${formatNumber(
            preview.planned_quantity || 0
          )}`
          + ` · ${formatNumber(
            preview.planned_rounds || 0
          )} รอบ`
      ).join("\n");


    $("#transferPreview").innerHTML = `
      <div class="preview-box ok transfer-confirm-card">

        <div class="preview-heading">

          <strong>
            พร้อมตัดยอด
          </strong>

          <span>
            ${escapeHtml(lineGroupName)}
          </span>

        </div>

        <div class="confirm-totals">

          <div>
            <span>ยอดตัด</span>
            <strong>
              ${formatNumber(totalQty)}
            </strong>
          </div>

          <div>
            <span>รอบ</span>
            <strong>
              ${formatNumber(totalRounds)}
            </strong>
          </div>

          <div>
            <span>รหัส</span>
            <strong>
              ${formatNumber(totalCodes)}
            </strong>
          </div>

        </div>

        <div class="preview-policy-note">
          Risk Band ${formatNumber(
            risk.calculation_band || 0
          )}
          · Risk Budget ${formatNumber(
            risk.risk_budget || 0
          )}
          · คำนวณเฉพาะ LINE Group นี้
        </div>

      </div>
    `;


    const confirmed =
      window.confirm(
        `ยืนยันตัดยอด?\n\n`
        + `${lineGroupName}\n`
        + `รวม ${formatNumber(
          totalQty
        )} หน่วย`
        + ` · ${formatNumber(
          totalRounds
        )} รอบ\n\n`
        + poolLines
      );


    if (!confirmed) {
      return;
    }


    button.textContent =
      "กำลังยืนยันทุกรอบ...";


    let confirmedQty = 0;


    // Confirmation intentionally sends ONLY the signed token.
    // The server derives line group, summary group, risk
    // snapshot and rounds from the verified v3 token.
    for (const preview of previews) {
      const payload =
        await api(
          "/api/risk-distribution-confirm",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                confirmation_token:
                  preview.confirmation_token,
              }),
          }
        );


      confirmedQty +=
        Number(
          payload.run
            ?.confirmed_quantity || 0
        );
    }


    toast(
      `ตัดยอดสำเร็จ ${formatNumber(
        confirmedQty
      )}`
    );


    clearTransferPreview();

    await loadDashboard();

    await loadAllocationHistory();

  } catch (error) {
    const staleErrors =
      new Set([
        "RISK_STATE_STALE",
        "CONFIRMATION_EXPIRED",
        "TRANSFER_EXCEEDS_CODE_AVAILABLE",
        "DESTINATION_LIMIT_NOT_CONFIGURED",
        "RETENTION_RECOMMENDATION_MISMATCH",
        "POST_CONFIRM_RETENTION_MISMATCH",
        "LINE_GROUP_NOT_IN_SETTLEMENT",
        "LINE_GROUP_DISABLED",
        "INVALID_RISK_SNAPSHOT",
        "INVALID_TRANSFER_ITEM",
        "LINE_GROUP_MISMATCH",
        "INCONSISTENT_TRANSFER_SNAPSHOT",
        "DUPLICATE_TRANSFER_ITEM",
        "LINE_GROUP_PREVIEW_MISMATCH",
        "SUMMARY_GROUP_PREVIEW_MISMATCH",
        "RISK_POOL_PREVIEW_MISMATCH",
      ]);


    if (
      staleErrors.has(
        error.message
      )
    ) {
      setDashboardStale(true);

      toast(
        "ข้อมูลเปลี่ยน กรุณาตรวจใหม่",
        true
      );

    } else {
      const friendly = {
        NO_RISK_DISTRIBUTION_REQUIRED:
          "ยังไม่ต้องตัดเพิ่ม",

        NO_SELECTED_DISTRIBUTION_TARGETS:
          "รหัสที่เลือกไม่มีส่วนเกินตามแผนปัจจุบัน",

        WAREHOUSE_SELECTION_REQUIRED:
          "กรุณาเลือกคลังปลายทาง",

        POINT_MULTIPLIER_NOT_CONFIGURED:
          "กรุณาตั้งตัวคูณ Point ก่อน",

        DATA_INTEGRITY_ERROR:
          "ข้อมูลตัดยอดไม่สอดคล้อง กรุณาตรวจสอบก่อน",

        CONFIRMATION_REQUEST_ID_COLLISION:
          "คำขอยืนยันซ้ำไม่ตรงกับแผนเดิม",

        LINE_GROUP_PREVIEW_REQUIRED:
          "ระบบ Preview ยังไม่ได้ใช้ LINE Group model",

        LINE_GROUP_CONFIRMATION_TOKEN_REQUIRED:
          "ระบบไม่ได้รับ Confirmation Token v3",

        CONFIRMATION_TOKEN_MISSING:
          "ไม่พบ Confirmation Token",
      }[error.message]
        || error.message;


      toast(
        `ตัดยอดไม่สำเร็จ: ${friendly}`,
        true
      );
    }

  } finally {
    button.textContent =
      "ตัดยอดที่เลือก";


    // Re-evaluate using the latest visible LINE Group state.
    updateBulkDistributionSummary(
      false
    );
  }
}

function allocationHistoryLineGroupLabel(item) {
  const lineGroupId =
    item.line_group_id
    || (
      item.items || []
    ).find(
      (row) => row.line_group_id
    )?.line_group_id
    || "";

  if (!lineGroupId) {
    return "ข้อมูลเดิม";
  }

  return (
    allocationLineGroupRiskFor(
      lineGroupId
    )?.line_group_name
    || lineGroupId
  );
}


function allocationHistoryItemsHtml(item) {
  const rows =
    Array.isArray(item.items)
      ? item.items
      : [];

  if (!rows.length) {
    return `
      <div class="transfer-lines">
        ${
          (item.lines || [])
            .map(
              (line) =>
                `<div>${escapeHtml(line)}</div>`
            )
            .join("")
        }
      </div>
    `;
  }

  return `
    <div class="history-code-list">
      ${
        rows.map((row) => `
          <div class="history-code-row">
            <div class="history-code-main">
              <strong>
                ${escapeHtml(row.category)}${escapeHtml(row.code)}
              </strong>

              <span>
                ${formatNumber(row.quantity)}
              </span>
            </div>

            <div class="history-code-meta">
              <span>
                คงก่อน ${formatNumber(
                  row.retained_before || 0
                )}
              </span>

              ${
                row.retention_limit == null
                  ? ""
                  : `
                    <span>
                      Limit ${formatNumber(
                        row.retention_limit
                      )}
                    </span>
                  `
              }

              <span>
                ×${formatNumber(
                  row.effective_multiplier || 0
                )}
              </span>
            </div>
          </div>
        `).join("")
      }
    </div>
  `;
}


async function loadAllocationHistory(
  { silent = false } = {}
) {
  const root =
    $("#allocationHistoryList");

  if (root && !silent) {
    root.innerHTML =
      `<div class="empty compact">กำลังโหลด...</div>`;
  }

  try {
    const group =
      summaryGroupSelect.value || "ALL";

    const payload =
      await api(
        `/api/allocation-history?group=${encodeURIComponent(group)}`
      );

    state.allocationHistory=payload.history||[];

    renderAfterCut();

    if (!root) return;

    if (!state.allocationHistory.length) {
      root.innerHTML =
        `<div class="empty compact">
          ยังไม่มีรายการตัดยอดในชุดปัจจุบัน
        </div>`;
      return;
    }

    root.innerHTML =
      state.allocationHistory
        .map((item) => {
          const lineGroupLabel =
            allocationHistoryLineGroupLabel(
              item
            );

          const riskModelLabel =
            item.risk_model
              === "CATEGORY_RETENTION"
              ? "LINE Group Retention"
              : item.risk_model
                ? item.risk_model
                : "Legacy";

          return `
            <article class="history-card operational-history-card">
              <div class="history-head">
                <div class="history-head-main">
                  <strong>
                    ${escapeHtml(
                      item.destination
                    )}
                  </strong>

                  <span class="history-batch">
                    รอบ #${formatNumber(
                      item.batch_number
                    )}
                  </span>
                </div>

                <span>
                  ${escapeHtml(
                    formatBangkokTime(
                      item.confirmed_at
                    )
                  )}
                </span>
              </div>

              <div class="history-attribution">
                <span class="history-line-group">
                  ${escapeHtml(
                    lineGroupLabel
                  )}
                </span>

                <span class="history-model">
                  ${escapeHtml(
                    riskModelLabel
                  )}
                </span>
              </div>

              ${allocationHistoryItemsHtml(item)}

              <div class="history-meta">
                <span>
                  ตัด
                  <strong>
                    ${formatNumber(
                      item.cut_total
                    )}
                  </strong>
                </span>

                <span>
                  ลิมิตคลัง
                  ${formatNumber(
                    item.warehouse_batch_limit || 0
                  )}
                </span>

                <span>
                  ${escapeHtml(
                    item.confirmed_by || "-"
                  )}
                </span>
              </div>
            </article>
          `;
        })
        .join("");
  } catch (error) {
    if (root && !silent) {
      root.innerHTML =
        `<div class="empty compact">
          โหลดประวัติไม่สำเร็จ
        </div>`;
    }

    if (!silent) {
      toast(
        "โหลดประวัติไม่สำเร็จ",
        true
      );
    } else {
      console.warn(
        "silent allocation history refresh failed",
        error
      );
    }
  }
}

function reviewReasonsHtml(item) {
  return (item.reason_codes || []).map((reason) => `
    <div><strong>${escapeHtml(reason.code)}</strong>${reason.detail ? ` — ${escapeHtml(reason.detail)}` : ""}</div>
  `).join("") || "ต้องตรวจสอบ";
}

function reviewImageEvidenceHtml(item) {
  if (!item.image_evidence_url) {
    return "";
  }

  const url =
    escapeHtml(item.image_evidence_url);

  return `
    <div class="review-evidence">
      <div class="review-evidence-heading">
        ภาพต้นฉบับ
      </div>
      <a
        class="review-evidence-link"
        href="${url}"
        target="_blank"
        rel="noopener noreferrer"
        title="เปิดภาพต้นฉบับขนาดเต็ม"
      >
        <img
          class="review-evidence-image"
          src="${url}"
          alt="ภาพต้นฉบับ Review #${escapeHtml(item.id)}"
          loading="lazy"
        >
      </a>
      <div class="muted small-text">
        คลิกภาพเพื่อเปิดขนาดเต็ม
      </div>
    </div>`;
}

function previewItemsHtml(preview) {
  const statusClass = preview.can_apply ? "ok" : "warn";
  const previewItems = preview.items || [];
  const itemCount = previewItems.length;
  const totalQuantity = previewItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
  const totalLabel =
    preview.status === "PARSED"
      ? "ยอดรวม"
      : "ยอดที่อ่านได้";
  const errors = (preview.errors || []).map((x) => `<div>${escapeHtml(x.code)}${x.detail ? ` — ${escapeHtml(x.detail)}` : ""}</div>`).join("");
  const items = previewItems.map((x) => `<span class="item-chip">${escapeHtml(x.category)}${escapeHtml(x.code)} = ${formatNumber(x.quantity)}</span>`).join("");
  return `
    <div class="preview-box ${statusClass}">
      <div class="preview-heading">ผลตรวจ <strong>${escapeHtml(preview.status)}</strong> <span class="muted">· Parser ${escapeHtml(preview.parser_version || "ไม่ระบุ")}</span></div>
      <div class="review-preview-summary">
        <strong>${formatNumber(itemCount)} รายการ</strong>
        <span>· ${escapeHtml(totalLabel)} <strong>${formatNumber(totalQuantity)}</strong></span>
      </div>
      ${items ? `<div class="item-chips">${items}</div>` : ""}
      ${errors ? `<div class="preview-errors">${errors}</div>` : ""}
      ${preview.can_apply ? `<button class="button primary small apply-review">ยืนยันใช้ผลนี้</button>` : `<div class="muted small-text">ยังยืนยันไม่ได้ กรุณาแก้ข้อความแล้วตรวจอีกครั้ง</div>`}
    </div>`;
}

function clearReviewPreview(card, message = "") {
  card._reviewPreview = null;
  const previewArea = card.querySelector(".review-preview");
  if (message) {
    previewArea.innerHTML = `<div class="preview-box warn">${escapeHtml(message)}</div>`;
  } else {
    previewArea.innerHTML = "";
  }
}

// ============================================================
// R2D2B-2 Review Workbench Claim Integration
// ============================================================

function reviewWorkbenchQuery() {
  const params =
    new URLSearchParams(
      selectedQuery(),
    );

  params.set(
    "limit",
    "200",
  );

  params.set(
    "offset",
    "0",
  );

  return params.toString();
}

function reviewClaimFields(
  workItem,
) {
  if (!workItem) {
    return {
      message_record_id: null,
      claim_state: "UNAVAILABLE",
      claimed_by_staff_id: null,
      claimed_by_staff_code: null,
      claimed_by_display_name: null,
      claimed_at: null,
      claim_expires_at: null,
      lease_version: null,
    };
  }

  return {
    message_record_id:
      workItem.message_record_id
      ?? null,

    claim_state:
      workItem.claim_state
      ?? "AVAILABLE",

    claimed_by_staff_id:
      workItem.claimed_by_staff_id
      ?? null,

    claimed_by_staff_code:
      workItem.claimed_by_staff_code
      ?? null,

    claimed_by_display_name:
      workItem.claimed_by_display_name
      ?? null,

    claimed_at:
      workItem.claimed_at
      ?? null,

    claim_expires_at:
      workItem.claim_expires_at
      ?? null,

    lease_version:
      workItem.lease_version
      ?? null,
  };
}

function reviewClaimStatusHtml(
  item,
  actor,
) {
  if (!actor?.staff_id) {
    return "";
  }

  const claimState =
    item?.claim_state
    ?? "UNAVAILABLE";

  if (claimState === "MINE") {
    return `
      <div class="reason">
        <strong>
          คุณกำลังดำเนินการรายการนี้
        </strong>

        ${
          item.claim_expires_at
            ? `<span class="muted">
                · สิทธิ์ถึง
                ${escapeHtml(
                  formatBangkokTime(
                    item.claim_expires_at,
                  ),
                )}
              </span>`
            : ""
        }

        <span class="review-claim-actions">
          <button
            type="button"
            class="button ghost small renew-review-work"
          >
            ต่อเวลา
          </button>

          <button
            type="button"
            class="button ghost small release-review-work"
          >
            คืนรายการ
          </button>
        </span>
      </div>
    `;
  }

  if (
    claimState === "AVAILABLE"
    || claimState === "EXPIRED"
  ) {
    return `
      <div class="reason">
        <strong>
          รายการพร้อมรับดำเนินการ
        </strong>

        <span class="review-claim-actions">
          <button
            type="button"
            class="button primary small claim-review-work"
          >
            รับรายการ
          </button>
        </span>
      </div>
    `;
  }

  if (
    claimState
    === "CLAIMED_BY_OTHER"
  ) {
    const holder =
      item.claimed_by_display_name
      || item.claimed_by_staff_code
      || "เจ้าหน้าที่อื่น";

    return `
      <div class="reason">
        <strong>
          กำลังดำเนินการโดย
          ${escapeHtml(holder)}
        </strong>

        ${
          item.claim_expires_at
            ? `<span class="muted">
                · ถึง
                ${escapeHtml(
                  formatBangkokTime(
                    item.claim_expires_at,
                  ),
                )}
              </span>`
            : ""
        }
      </div>
    `;
  }

  return `
    <div class="reason">
      <strong>
        รายการนี้ไม่อยู่ใน Workbench ปัจจุบัน
      </strong>
    </div>
  `;
}

function reviewCardCanMutate(
  card,
  {
    notify = true,
  } = {},
) {
  const actor =
    card?._workbenchActor;

  // Shared/Admin legacy path remains compatible.
  if (!actor?.staff_id) {
    return true;
  }

  if (
    card?._reviewItem
      ?.claim_state
    === "MINE"
  ) {
    return true;
  }

  if (notify) {
    if (
      card?._reviewItem
        ?.claim_state
      === "CLAIMED_BY_OTHER"
    ) {
      toast(
        "รายการนี้กำลังดำเนินการโดยเจ้าหน้าที่อื่น",
        true,
      );
    } else {
      toast(
        "กรุณารับรายการก่อนดำเนินการ",
        true,
      );
    }
  }

  return false;
}

function bindReviewClaimButtons(
  card,
) {
  card
    .querySelector(
      ".claim-review-work",
    )
    ?.addEventListener(
      "click",
      () =>
        mutateReviewClaim(
          card,
          "CLAIM",
        ),
    );

  card
    .querySelector(
      ".renew-review-work",
    )
    ?.addEventListener(
      "click",
      () =>
        mutateReviewClaim(
          card,
          "CLAIM",
        ),
    );

  card
    .querySelector(
      ".release-review-work",
    )
    ?.addEventListener(
      "click",
      () =>
        mutateReviewClaim(
          card,
          "RELEASE",
        ),
    );
}

function syncReviewCardClaimUi(
  card,
) {
  if (!card) return;

  const actor =
    card._workbenchActor;

  const item =
    card._reviewItem;

  const root =
    card.querySelector(
      ".review-claim-state",
    );

  if (root) {
    root.innerHTML =
      reviewClaimStatusHtml(
        item,
        actor,
      );
  }

  if (item?.message_record_id) {
    card.dataset.messageRecordId =
      item.message_record_id;
  } else {
    delete card.dataset.messageRecordId;
  }

  if (item?.lease_version) {
    card.dataset.leaseVersion =
      String(
        item.lease_version,
      );
  } else {
    delete card.dataset.leaseVersion;
  }

  const requiresClaim =
    Boolean(
      actor?.staff_id,
    );

  const ownsClaim =
    item?.claim_state
    === "MINE";

  const locked =
    requiresClaim
    && !ownsClaim;

  const editor =
    card.querySelector(
      ".review-editor",
    );

  const preview =
    card.querySelector(
      ".preview-review",
    );

  const ignore =
    card.querySelector(
      ".ignore-review",
    );

  if (editor) {
    editor.disabled = locked;
  }

  if (preview) {
    preview.disabled = locked;
  }

  if (ignore) {
    ignore.disabled = locked;
  }

  bindReviewClaimButtons(
    card,
  );
}

function applyFreshClaimStateToReviewCard(
  card,
  workItem,
  actor,
) {
  if (!card) return;

  card._workbenchActor =
    actor
    ?? card._workbenchActor
    ?? null;

  card._reviewItem = {
    ...(card._reviewItem || {}),
    ...reviewClaimFields(
      workItem,
    ),
  };

  syncReviewCardClaimUi(
    card,
  );
}

async function refreshReviewClaimState(
  card,
) {
  if (!card) return;

  const reviewId =
    String(
      card.dataset.reviewId
      || "",
    );

  const payload =
    await api(
      `/api/staff-workbench?${reviewWorkbenchQuery()}`,
    );

  const fresh =
    (payload.work_items || [])
      .find(
        (item) =>
          String(item.review_id)
          === reviewId,
      );

  if (!fresh) {
    card._workbenchActor =
      payload.actor
      ?? card._workbenchActor
      ?? null;

    card._reviewItem = {
      ...(card._reviewItem || {}),
      ...reviewClaimFields(
        null,
      ),
    };

    syncReviewCardClaimUi(
      card,
    );

    return;
  }

  applyFreshClaimStateToReviewCard(
    card,
    fresh,
    payload.actor,
  );
}

async function mutateReviewClaim(
  card,
  action,
) {
  const item =
    card?._reviewItem;

  const actor =
    card?._workbenchActor;

  if (
    !card
    || !actor?.staff_id
  ) {
    return;
  }

  const messageRecordId =
    item?.message_record_id;

  if (!messageRecordId) {
    toast(
      "ไม่พบรหัสข้อความสำหรับรับรายการ",
      true,
    );
    return;
  }

  const buttons = [
    ...card.querySelectorAll(
      ".review-claim-actions button",
    ),
  ];

  buttons.forEach(
    (button) => {
      button.disabled = true;
    },
  );

  try {
    const body = {
      action,
      message_record_id:
        messageRecordId,
    };

    if (action === "CLAIM") {
      body.lease_seconds = 300;
    } else if (
      item?.lease_version
    ) {
      body.lease_version =
        item.lease_version;
    }

    const payload =
      await api(
        "/api/staff-work-claim",
        {
          method: "POST",
          body:
            JSON.stringify(
              body,
            ),
        },
      );

    const claim =
      payload.claim || {};

    if (action === "CLAIM") {
      card._reviewItem = {
        ...item,

        claim_state:
          "MINE",

        claimed_by_staff_id:
          actor.staff_id,

        claimed_by_staff_code:
          actor.staff_code
          ?? null,

        claimed_by_display_name:
          actor.display_name
          ?? null,

        claimed_at:
          claim.claimed_at
          ?? item.claimed_at
          ?? null,

        claim_expires_at:
          claim.claim_expires_at
          ?? null,

        lease_version:
          claim.lease_version
          ?? null,
      };

      syncReviewCardClaimUi(
        card,
      );

      toast(
        claim.status === "RENEWED"
          ? "ต่อเวลารายการแล้ว"
          : "รับรายการแล้ว",
      );
    } else {
      card._reviewItem = {
        ...item,
        ...reviewClaimFields({
          message_record_id:
            messageRecordId,
          claim_state:
            "AVAILABLE",
        }),
      };

      syncReviewCardClaimUi(
        card,
      );

      toast(
        "คืนรายการแล้ว",
      );
    }
  } catch (error) {
    try {
      await refreshReviewClaimState(
        card,
      );
    } catch (
      refreshError
    ) {
      console.warn(
        "refresh review claim state failed",
        refreshError,
      );
    }

    toast(
      `${
        action === "CLAIM"
          ? "รับ/ต่อเวลารายการ"
          : "คืนรายการ"
      } ไม่สำเร็จ: ${
        error.message
      }`,
      true,
    );
  } finally {
    if (card.isConnected) {
      syncReviewCardClaimUi(
        card,
      );
    }
  }
}

async function releaseReviewClaimAfterCompletion(
  card,
) {
  if (
    !card?._workbenchActor
      ?.staff_id
    || card?._reviewItem
      ?.claim_state !== "MINE"
    || !card?._reviewItem
      ?.message_record_id
  ) {
    return;
  }

  try {
    await api(
      "/api/staff-work-claim",
      {
        method: "POST",
        body:
          JSON.stringify({
            action:
              "RELEASE",

            message_record_id:
              card._reviewItem
                .message_record_id,

            lease_version:
              card._reviewItem
                .lease_version
              ?? undefined,
          }),
      },
    );
  } catch (error) {
    // Review resolution already succeeded.
    // Claim cleanup is best-effort.
    console.warn(
      "release completed review claim failed",
      error,
    );
  }
}


function onReviewEditorInput(event) {
  const card = event.currentTarget.closest(".review-card");
  if (!card._reviewPreview) return;
  clearReviewPreview(card, "ข้อความถูกแก้หลังจากตรวจผลแล้ว กรุณากด “ตรวจผล” ใหม่ก่อนยืนยัน");
}

async function previewReview(event) {
  const card = event.currentTarget.closest(".review-card");

  if (!reviewCardCanMutate(card)) {
    return;
  }
  const reviewId = Number(card.dataset.reviewId);
  const correctedText = card.querySelector(".review-editor").value;
  const previewArea = card.querySelector(".review-preview");
  clearReviewPreview(card);
  event.currentTarget.disabled = true;
  previewArea.innerHTML = `<div class="empty compact">กำลังตรวจ...</div>`;
  try {
    const payload = await api("/api/review-preview", {
      method: "POST",
      body: JSON.stringify({ review_id: reviewId, corrected_text: correctedText }),
    });
    previewArea.innerHTML = previewItemsHtml(payload.preview);
    if (payload.preview?.can_apply && payload.preview_token) {
      card._reviewPreview = {
        correctedText,
        token: payload.preview_token,
        fingerprint: payload.preview_fingerprint,
        expiresAt: payload.preview_expires_at,
      };
    }
    const apply = previewArea.querySelector(".apply-review");
    if (apply) apply.addEventListener("click", () => applyReview(card));
  } catch (error) {
    clearReviewPreview(card, `ตรวจไม่สำเร็จ: ${error.message}`);
  } finally {
    event.currentTarget.disabled = false;
  }
}

function removeCompletedReviewCard(card) {
  const list = $("#reviewList");

  void releaseReviewClaimAfterCompletion(card);

  card.remove();

  if (
    list &&
    !list.querySelector(".review-card")
  ) {
    list.innerHTML =
      `<div class="empty">ไม่มีรายการ Review ที่เปิดอยู่</div>`;
  }
}

async function applyReview(card) {
  if (!reviewCardCanMutate(card)) {
    return;
  }

  const reviewId = Number(card.dataset.reviewId);
  const correctedText = card.querySelector(".review-editor").value;
  const preview = card._reviewPreview;
  if (!preview || preview.correctedText !== correctedText) {
    clearReviewPreview(card, "ผลตรวจไม่ตรงกับข้อความปัจจุบัน กรุณาตรวจผลใหม่");
    toast("กรุณาตรวจผลใหม่ก่อนยืนยัน", true);
    return;
  }
  if (!window.confirm("ยืนยันใช้ผลที่ตรวจแล้วแทนข้อมูลเดิม?")) return;
  const buttons = [...card.querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const payload = await api("/api/review-resolve", {
      method: "POST",
      body: JSON.stringify({
        review_id: reviewId,
        action: "CORRECT",
        corrected_text: correctedText,
        preview_token: preview.token,
      }),
    });
    card._reviewPreview = null;
    toast(`แก้ Review สำเร็จ ${formatNumber(payload.items?.length)} รายการ`);
    removeCompletedReviewCard(card);

    await loadDashboard({
      silent: true,
      preserveReviewWorkbench: true,
    });
  } catch (error) {
    if (["PREVIEW_REQUIRED", "PREVIEW_EXPIRED", "PREVIEW_STALE", "PREVIEW_TOKEN_INVALID"].includes(error.message)) {
      clearReviewPreview(card, "ข้อมูลเปลี่ยนแล้ว กรุณาตรวจผลใหม่ก่อนยืนยัน");
    }
    toast(`แก้ Review ไม่สำเร็จ: ${error.message}`, true);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function ignoreReview(event) {
  const card = event.currentTarget.closest(".review-card");

  if (!reviewCardCanMutate(card)) {
    return;
  }
  const reviewId = Number(card.dataset.reviewId);
  if (!window.confirm("ยืนยันว่าข้อความนี้ไม่ใช่ออเดอร์และให้ข้าม? ถ้ามีรายการ PARTIAL ที่เคยสร้างไว้ ระบบจะถอนรายการของข้อความนี้ออก")) return;
  event.currentTarget.disabled = true;
  try {
    await api("/api/review-resolve", {
      method: "POST",
      body: JSON.stringify({ review_id: reviewId, action: "IGNORE" }),
    });
    toast("ข้าม Review แล้ว");
    removeCompletedReviewCard(card);

    await loadDashboard({
      silent: true,
      preserveReviewWorkbench: true,
    });
  } catch (error) {
    toast(`ข้าม Review ไม่สำเร็จ: ${error.message}`, true);
  } finally {
    event.currentTarget.disabled = false;
  }
}

async function loadReviews() {
  const list = $("#reviewList");

  list.innerHTML =
    `<div class="empty">กำลังโหลด...</div>`;

  try {
    const [
      reviewPayload,
      workbenchPayload,
    ] = await Promise.all([
      api(
        `/api/reviews?${selectedQuery()}`,
      ),

      api(
        `/api/staff-workbench?${reviewWorkbenchQuery()}`,
      ),
    ]);

    const workByReviewId =
      new Map(
        (
          workbenchPayload.work_items
          || []
        ).map(
          (item) => [
            String(
              item.review_id,
            ),
            item,
          ],
        ),
      );

    const realStaff =
      Boolean(
        workbenchPayload.actor
          ?.staff_id,
      );

    let items =
      (
        reviewPayload.items
        || []
      ).map(
        (item) => ({
          ...item,

          ...reviewClaimFields(
            workByReviewId.get(
              String(item.id),
            ),
          ),
        }),
      );

    // Real Staff sees only assignment + current-round
    // Workbench scope.
    //
    // Legacy/shared Admin keeps the previous Review
    // visibility for compatibility.
    if (realStaff) {
      items =
        items.filter(
          (item) =>
            workByReviewId.has(
              String(item.id),
            ),
        );
    }

    if (!items.length) {
      list.innerHTML =
        `<div class="empty">ไม่มีรายการ Review ที่เปิดอยู่</div>`;

      return;
    }

    list.innerHTML =
      items
        .map(
          (item) => `
        <article
          class="review-card"
          data-review-id="${escapeHtml(item.id)}"
        >
          <div class="review-meta">
            <span>
              <strong>
                Review #${escapeHtml(item.id)}
              </strong>
            </span>

            <span>
              ${escapeHtml(
                item.parse_status
                || "ไม่ระบุสถานะ",
              )}
            </span>

            <span>Parser เดิม ${escapeHtml(item.parser_version || "ไม่ระบุ")}</span>

            <span>
              ${escapeHtml(
                item.line_group_name,
              )}
            </span>

            <span>
              ${escapeHtml(
                item.message_type,
              )}
            </span>

            <span>
              ${escapeHtml(
                formatBangkokTime(
                  item.created_at,
                ),
              )}
            </span>

            <span>
              ${escapeHtml(
                item.user_id
                || "ไม่ทราบผู้ส่ง",
              )}
            </span>
          </div>

          <div class="review-claim-state"></div>

          ${reviewImageEvidenceHtml(item)}

          <div class="reason">
            ${reviewReasonsHtml(item)}
          </div>

          <label class="editor-label">
            ข้อความสำหรับ Parse

            <textarea
              class="review-editor"
              rows="5"
              placeholder="แก้หรือกรอกข้อความออเดอร์ที่ถูกต้อง"
            >${escapeHtml(item.text || "")}</textarea>
          </label>

          <div class="review-actions">
            <button
              class="button primary small preview-review"
            >
              ตรวจผล
            </button>

            <button
              class="button ghost small ignore-review"
            >
              ไม่ใช่ออเดอร์ / ข้าม
            </button>
          </div>

          <div class="review-preview"></div>
        </article>
      `,
        )
        .join("");

    const itemById =
      new Map(
        items.map(
          (item) => [
            String(item.id),
            item,
          ],
        ),
      );

    list
      .querySelectorAll(
        ".review-card",
      )
      .forEach(
        (card) => {
          card._reviewItem =
            itemById.get(
              String(
                card.dataset.reviewId,
              ),
            );

          card._workbenchActor =
            workbenchPayload.actor
            ?? null;

          syncReviewCardClaimUi(
            card,
          );
        },
      );

    $$(".preview-review")
      .forEach(
        (button) =>
          button.addEventListener(
            "click",
            previewReview,
          ),
      );

    $$(".ignore-review")
      .forEach(
        (button) =>
          button.addEventListener(
            "click",
            ignoreReview,
          ),
      );

    $$(".review-editor")
      .forEach(
        (editor) =>
          editor.addEventListener(
            "input",
            onReviewEditorInput,
          ),
      );
  } catch (error) {
    list.innerHTML =
      `<div class="empty">โหลด Review ไม่สำเร็จ</div>`;

    toast(
      error.message,
      true,
    );
  }
}


async function loadUnsends() {
  const body = $("#unsendBody");
  body.innerHTML = `<tr><td colspan="5" class="empty">กำลังโหลด...</td></tr>`;
  try {
    const payload = await api(`/api/unsends?${selectedQuery()}`);
    $("#unsendBadge").textContent = formatNumber(payload.items.length);
    if (!payload.items.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">ไม่มี Unsend ในชุดยอดปัจจุบัน</td></tr>`;
      return;
    }
    body.innerHTML = payload.items.map((item) => `
      <tr>
        <td>${escapeHtml(formatBangkokTime(item.unsent_at))}</td>
        <td>${escapeHtml(item.line_group_name)}</td>
        <td>${escapeHtml(item.user_id || "-")}</td>
        <td class="num">${formatNumber(item.derived_qty_total)}</td>
        <td>${escapeHtml(item.message_id)}</td>
      </tr>`).join("");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5" class="empty">โหลด Unsend ไม่สำเร็จ</td></tr>`;
    toast(error.message, true);
  }
}

function setSummaryOptions(select, selected = "") {
  const groups = state.settings?.summary_groups || state.dashboard?.summary_groups || [];
  select.innerHTML = groups.map((g) => `<option value="${escapeHtml(g.id)}" ${g.id === selected ? "selected" : ""}>${escapeHtml(g.name)} (${escapeHtml(g.id)})</option>`).join("");
}

function renderSettings() {
  const s = state.settings;
  if (!s) return;

  const unconfigured = s.unconfigured_line_groups || [];
  $("#unconfiguredGroups").innerHTML = unconfigured.length ? `
    <h3>พบ LINE Group ที่ยังไม่ตั้งค่า</h3>
    <p class="muted">กดเพิ่มเพื่อเติม Group ID ลงฟอร์ม แล้วตั้งชื่อและกลุ่มสรุป</p>
    <div class="item-chips">${unconfigured.map((g) => `<button class="chip-button use-unconfigured" data-id="${escapeHtml(g.line_group_id)}">${escapeHtml(g.line_group_id)} · ${escapeHtml(formatBangkokTime(g.last_seen_at))}</button>`).join("")}</div>
  ` : `<div class="muted">ไม่พบ LINE Group ที่ยังไม่ได้ตั้งค่า</div>`;

  $$(".use-unconfigured").forEach((button) => button.addEventListener("click", () => {
    const form = $("#lineGroupForm"); form.elements.line_group_id.value = button.dataset.id; form.elements.line_group_name.focus();
  }));

  setSummaryOptions($("#lineGroupForm").elements.summary_group_id);
  setSummaryOptions($("#riskBudgetForm").elements.summary_group_id);

  $("#summaryGroupsList").innerHTML = s.summary_groups.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-summary" data-id="${escapeHtml(row.id)}">แก้ไข</button></div>`).join("");

  $("#lineGroupsList").innerHTML = s.line_groups.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.line_group_name)}</strong><small>${escapeHtml(row.line_group_id)}</small></span><span>${escapeHtml(groupName(row.summary_group_id))} · ลด ${formatNumber(row.reduction_pct || 0)}% · ${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-line" data-id="${escapeHtml(row.line_group_id)}">แก้ไข</button></div>`).join("");

  $("#pointProfilesList").innerHTML = (s.point_profiles || []).map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.category)} ${Number(row.special_multiplier)>0?`×${formatNumber(row.special_multiplier)}`:"ยังไม่ตั้งตัวคูณ"}</strong><small>Point พิเศษสูงสุด ${formatNumber(row.max_special_codes)} รหัส</small></span><span></span><button class="button ghost small edit-profile" data-id="${escapeHtml(row.category)}">แก้ไข</button></div>`).join("");

  $("#riskBudgetList").innerHTML = (s.risk_budgets || []).map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(groupName(row.summary_group_id))} · ${escapeHtml(riskPoolLabel(row.risk_pool || "MAIN"))}</strong><small>ยอมขาดทุน ${formatNumber(row.point_loss_tolerance)} Point</small></span><span></span><button class="button ghost small edit-risk-budget" data-group="${escapeHtml(row.summary_group_id)}" data-pool="${escapeHtml(row.risk_pool || "MAIN")}">แก้ไข</button></div>`).join("");

  $("#warehouseLimitList").innerHTML = (s.warehouse_limits || []).map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.destination)}</strong><small>สูงสุด ${formatNumber(row.max_batch_quantity)} ต่อรอบ</small></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-warehouse-limit" data-id="${escapeHtml(row.destination)}">แก้ไข</button></div>`).join("");

  $("#aliasesList").innerHTML = s.category_aliases.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.alias)} → ${escapeHtml(aliasTargetLabel(row.canonical_category))}</strong></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-alias" data-id="${escapeHtml(row.alias)}">แก้ไข</button></div>`).join("");

  $$(".edit-summary").forEach((button) => button.addEventListener("click", () => {
    const row = s.summary_groups.find((x) => x.id === button.dataset.id); const form = $("#summaryGroupForm");
    form.elements.id.value = row.id; form.elements.name.value = row.name; form.elements.enabled.checked = row.enabled;
  }));
  $$(".edit-line").forEach((button) => button.addEventListener("click", () => {
    const row = s.line_groups.find((x) => x.line_group_id === button.dataset.id); const form = $("#lineGroupForm");
    form.elements.line_group_id.value = row.line_group_id; form.elements.line_group_name.value = row.line_group_name; setSummaryOptions(form.elements.summary_group_id, row.summary_group_id); form.elements.reduction_pct.value = row.reduction_pct || 0; form.elements.enabled.checked = row.enabled;
  }));
  $$(".edit-profile").forEach((button)=>button.addEventListener("click",()=>{
    const row=(s.point_profiles||[]).find((x)=>x.category===button.dataset.id);const form=$("#pointProfileForm");
    form.elements.category.value=row.category;form.elements.special_multiplier.value=row.special_multiplier;form.elements.max_special_codes.value=row.max_special_codes;syncPointProfileFormSlots(form);
  }));
  $$(".edit-risk-budget").forEach((button)=>button.addEventListener("click",()=>{
    const row=(s.risk_budgets||[]).find((x)=>x.summary_group_id===button.dataset.group&&(x.risk_pool||"MAIN")===button.dataset.pool);const form=$("#riskBudgetForm");
    setSummaryOptions(form.elements.summary_group_id,row.summary_group_id);form.elements.risk_pool.value=row.risk_pool||"MAIN";form.elements.point_loss_tolerance.value=row.point_loss_tolerance;
  }));
  $$(".edit-warehouse-limit").forEach((button)=>button.addEventListener("click",()=>{
    const row=(s.warehouse_limits||[]).find((x)=>x.destination===button.dataset.id);const form=$("#warehouseLimitForm");
    form.elements.destination.value=row.destination;form.elements.max_batch_quantity.value=row.max_batch_quantity;form.elements.enabled.checked=row.enabled;
  }));
  $$(".edit-alias").forEach((button) => button.addEventListener("click", () => {
    const row = s.category_aliases.find((x) => x.alias === button.dataset.id); const form = $("#aliasForm");
    form.elements.alias.value = row.alias; form.elements.canonical_category.value = row.canonical_category; form.elements.enabled.checked = row.enabled;
  }));
}

async function loadSettings() {
  $("#reloadSettingsButton").disabled = true;
  try {
    const payload = await api("/api/settings");
    state.settings = payload.settings;
    renderSettings();
  } catch (error) {
    toast(`โหลด Settings ไม่สำเร็จ: ${error.message}`, true);
  } finally {
    $("#reloadSettingsButton").disabled = false;
  }
}

async function saveSetting(entity, values, form) {
  try {
    await api("/api/settings", { method: "POST", body: JSON.stringify({ entity, values }) });
    toast("บันทึกการตั้งค่าแล้ว");
    form.reset();
    const checkbox = form.querySelector('input[type="checkbox"][name="enabled"]');
    if (checkbox) checkbox.checked = true;
    await loadSettings();
    state.groupsLoaded = false;
    summaryGroupSelect.innerHTML = `<option value="ALL">ทุกกลุ่ม</option>`;
    await loadDashboard();
  } catch (error) {
    toast(`บันทึกไม่สำเร็จ: ${error.message}`, true);
  }
}

function syncPointProfileFormSlots(form = $("#pointProfileForm")) {
  if (!form) return;
  const category = String(form.elements.category.value || "").toUpperCase();
  const input = form.elements.max_special_codes;
  if (category === "H") {
    input.value = 3;
    input.readOnly = true;
    input.title = "H ใช้ Point พิเศษ 3 รหัส";
  } else if (category === "L") {
    input.value = 2;
    input.readOnly = true;
    input.title = "L ใช้ Point พิเศษ 2 รหัส";
  } else {
    input.readOnly = false;
    input.title = "";
  }
}

function bindSettingForms() {
  $("#summaryGroupForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("SUMMARY_GROUP", { id: f.elements.id.value, name: f.elements.name.value, enabled: f.elements.enabled.checked }, f);
  });
  $("#lineGroupForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("LINE_GROUP", { line_group_id: f.elements.line_group_id.value, line_group_name: f.elements.line_group_name.value, summary_group_id: f.elements.summary_group_id.value, reduction_pct: Number(f.elements.reduction_pct.value || 0), enabled: f.elements.enabled.checked }, f);
  });
  $("#pointProfileForm").elements.category.addEventListener("change", (event) => syncPointProfileFormSlots(event.currentTarget.form));
  syncPointProfileFormSlots();
  $("#pointProfileForm").addEventListener("submit", (event)=>{
    event.preventDefault();const f=event.currentTarget;
    saveSetting("POINT_PROFILE",{category:f.elements.category.value,special_multiplier:Number(f.elements.special_multiplier.value),max_special_codes:Number(f.elements.max_special_codes.value)},f);
  });
  $("#riskBudgetForm").addEventListener("submit", (event)=>{
    event.preventDefault();const f=event.currentTarget;
    saveSetting("RISK_BUDGET",{summary_group_id:f.elements.summary_group_id.value,risk_pool:f.elements.risk_pool.value,point_loss_tolerance:Number(f.elements.point_loss_tolerance.value)},f);
  });
  $("#warehouseLimitForm").addEventListener("submit", (event)=>{
    event.preventDefault();const f=event.currentTarget;
    saveSetting("WAREHOUSE_LIMIT",{destination:f.elements.destination.value,max_batch_quantity:Number(f.elements.max_batch_quantity.value),enabled:f.elements.enabled.checked},f);
  });
  $("#aliasForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("CATEGORY_ALIAS", { alias: f.elements.alias.value, canonical_category: f.elements.canonical_category.value, enabled: f.elements.enabled.checked }, f);
  });
  $("#reloadSettingsButton").addEventListener("click", loadSettings);
}


function todayBangkok() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function renderProfileStrip(target, profiles = []) {
  const root=$(target); if(!root)return;
  root.innerHTML=(profiles||[]).map((p)=>`<span class="profile-chip"><strong>${escapeHtml(p.category)} ×${formatNumber(p.special_multiplier)}</strong><small>${escapeHtml(p.category)==="F"?`สูงสุด ${formatNumber(p.max_special_codes)} รหัส`:escapeHtml(p.category)==="G"?`${formatNumber(p.max_special_codes)} รหัส`:`${formatNumber(p.max_special_codes)} รหัส`}</small></span>`).join("");
}

function promotionSummaryGroups(
  payload = state.settlement,
) {
  const sessionGroups =
    Array.isArray(payload?.summary_group_states)
    && payload.summary_group_states.length
      ? payload.summary_group_states.map(
          (item) => ({
            id: String(
              item.summary_group_id || "",
            ),
            name:
              groupName(
                String(
                  item.summary_group_id || "",
                ),
              ),
          }),
        )
      : [];

  const source =
    sessionGroups.length
      ? sessionGroups
      : (
          state.dashboard?.summary_groups
          || state.settings?.summary_groups
          || []
        );

  const seen = new Set();

  return source
    .map((item) => ({
      id: String(
        item.id
        || item.summary_group_id
        || "",
      ),
      name:
        item.name
        || groupName(
          String(
            item.id
            || item.summary_group_id
            || "",
          ),
        ),
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) {
        return false;
      }

      seen.add(item.id);
      return true;
    });
}


function promotionGroupOptions(
  groups,
  selected = "",
) {
  return [
    `<option value="">เลือกกลุ่มสรุป</option>`,
    ...groups.map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${
          item.id === selected
            ? "selected"
            : ""
        }>${escapeHtml(
          item.name || item.id,
        )}</option>`,
    ),
  ].join("");
}


function syncPromotionDraftGroupSelect() {
  const select =
    $("#promotionDraftForm")
      ?.elements
      ?.summary_group_id;

  if (!select) return;

  const current = select.value;

  select.innerHTML =
    promotionGroupOptions(
      promotionSummaryGroups(),
      current,
    );
}


function renderPromotionDrafts() {
  const list = $("#promotionDraftList");

  renderProfileStrip(
    "#openingPointProfiles",
    state.settlement?.company_point_profiles
      || state.settlement?.point_profiles
      || [],
  );

  syncPromotionDraftGroupSelect();

  if (!state.promotionDrafts.length) {
    list.innerHTML =
      `<div class="muted">ไม่มี Promotion — ถ้ารหัสใดถูก Point พิเศษ จะใช้ตัวคูณเต็มของหมวด</div>`;
    return;
  }

  const profileMap =
    new Map(
      (
        state.settlement?.company_point_profiles
        || state.settlement?.point_profiles
        || []
      ).map(
        (p) => [
          p.category,
          Number(p.special_multiplier),
        ],
      ),
    );

  list.innerHTML =
    state.promotionDrafts
      .map((r, i) => {
        const effective =
          (profileMap.get(r.category) || 0)
          * Number(
            r.point_factor_pct || 0,
          )
          / 100;

        return `
          <div class="settings-row">
            <span>
              <strong>
                ${escapeHtml(
                  groupName(
                    r.summary_group_id,
                  ),
                )}
                · ${escapeHtml(r.category)}${escapeHtml(r.code)}
                · ${formatNumber(r.point_factor_pct)}% ของ Point
              </strong>
              <small>
                ถ้าได้ Point พิเศษ →
                ×${formatNumber(effective)}
              </small>
            </span>
            <span></span>
            <button
              class="button ghost small remove-promo"
              data-i="${i}"
              type="button"
            >
              ลบ
            </button>
          </div>
        `;
      })
      .join("");

  $$(".remove-promo").forEach(
    (button) =>
      button.addEventListener(
        "click",
        () => {
          state.promotionDrafts.splice(
            Number(button.dataset.i),
            1,
          );

          renderPromotionDrafts();
        },
      ),
  );
}


function renderSettlementPromotionControls(
  payload,
) {
  const root =
    $("#settlementPromotionControls");

  if (!root) return;

  const open =
    payload?.open_session;

  if (!open?.id) {
    root.innerHTML = "";
    root.classList.add("hidden");
    return;
  }

  const groups =
    promotionSummaryGroups(payload);

  const promotions =
    Array.isArray(payload?.promotions)
      ? [...payload.promotions]
      : [];

  promotions.sort(
    (a, b) =>
      String(a.summary_group_id || "")
        .localeCompare(
          String(b.summary_group_id || ""),
        )
      || String(a.category || "")
        .localeCompare(
          String(b.category || ""),
        )
      || String(a.code || "")
        .localeCompare(
          String(b.code || ""),
        ),
  );

  root.classList.remove("hidden");

  root.innerHTML = `
    <div class="settlement-promotion-head">
      <div>
        <strong>Promotion รายกลุ่ม</strong>
        <span>
          ใช้เฉพาะกลุ่มสรุปที่กำหนด
          และมีผลกับยอดทั้งหมดในรอบนี้
        </span>
      </div>
      <small>
        ${formatNumber(promotions.length)} รายการ
      </small>
    </div>

    <form
      id="livePromotionForm"
      class="compact-form inline-form"
    >
      <select
        name="summary_group_id"
        required
      >
        ${promotionGroupOptions(groups)}
      </select>

      <select name="category">
        <option>A</option>
        <option>B</option>
        <option>E</option>
        <option>F</option>
        <option>G</option>
        <option>H</option>
        <option>L</option>
      </select>

      <input
        name="code"
        placeholder="รหัส เช่น 01 / 125"
        required
      />

      <input
        name="point_factor_pct"
        type="number"
        min="0"
        max="100"
        step="0.1"
        placeholder="% Point เช่น 50"
        required
      />

      <button
        class="button primary small"
        type="submit"
      >
        บันทึก Promotion
      </button>
    </form>

    <div class="settings-list live-promotion-list">
      ${
        promotions.length
          ? promotions
              .map(
                (item) => `
                  <div class="settings-row">
                    <span>
                      <strong>
                        ${escapeHtml(
                          groupName(
                            item.summary_group_id,
                          ),
                        )}
                        · ${escapeHtml(item.category)}
                        ${escapeHtml(item.code)}
                        · ${formatNumber(
                          item.point_factor_pct,
                        )}% ของ Point
                      </strong>
                      <small>
                        ${escapeHtml(
                          item.summary_group_id,
                        )}
                      </small>
                    </span>

                    <button
                      type="button"
                      class="button ghost small edit-live-promotion"
                      data-summary-group-id="${escapeHtml(
                        item.summary_group_id,
                      )}"
                      data-category="${escapeHtml(
                        item.category,
                      )}"
                      data-code="${escapeHtml(
                        item.code,
                      )}"
                      data-factor="${escapeHtml(
                        item.point_factor_pct,
                      )}"
                    >
                      แก้ไข
                    </button>

                    <button
                      type="button"
                      class="button ghost small delete-live-promotion"
                      data-summary-group-id="${escapeHtml(
                        item.summary_group_id,
                      )}"
                      data-category="${escapeHtml(
                        item.category,
                      )}"
                      data-code="${escapeHtml(
                        item.code,
                      )}"
                    >
                      ลบ
                    </button>
                  </div>
                `,
              )
              .join("")
          : `<div class="muted">
              ยังไม่มี Promotion ในรอบนี้
            </div>`
      }
    </div>
  `;

  $("#livePromotionForm")
    ?.addEventListener(
      "submit",
      saveLivePromotion,
    );

  $$(".edit-live-promotion")
    .forEach(
      (button) =>
        button.addEventListener(
          "click",
          () =>
            editLivePromotion(button),
        ),
    );

  $$(".delete-live-promotion")
    .forEach(
      (button) =>
        button.addEventListener(
          "click",
          () =>
            deleteLivePromotion(button),
        ),
    );
}


function editLivePromotion(button) {
  const form =
    $("#livePromotionForm");

  if (!form) return;

  form.elements.summary_group_id.value =
    button.dataset.summaryGroupId || "";

  form.elements.category.value =
    button.dataset.category || "A";

  form.elements.code.value =
    button.dataset.code || "";

  form.elements.point_factor_pct.value =
    button.dataset.factor || "";

  form.elements.code.focus();
}


async function refreshAfterPromotionChange(
  settlementSessionId,
) {
  await loadDashboard({
    silent: true,
    preserveReviewWorkbench: true,
  });

  const reportSelect =
    $("#reportSessionSelect");

  if (
    reportSelect
    && reportSelect.value ===
      settlementSessionId
  ) {
    await loadReport({
      silent: true,
    });
  }
}


async function saveLivePromotion(event) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const open =
    state.settlement?.open_session;

  if (!open?.id) {
    return toast(
      "ยังไม่ได้เปิดยอด",
      true,
    );
  }

  const summaryGroupId =
    String(
      form.elements.summary_group_id.value
      || "",
    );

  const category =
    String(
      form.elements.category.value
      || "",
    );

  const code =
    String(
      form.elements.code.value
      || "",
    ).trim();

  const factor =
    Number(
      form.elements.point_factor_pct.value,
    );

  const expectedLength =
    categoryCodeLength(category);

  if (!summaryGroupId) {
    return toast(
      "กรุณาเลือกกลุ่มสรุป",
      true,
    );
  }

  if (
    !new RegExp(
      `^\\d{${expectedLength}}$`,
    ).test(code)
  ) {
    return toast(
      `รหัส ${category} ต้องเป็น ${expectedLength} หลัก`,
      true,
    );
  }

  if (
    !Number.isFinite(factor)
    || factor < 0
    || factor > 100
  ) {
    return toast(
      "Promotion ต้องอยู่ระหว่าง 0–100%",
      true,
    );
  }

  const submit =
    form.querySelector(
      'button[type="submit"]',
    );

  submit.disabled = true;

  try {
    await api(
      "/api/settlement",
      {
        method: "POST",
        body: JSON.stringify({
          action: "SET_PROMOTION",
          settlement_session_id:
            open.id,
          summary_group_id:
            summaryGroupId,
          category,
          code,
          point_factor_pct:
            factor,
        }),
      },
    );

    form.elements.code.value = "";
    form.elements.point_factor_pct.value =
      "";

    await refreshAfterPromotionChange(
      open.id,
    );

    toast(
      `บันทึก Promotion ${
        groupName(summaryGroupId)
      } ${category}${code} แล้ว`,
    );
  } catch (error) {
    toast(
      `บันทึก Promotion ไม่สำเร็จ: ${
        error.message
      }`,
      true,
    );
  } finally {
    submit.disabled = false;
  }
}


async function deleteLivePromotion(
  button,
) {
  const open =
    state.settlement?.open_session;

  if (!open?.id) return;

  const summaryGroupId =
    button.dataset.summaryGroupId || "";

  const category =
    button.dataset.category || "";

  const code =
    button.dataset.code || "";

  if (
    !window.confirm(
      `ลบ Promotion ${
        groupName(summaryGroupId)
      } ${category}${code}?\n`
      + `Point และ Risk ของยอดทั้งหมดในกลุ่มนี้`
      + `จะถูกคำนวณใหม่`,
    )
  ) {
    return;
  }

  button.disabled = true;

  try {
    await api(
      "/api/settlement",
      {
        method: "POST",
        body: JSON.stringify({
          action: "DELETE_PROMOTION",
          settlement_session_id:
            open.id,
          summary_group_id:
            summaryGroupId,
          category,
          code,
        }),
      },
    );

    await refreshAfterPromotionChange(
      open.id,
    );

    toast(
      `ลบ Promotion ${
        groupName(summaryGroupId)
      } ${category}${code} แล้ว`,
    );
  } catch (error) {
    toast(
      `ลบ Promotion ไม่สำเร็จ: ${
        error.message
      }`,
      true,
    );
  } finally {
    button.disabled = false;
  }
}

function renderSettlementGroupControls(payload) {
  const root = $("#settlementGroupControls");
  if (!root) return;

  const open = payload?.open_session;
  const groups = Array.isArray(
    payload?.summary_group_states,
  )
    ? payload.summary_group_states
    : [];

  if (!open) {
    root.innerHTML = "";
    root.classList.add("hidden");
    return;
  }

  root.classList.remove("hidden");

  if (!groups.length) {
    root.innerHTML = `
      <div class="settlement-group-controls-head">
        <div>
          <strong>การรับยอดรายกลุ่ม</strong>
          <span>ไม่พบกลุ่มสรุปในยอดนี้</span>
        </div>
      </div>
    `;
    return;
  }

  const acceptingCount =
    groups.filter(
      (item) =>
        item.accepting_orders !== false,
    ).length;

  root.innerHTML = `
    <div class="settlement-group-controls-head">
      <div>
        <strong>การรับยอดรายกลุ่ม</strong>
        <span>
          เปิดรับ ${formatNumber(acceptingCount)}
          / ${formatNumber(groups.length)} กลุ่ม
        </span>
      </div>
      <small>
        ปิดเฉพาะกลุ่มได้ โดยไม่ปิดยอดทั้งหมด
      </small>
    </div>

    <div class="settlement-group-control-list">
      ${groups.map((item) => {
        const accepting =
          item.accepting_orders === true;

        const hasPreviousRound =
          item.has_previous_round === true;

        const roundNo =
          Number(item.round_no || 0);

        const id =
          String(
            item.summary_group_id || "",
          );

        const label =
          groupName(id) || id;

        const stateText =
          accepting
            ? `เปิดรับยอด · รอบ ${formatNumber(roundNo)}`
            : hasPreviousRound
              ? `ปิดรับยอด · รอบ ${formatNumber(roundNo)}`
              : "ยังไม่เปิดรอบ";

        const changedText =
          !accepting
          && hasPreviousRound
          && item.closed_at
            ? ` · ปิด ${formatBangkokTime(
                item.closed_at,
              )}`
            : "";

        return `
          <div class="settlement-group-control-row">
            <div class="settlement-group-control-name">
              <strong>${escapeHtml(label)}</strong>
              <small>${escapeHtml(id)}</small>
            </div>

            <span
              class="settlement-group-state ${
                accepting ? "open" : "closed"
              }"
            >
              ${stateText}${escapeHtml(changedText)}
            </span>

            <button
              type="button"
              class="button ${
                accepting ? "ghost" : "primary"
              } small settlement-group-toggle"
              data-summary-group-id="${escapeHtml(id)}"
              data-accepting="${
                accepting ? "true" : "false"
              }"
              data-has-previous-round="${
                hasPreviousRound ? "true" : "false"
              }"
            >
              ${
                accepting
                  ? "ปิดรับยอด"
                  : hasPreviousRound
                    ? "เปิดรอบใหม่"
                    : "เปิดรอบแรก"
              }
            </button>
          </div>
        `;
      }).join("")}
    </div>
  `;

  $$(".settlement-group-toggle")
    .forEach(
      (button) =>
        button.addEventListener(
          "click",
          () =>
            changeSettlementSummaryGroup(
              button,
            ),
        ),
    );
}


async function changeSettlementSummaryGroup(
  button,
) {
  const open =
    state.settlement?.open_session;

  if (!open?.id) {
    return toast(
      "ยังไม่ได้เปิดยอด",
      true,
    );
  }

  const summaryGroupId =
    String(
      button.dataset.summaryGroupId
      || "",
    );

  if (!summaryGroupId) {
    return;
  }

  const currentlyAccepting =
    button.dataset.accepting === "true";

  const nextAccepting =
    !currentlyAccepting;

  const hasPreviousRound =
    button.dataset.hasPreviousRound === "true";

  const label =
    groupName(summaryGroupId)
    || summaryGroupId;

  if (
    currentlyAccepting
    && !window.confirm(
      `ปิดรับยอด ${label}?\n`
      + `ข้อความใหม่ของกลุ่มนี้จะไม่เข้ายอด `
      + `และจะถูกส่งไปหน้าตรวจรายการ`,
    )
  ) {
    return;
  }

  if (
    !currentlyAccepting
    && hasPreviousRound
    && !window.confirm(
      `เปิดรอบใหม่ ${label}?\n`
      + `ระบบจะเก็บสรุปรอบก่อนหน้า แล้วล้างข้อมูลปฏิบัติการ`
      + `ของกลุ่มนี้ก่อนเริ่มนับใหม่จาก 0\n`
      + `กลุ่มอื่นจะไม่ถูกกระทบ`,
    )
  ) {
    return;
  }

  if (
    !currentlyAccepting
    && !hasPreviousRound
    && !window.confirm(
      `เปิดรอบแรก ${label}?\n`
      + `ระบบจะเริ่มนับยอดของกลุ่มนี้จาก 0\n`
      + `กลุ่มอื่นจะยังไม่เปิดจนกว่าจะสั่งเปิดแยก`,
    )
  ) {
    return;
  }

  button.disabled = true;

  try {
    await api(
      "/api/settlement",
      {
        method: "POST",
        body: JSON.stringify({
          action:
            nextAccepting
              ? "OPEN_GROUP"
              : "CLOSE_GROUP",

          settlement_session_id:
            open.id,

          summary_group_id:
            summaryGroupId,
        }),
      },
    );

    await loadSettlement();

    toast(
      nextAccepting
        ? `เปิดรับยอด ${label} แล้ว`
        : `ปิดรับยอด ${label} แล้ว`,
    );
  } catch (error) {
    toast(
      `${
        nextAccepting
          ? "เปิด"
          : "ปิด"
      }รับยอดไม่สำเร็จ: ${
        error.message
      }`,
      true,
    );
  } finally {
    button.disabled = false;
  }
}


function renderSettlementStatus(payload) {
  state.settlement=payload;
  renderSettlementGroupControls(payload);
  renderSettlementPromotionControls(payload);
  const open=payload.open_session;
  $("#prepareOpenButton").classList.toggle("hidden",Boolean(open));
  $("#closeSettlementButton").classList.toggle("hidden",!open);
  if(open){
    businessDateInput.value=open.business_date;businessDateInput.disabled=true;
    $("#settlementStatus").textContent=`เปิดยอดอยู่ · ${open.business_date}`;
    $("#settlementMeta").textContent=`เริ่ม ${formatBangkokTime(open.opened_at)} · Promotion ${formatNumber((payload.promotions||[]).length)} รายการ · ${payload.actual_point_status?.actual_codes_ready?"Point ครบ":"Point ยังไม่ครบ"}`;
    $("#openSettlementEditor").classList.add("hidden");
  }else{
    businessDateInput.disabled=false;if(!businessDateInput.value)businessDateInput.value=todayBangkok();
    $("#settlementStatus").textContent="ยังไม่ได้เปิดยอด";
    $("#settlementMeta").textContent="กำหนด Promotion (% ของ Point พิเศษ) ก่อนเปิดยอด แล้วระบบเริ่มนับใหม่จาก 0 แม้เป็นวันที่เดิม";
  }
}

async function loadSettlement() {
  const payload=await api("/api/settlement");renderSettlementStatus(payload);
  const select=$("#reportSessionSelect");const previousSessionId=select.value;const sessions=[payload.open_session,...(payload.closed_sessions||[])].filter(Boolean);
  select.innerHTML=sessions.map(s=>`<option value="${escapeHtml(s.id)}">${s.status==="OPEN"?"ยอดปัจจุบัน":"ปิด "+formatBangkokTime(s.closed_at)} · ${escapeHtml(s.business_date)}</option>`).join("")||`<option value="">ยังไม่มีรายงาน</option>`;

  const reportSessionId=
    previousSessionId && sessions.some(s=>s.id===previousSessionId)
      ? previousSessionId
      : payload.open_session?.id || payload.closed_sessions?.[0]?.id || "";

  if(reportSessionId)select.value=reportSessionId;
  const lineSelect=$("#reportLineGroupSelect");const lines=state.dashboard?.line_groups||[];
  lineSelect.innerHTML=`<option value="ALL">ทุก LINE Group</option>`+lines.map(g=>`<option value="${escapeHtml(g.line_group_id)}">${escapeHtml(g.line_group_name)}</option>`).join("");
  renderProfileStrip("#openingPointProfiles",payload.company_point_profiles||payload.point_profiles||[]);
  return payload;
}

function focusCurrentSettlement() {
  const panel = $("#settlementPanel");
  if (!panel) return;
  panel.classList.remove("settlement-attention");
  // Force a reflow so repeated conflict recovery replays the highlight.
  void panel.offsetWidth;
  panel.classList.add("settlement-attention");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => panel.classList.remove("settlement-attention"), 1800);
}

async function recoverAlreadyOpenSettlement(error = null) {
  try {
    await loadSettlement();
    await loadDashboard();
  } catch (reloadError) {
    console.warn("failed to refresh current settlement after open conflict", reloadError);
  }
  const open = state.settlement?.open_session || error?.payload?.current_open_session || null;
  const dateText = open?.business_date ? ` (${open.business_date})` : "";
  toast(`มียอดเปิดอยู่${dateText}`, true);
  focusCurrentSettlement();
}

async function openSettlement() {
  if (state.settlement?.open_session) {
    await recoverAlreadyOpenSettlement();
    return;
  }
  const date=businessDateInput.value||todayBangkok();
  if(!window.confirm(`เปิดยอดใหม่วันที่ ${date}?\nยอดทั้งหมดจะเริ่มนับใหม่จาก 0`))return;
  $("#openSettlementButton").disabled=true;
  try{
    await api("/api/settlement",{
      method:"POST",
      body:JSON.stringify({
        action:"OPEN",
        business_date:date,
        promotions:state.promotionDrafts
      })
    });

    state.promotionDrafts=[];
    renderPromotionDrafts();
    toast("เปิดยอดแล้ว");

    await loadSettlement();

    // A newly opened settlement becomes the current operational context.
    // Keep Dashboard and Report on the same session immediately after OPEN.
    const openSession=state.settlement?.open_session;
    const reportSelect=$("#reportSessionSelect");

    if(openSession && reportSelect){
      reportSelect.value=openSession.id;
    }

    await loadDashboard();

    if(openSession){
      await loadReport({silent:true});
    }
  }
  catch(error){if(error.message==="SETTLEMENT_ALREADY_OPEN")await recoverAlreadyOpenSettlement(error);else toast(`เปิดยอดไม่สำเร็จ: ${error.payload?.user_message||error.message}`,true);}finally{$("#openSettlementButton").disabled=false;}
}

async function closeSettlement() {
  const open=state.settlement?.open_session;if(!open)return;
  const reviewCount=Number(state.dashboard?.metrics?.review_open||0);
  const reviewNote=reviewCount>0
    ? `\nมีรายการรอตรวจ ${formatNumber(reviewCount)} รายการ — ระบบจะบันทึกเป็น DEFERRED และไม่รวมในยอดที่ปิด`
    : "";

  const acceptingGroupCount=
    (state.settlement?.summary_group_states||[])
      .filter(
        (item)=>
          item.accepting_orders!==false
      )
      .length;

  const groupNote=acceptingGroupCount>0
    ? `\nยังมี ${formatNumber(acceptingGroupCount)} กลุ่มเปิดรับยอด — การปิดยอดทั้งหมดจะจบรอบนี้ทันที`
    : "";

  if(!window.confirm(`ปิดยอดทั้งหมดของรอบนี้?${groupNote}${reviewNote}\nหลังปิดยังระบุ Point ได้`))return;
  $("#closeSettlementButton").disabled=true;
  try{
    await api("/api/settlement",{method:"POST",body:JSON.stringify({action:"CLOSE",settlement_session_id:open.id})});
    toast("ปิดยอดแล้ว");
    state.specialPointSessionId=null;
    await loadSettlement();
    await loadDashboard();
    if($("#reportSessionSelect").value) await loadReport();
  }
  catch(error){toast(`ปิดยอดไม่สำเร็จ: ${error.message}`,true);}finally{$("#closeSettlementButton").disabled=false;}
}

function pointProfileMap() { return new Map((state.specialPointProfiles||[]).map(p=>[p.category,p])); }
function promotionMap() { return new Map((state.specialPointPromotions||[]).map(p=>[`${p.category}|${p.code}`,Number(p.point_factor_pct)])); }

function pointDraftReady() {
  const counts=new Map();for(const r of state.specialPointRules)counts.set(r.category,(counts.get(r.category)||0)+1);
  const activeMap=state.specialPointStatus?.category_counts||{};
  for(const p of state.specialPointProfiles||[]){
    if(activeMap[p.category]?.active===false)continue;
    const count=counts.get(p.category)||0;
    if(["A","B","E"].includes(p.category) && count!==1)return false;
    if(["G","H","L"].includes(p.category) && count!==Number(p.max_special_codes||0))return false;
    if(p.category==="F" && count>Number(p.max_special_codes||0))return false;
  }
  return Boolean((state.specialPointProfiles||[]).length);
}

function renderSpecialPoints() {
  renderProfileStrip("#specialPointProfiles",state.specialPointProfiles);
  const profileMap=pointProfileMap();const promo=promotionMap();
  const counts=new Map();for(const r of state.specialPointRules)counts.set(r.category,(counts.get(r.category)||0)+1);
  const requirements=(state.specialPointProfiles||[]).filter(p=>state.specialPointStatus?.category_counts?.[p.category]?.active!==false).map(p=>`${p.category} ${formatNumber(counts.get(p.category)||0)}/${formatNumber(p.max_special_codes)}`).join(" · ");
  const ready=pointDraftReady();
  $("#specialPointStatus").innerHTML=`<div class="point-status-line ${ready?"ready":"pending"}"><strong>${ready?"Point ครบ":"รอ Point"}</strong><span>${escapeHtml(requirements)}</span></div>`;
  const list=$("#specialPointRules");
  if(!state.specialPointRules.length){list.innerHTML=`<div class="muted">ยังไม่ได้ระบุ Point</div>`;return;}
  list.innerHTML=state.specialPointRules.map((r,i)=>{const p=profileMap.get(r.category);const factor=promo.get(`${r.category}|${r.code}`)??100;const effective=Number(p?.special_multiplier||0)*factor/100;return `<div class="settings-row"><span><strong>★ ${escapeHtml(r.category)}${escapeHtml(r.code)}</strong><small>×${formatNumber(effective)}${factor<100?` · Promotion ${formatNumber(factor)}%`:""}</small></span><span></span><button class="button ghost small remove-point" data-i="${i}">ลบ</button></div>`;}).join("");
  $$(".remove-point").forEach(b=>b.addEventListener("click",()=>{state.specialPointRules.splice(Number(b.dataset.i),1);renderSpecialPoints();}));
}

async function loadSpecialPoints(
  sessionId = null,
  summaryGroupId = null,
) {
  const targetId=
    sessionId
    || state.settlement?.open_session?.id
    || $("#reportSessionSelect")?.value
    || state.specialPointSessionId
    || "";

  const requestedSummaryGroup=
    summaryGroupId
    || summaryGroupSelect.value
    || "ALL";

  const params=new URLSearchParams();

  if(targetId){
    params.set(
      "session_id",
      targetId,
    );
  }

  params.set(
    "group",
    requestedSummaryGroup,
  );

  const query=
    params.toString()
      ? `?${params.toString()}`
      : "";

  const payload=
    await api(
      `/api/special-points${query}`,
    );

  state.specialPointSession=
    payload.session||null;

  state.specialPointSessionId=
    payload.session?.id||null;

  state.specialPointSummaryGroupId=
    payload.selected_summary_group||null;

  state.specialPointStatus=
    payload.status||null;

  state.specialPointProfiles=
    payload.profiles||[];

  state.specialPointPromotions=
    payload.promotions||[];

  state.specialPointRules=
    (payload.codes||[]).map(
      r=>({
        category:r.category,
        code:r.code,
      }),
    );

  renderSpecialPoints();

  const enabled=
    Boolean(
      payload.session
      && payload.selected_summary_group,
    );

  $("#specialPointForm")
    .querySelectorAll(
      "input,select,button",
    )
    .forEach(
      el=>{
        el.disabled=!enabled;
      },
    );

  $("#saveSpecialPointsButton")
    .disabled=!enabled;

  const context=
    $("#specialPointContext");

  if(context){
    if(!payload.session){
      context.textContent=
        "ยังไม่มีชุดยอด";
    }else if(
      !payload.selected_summary_group
    ){
      context.textContent=
        `${payload.session.status==="CLOSED"?"ปิดยอดแล้ว":"ยอดปัจจุบัน"} · ${formatThaiDate(payload.session.business_date)} · เลือกกลุ่มสรุปจากตัวกรองด้านบน`;
    }else{
      context.textContent=
        `${payload.session.status==="CLOSED"?"ปิดยอดแล้ว":"ยอดปัจจุบัน"} · ${formatThaiDate(payload.session.business_date)} · ${groupName(payload.selected_summary_group)}`;
    }
  }
}

async function saveSpecialPoints() {
  const sessionId=
    state.specialPointSessionId;

  const summaryGroupId=
    state.specialPointSummaryGroupId;

  const editingStatus=
    state.specialPointSession?.status;

  if(!sessionId){
    return toast(
      "ยังไม่มีชุดยอด",
      true,
    );
  }

  if(!summaryGroupId){
    return toast(
      "กรุณาเลือกกลุ่มสรุป",
      true,
    );
  }

  try{
    await api(
      "/api/special-points",
      {
        method:"POST",
        body:JSON.stringify({
          settlement_session_id:
            sessionId,
          summary_group_id:
            summaryGroupId,
          codes:
            state.specialPointRules,
        }),
      },
    );

    toast(
      `บันทึก Point ${groupName(summaryGroupId)} แล้ว`,
    );

    await loadSpecialPoints(
      sessionId,
      summaryGroupId,
    );

    await loadSettlement();

    if(editingStatus==="OPEN"){
      await loadDashboard();
    }

    await loadReport();
  }catch(error){
    toast(
      `บันทึก Point ไม่สำเร็จ: ${error.message}`,
      true,
    );
  }
}

function editReportPoints(
  sessionId,
  summaryGroupId,
) {
  if(!sessionId)return;

  if(
    summaryGroupId
    && [...summaryGroupSelect.options]
      .some(
        option=>
          option.value===summaryGroupId,
      )
  ){
    summaryGroupSelect.value=
      summaryGroupId;
  }

  state.specialPointSessionId=
    sessionId;

  state.specialPointSummaryGroupId=
    summaryGroupId||null;

  activateTab(
    "points",
    {
      pointSessionId:
        sessionId,
      pointSummaryGroupId:
        summaryGroupId||null,
    },
  );
}

function renderReport(payload) {
  const root=$("#reportContent");

  state.reportPayload=payload;

  const summaryOnly=
    payload?.summary_only===true;

  const exportButton=
    $("#exportReportCsvButton");

  if(exportButton){
    exportButton.disabled=
      summaryOnly
      || !payload?.session
      || !(payload?.groups||[]).length;
  }

  if(!payload.session){
    root.innerHTML=
      `<div class="empty">ยังไม่มีชุดยอดสำหรับรายงาน</div>`;
    return;
  }

  if(!payload.groups.length){
    root.innerHTML=
      `<div class="empty">ยังไม่มีข้อมูลในชุดยอดนี้</div>`;
    return;
  }

  const reportSummaryIds=[
    ...new Set(
      payload.groups.map(
        g=>g.summary_group_id,
      ),
    ),
  ];

  const statusMap=
    new Map(
      (payload.actual_point_statuses||[])
        .map(
          row=>[
            row.summary_group_id,
            row,
          ],
        ),
    );

  const actualSummarySet=
    new Set(
      (payload.actual_special_codes||[])
        .map(
          row=>
            row.summary_group_id,
        ),
    );

  const readyCount=
    reportSummaryIds.filter(
      id=>
        statusMap.get(id)
          ?.actual_codes_ready===true,
    ).length;

  const allReady=
    reportSummaryIds.length>0
    && readyCount===
       reportSummaryIds.length;

  const anyPoint=
    reportSummaryIds.some(
      id=>
        actualSummarySet.has(id),
    );

  const singleSummaryId=
    reportSummaryIds.length===1
      ? reportSummaryIds[0]
      : null;

  const pointStateLabel=
    allReady
      ? "Point ครบ"
      : anyPoint
        ? `Point ครบ ${formatNumber(readyCount)}/${formatNumber(reportSummaryIds.length)} กลุ่ม`
        : "รอ Point";

  const pointAction=
    singleSummaryId
      ? `<button class="button ghost small edit-report-points" data-session-id="${escapeHtml(payload.session.id)}" data-summary-group-id="${escapeHtml(singleSummaryId)}">${actualSummarySet.has(singleSummaryId)?"แก้ไข Point":"ระบุ Point"}</button>`
      : `<span class="muted">เลือกกลุ่มสรุปเพื่อระบุ/แก้ไข Point</span>`;

  const pointNotice=
    `<div class="report-point-state ${allReady?"ready":"pending"}"><span><strong>${escapeHtml(pointStateLabel)}</strong>${payload.session.status==="CLOSED"&&!allReady?" · ปิดยอดแล้ว ระบุ/แก้ไขภายหลังได้":""}</span>${pointAction}</div>`;

  root.innerHTML=
    `<div class="report-session-heading"><strong>รายงานประจำวัน ${escapeHtml(formatThaiDate(payload.session.business_date))}</strong><span>${payload.session.status==="OPEN"?"ยอดปัจจุบัน":`ปิด ${escapeHtml(formatBangkokTime(payload.session.closed_at))}`}</span></div>${pointNotice}`
    + payload.groups.map(g=>{
      const pointSpecified=
        Boolean(
          g.point_specified
          ?? actualSummarySet.has(
            g.summary_group_id,
          ),
        );

      const finalReady=
        Boolean(
          g.actual_point_status
            ?.actual_codes_ready
          ?? statusMap.get(
            g.summary_group_id,
          )?.actual_codes_ready,
        );

      if(summaryOnly){
        return `<section class="report-card">
          <div class="report-title">
            <div>
              <h3>${escapeHtml(g.line_group_name)}</h3>
              <span>${escapeHtml(groupName(g.summary_group_id))}</span>
            </div>
            <span>${formatNumber(g.message_count)} ข้อความ</span>
          </div>

          <div class="report-metrics">
            <div>
              <span>ยอดรับจริง</span>
              <strong>${formatNumber(g.received_total)}</strong>
            </div>

            <div>
              <span>ลด</span>
              <strong>${formatNumber(g.reduction_pct)}%</strong>
            </div>

            <div>
              <span>ยอดหลังลด</span>
              <strong>${formatNumber(g.after_reduction)}</strong>
            </div>

            <div>
              <span>Point พิเศษ</span>
              <strong>${pointSpecified?formatNumber(g.special_point_total):"รอระบุ"}</strong>
            </div>

            <div class="net">
              <span>ยอดสุทธิเทียบ</span>
              <strong>${finalReady?formatNumber(g.reconciliation_total):"—"}</strong>
            </div>
          </div>

          <div class="muted">
            เลือก LINE Group ด้านบนเพื่อดูรายการข้อความและรายละเอียด Point
          </div>
        </section>`;
      }

      return `<section class="report-card">
        <div class="report-title"><div><h3>${escapeHtml(g.line_group_name)}</h3><span>${escapeHtml(groupName(g.summary_group_id))}</span></div><span>${formatNumber(g.message_count)} ข้อความ</span></div>
        <div class="report-metrics"><div><span>ยอดรับจริง</span><strong>${formatNumber(g.received_total)}</strong></div><div><span>ลด</span><strong>${formatNumber(g.reduction_pct)}%</strong></div><div><span>ยอดหลังลด</span><strong>${formatNumber(g.after_reduction)}</strong></div><div><span>Point พิเศษ</span><strong>${pointSpecified?formatNumber(g.special_point_total):"รอระบุ"}</strong></div><div class="net"><span>ยอดสุทธิเทียบ</span><strong>${finalReady?formatNumber(g.reconciliation_total):"—"}</strong></div></div>
        <div class="special-summary"><h4>Point พิเศษ</h4>${g.special_point_codes.length?`<div class="table-wrap"><table><thead><tr><th>รหัส</th><th class="num">จำนวนรวม</th><th class="num">ตัวคูณ</th><th class="num">Point</th></tr></thead><tbody>${g.special_point_codes.map(x=>`<tr><td><strong>${escapeHtml(x.category)}${escapeHtml(x.code)}</strong></td><td class="num">${formatNumber(x.quantity)}</td><td class="num">×${formatNumber(x.multiplier)}</td><td class="num">${formatNumber(x.points)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="muted">${pointSpecified?"ยังไม่มียอดตรงรหัส Point ที่ระบุ":"รอระบุ"}</div>`}</div>
        <div class="table-wrap"><table><thead><tr><th>ลำดับ</th><th>เวลา</th><th>รหัสแรก</th><th class="num">สรุปจำนวน</th><th>Point พิเศษ</th></tr></thead><tbody>${g.ledger.map(row=>`<tr><td>${String(row.sequence).padStart(3,"0")}</td><td>${escapeHtml(new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(row.event_timestamp)))}</td><td class="report-first-code"><strong>${escapeHtml(row.first_code||"-")}</strong></td><td class="num"><strong>${formatNumber(row.summary_quantity)}</strong></td><td>${row.special_points.length?`★ ${row.special_points.map(x=>`${escapeHtml(x.category)}${escapeHtml(x.code)}=${formatNumber(x.quantity)} ×${formatNumber(x.multiplier)}`).join(", ")}`:""}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="3">รวม</th><th class="num">${formatNumber(g.received_total)}</th><th></th></tr></tfoot></table></div>
      </section>`;
    }).join("");

  $$(".edit-report-points")
    .forEach(
      button=>
        button.addEventListener(
          "click",
          ()=>editReportPoints(
            button.dataset.sessionId,
            button.dataset.summaryGroupId,
          ),
        ),
    );
}

let reportLoadVersion = 0;

async function loadReport(options = {}) {
  const silent = options?.silent === true;
  const loadVersion = ++reportLoadVersion;
  const sessionId=$("#reportSessionSelect").value || state.settlement?.open_session?.id;
  if(!sessionId){renderReport({session:null,groups:[]});return;}

  const reportSummaryGroup =
    summaryGroupSelect.value || "ALL";

  const reportLineGroup =
    $("#reportLineGroupSelect").value || "ALL";

  const summaryOnly=
    reportLineGroup==="ALL";

  const summaryOnlyQuery=
    summaryOnly
      ? "&summary_only=1"
      : "";

  try {
    const payload=await api(`/api/accounting-report?session_id=${encodeURIComponent(sessionId)}&group=${encodeURIComponent(reportSummaryGroup)}&line_group=${encodeURIComponent(reportLineGroup)}${summaryOnlyQuery}`);

    if(loadVersion!==reportLoadVersion)return;

    renderReport(payload);
  }
  catch(error){
    if(loadVersion!==reportLoadVersion)return;

    state.reportPayload=null;
    const exportButton=$("#exportReportCsvButton");
    if(exportButton) exportButton.disabled=true;
    if (silent) console.warn("silent report refresh failed", error);
    else $("#reportContent").innerHTML=`<div class="empty">โหลดรายงานไม่สำเร็จ</div>`;
  }
}

function bindV5Controls() {
  $("#prepareOpenButton").addEventListener("click",()=>{
    $("#openSettlementEditor").classList.remove("hidden");renderPromotionDrafts();
  });
  $("#cancelOpenSettlementButton").addEventListener("click",()=>$("#openSettlementEditor").classList.add("hidden"));
  $("#promotionDraftForm").addEventListener("submit",event=>{
    event.preventDefault();const f=event.currentTarget;const summary_group_id=f.elements.summary_group_id.value;const category=f.elements.category.value;const code=f.elements.code.value.trim();const point_factor_pct=Number(f.elements.point_factor_pct.value);
    if(!summary_group_id)return toast("กรุณาเลือกกลุ่มสรุป",true);
    const expectedLength=categoryCodeLength(category);if(!new RegExp(`^\\d{${expectedLength}}$`).test(code))return toast(`รหัส ${category} ต้องเป็น ${expectedLength} หลัก`,true);
    if(!Number.isFinite(point_factor_pct)||point_factor_pct<0||point_factor_pct>100)return toast("Promotion ต้องอยู่ระหว่าง 0–100%",true);
    const rule={summary_group_id,category,code,point_factor_pct};const existing=state.promotionDrafts.findIndex(x=>x.summary_group_id===summary_group_id&&x.category===category&&x.code===code);if(existing>=0)state.promotionDrafts[existing]=rule;else state.promotionDrafts.push(rule);
    f.elements.code.value="";f.elements.point_factor_pct.value="";renderPromotionDrafts();
  });
  $("#openSettlementButton").addEventListener("click",openSettlement);$("#closeSettlementButton").addEventListener("click",closeSettlement);
  $("#specialPointForm").addEventListener("submit",event=>{
    event.preventDefault();const f=event.currentTarget;const category=f.elements.category.value;const code=f.elements.code.value.trim();const p=pointProfileMap().get(category);const expectedLength=categoryCodeLength(category);
    if(!new RegExp(`^\\d{${expectedLength}}$`).test(code))return toast(`รหัส ${category} ต้องเป็น ${expectedLength} หลัก`,true);
    if(state.specialPointRules.some(x=>x.category===category&&x.code===code))return toast("มีรหัสนี้แล้ว",true);
    if(state.specialPointRules.filter(x=>x.category===category).length>=Number(p?.max_special_codes||1))return toast(`${category} กำหนดได้สูงสุด ${formatNumber(p?.max_special_codes||1)} รหัส`,true);
    state.specialPointRules.push({category,code});f.elements.code.value="";renderSpecialPoints();
  });
  $("#saveSpecialPointsButton").addEventListener("click",saveSpecialPoints);
  $("#selectAllRecommendedButton").addEventListener("click",()=>setRecommendedSelection(true));
  $("#clearRecommendedButton").addEventListener("click",()=>setRecommendedSelection(false));

  allocationLineGroupSelect.addEventListener("change",()=>{
    clearTransferPreview();
    renderAllocation();
  });

  $("#runBulkDistributionButton").addEventListener("click",runBulkDistribution);
  $("#reportSessionSelect").addEventListener("change",loadReport);$("#reportLineGroupSelect").addEventListener("change",loadReport);
  $("#exportReportCsvButton").addEventListener("click",exportDailyReportCsv);
}

async function loadDashboard({
  silent = false,
  preserveReviewWorkbench = false,
} = {}) {
  if (!silent) {
    refreshButton.disabled = true;
    refreshButton.textContent = "กำลังอัปเดต...";
  }
  try {
    const payload = await api(`/api/dashboard?${selectedQuery()}`);
    state.dashboard = payload;
    state.freshnessVersion = payload.freshness?.version ?? null;
    setDashboardStale(false);
    if (!businessDateInput.value) businessDateInput.value = payload.business_date || todayBangkok();
    if (!state.groupsLoaded) {
      const current = summaryGroupSelect.value || "ALL";
      summaryGroupSelect.innerHTML = `<option value="ALL">ทุกกลุ่ม</option>`;
      for (const group of payload.summary_groups) {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        summaryGroupSelect.append(option);
      }
      if ([...summaryGroupSelect.options].some((o) => o.value === current)) summaryGroupSelect.value = current;
      state.groupsLoaded = true;
    }
    renderMetrics(payload.metrics);
    renderSummary();
    renderAllocation();
    renderAfterCut();
    await loadSettlement();
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "allocation") await loadAllocationHistory();
    if (activeTab === "postcut") await loadAllocationHistory({ silent });
    if (
      activeTab === "review" &&
      !preserveReviewWorkbench
    ) {
      await loadReviews();
    }
    if (activeTab === "unsend") await loadUnsends();
    if (activeTab === "settings") await loadSettings();
    if (activeTab === "points") await loadSpecialPoints();
    if (activeTab === "report") await loadReport();
  } catch (error) {
    if (error.message !== "UNAUTHORIZED") {
      if (silent) console.warn("silent dashboard refresh failed", error);
      else toast("อัปเดตข้อมูลไม่สำเร็จ", true);
    }
  } finally {
    if (!silent) {
      refreshButton.disabled = false;
      refreshButton.textContent = "อัปเดต";
    }
  }
}

function activateTab(name, options = {}) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`#${name}Tab`).classList.remove("hidden");
  if (name === "allocation") loadAllocationHistory();
  if (name === "postcut") loadAllocationHistory();
  if (name === "review") loadReviews();
  if (name === "unsend") loadUnsends();
  if (name === "settings") loadSettings();
  if (name === "points") loadSpecialPoints(options.pointSessionId || null, options.pointSummaryGroupId || null);
  if (name === "report") loadReport();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.accessKey = accessKeyInput.value.trim();
  sessionStorage.setItem("lineOrderDashboardKey", state.accessKey);
  loginError.classList.add("hidden");
  showApp();
  await loadDashboard();
  startFreshnessPolling();
});

logoutButton.addEventListener("click", () => {
  stopFreshnessPolling();
  sessionStorage.removeItem("lineOrderDashboardKey");
  state.accessKey = "";
  state.freshnessVersion = null;
  state.dashboard = null;
  setDashboardStale(false);
  accessKeyInput.value = "";
  showLogin();
});

refreshButton.addEventListener("click", loadDashboard);
$("#staleRefreshButton").addEventListener("click", loadDashboard);
$("#reloadAllocationHistoryButton").addEventListener("click", loadAllocationHistory);
businessDateInput.addEventListener("change", () => { if (!state.settlement?.open_session) renderSettlementStatus(state.settlement || {open_session:null,promotions:[],closed_sessions:[]}); });
summaryGroupSelect.addEventListener("change", async () => {
  await loadDashboard();
  const activeTab = $(".tab.active")?.dataset.tab;
  if (activeTab === "report") await loadReport();
  if (activeTab === "points") await loadSpecialPoints();
});
$$(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
bindSettingForms();
bindV5Controls();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkFreshness();
});

if (state.accessKey) {
  showApp();
  loadDashboard().then(startFreshnessPolling);
} else {
  showLogin();
}
