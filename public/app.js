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
  specialPointSession: null,
  promotionDrafts: [],
  transferPreview: null,
  bulkDistributionPreview: null,
  allocationHistory: [],
  transferDestination: "",
};

const FRESHNESS_POLL_MS = 20_000;

const loginView = $("#loginView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const accessKeyInput = $("#accessKey");
const loginError = $("#loginError");
const businessDateInput = $("#businessDate");
const summaryGroupSelect = $("#summaryGroup");
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
      if (activeTab === "summary") {
        await loadDashboard({ silent: true });
      } else if (activeTab === "postcut") {
        await loadDashboard({ silent: true });
      } else if (activeTab === "report") {
        state.freshnessVersion = payload.freshness?.version ?? state.freshnessVersion;
        await loadReport({ silent: true });
      } else {
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
  const cards = [
    ["ยอดรับ", metrics.gross_received, false],
    ["หลังหัก %", metrics.adjusted_received, false],
    ["Point สำรอง", metrics.risk_point_total, Number(metrics.excess_point_risk) > 0],
    ["ระดับที่รับได้", metrics.risk_budget, false],
    ["Point เกิน", metrics.excess_point_risk, Number(metrics.excess_point_risk) > 0],
    ["ควรตัด", metrics.transfer_required_total, Number(metrics.transfer_required_total) > 0],
  ];
  $("#metrics").innerHTML = cards.map(([label, value, alert]) => `
    <article class="metric ${alert ? "alert" : ""}"><div class="label">${escapeHtml(label)}</div><div class="value">${typeof value === "string" ? escapeHtml(value) : formatNumber(value)}</div></article>`).join("");
  $("#reviewBadge").textContent = formatNumber(metrics.review_open);
  $("#freshness").textContent = `ล่าสุด ${formatBangkokClock(metrics.last_event_at)} · ${formatNumber(metrics.messages_total)} ข้อความ`;
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

function distributionPlanFor(groupId) {
  return (state.dashboard?.distribution_plans || []).find((r) => r.summary_group_id === groupId) || null;
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
  return [...map.values()]
    .filter((row) => ["A", "B"].includes(category) || Number(row.order_total) > 0)
    .sort((a, b) => Number(b.order_total) - Number(a.order_total) || String(a.code).localeCompare(String(b.code)));
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
  const list = rows.length ? rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const width = qty > 0 ? Math.max(3, qty / maxQty * 100) : 0;
    const promo = Number(row.promotion_factor_pct ?? 100) < 100 ? `<span class="promo-badge">PROMO ${formatNumber(row.promotion_factor_pct)}%</span>` : "";
    const reserve = row.reserve_candidate && qty > 0 ? `<span class="reserve-badge">สำรอง</span>` : "";
    const actual = row.actual_special_point ? `<span class="point-badge">★ Point จริง</span>` : "";
    return `<div class="board-code-row ${qty === 0 ? "zero" : ""} ${row.reserve_candidate ? "reserve" : ""} ${row.actual_special_point ? "actual" : ""}">
      <div class="board-code-main"><strong>${escapeHtml(row.code)}</strong><span>${formatNumber(qty)}</span></div>
      <div class="board-code-badges">${actual}${reserve}${promo}${Number(row.confirmed_cut||0)>0?`<span class="promo-badge">คงคลัง ${formatNumber(row.retained_quantity ?? row.available_to_cut ?? 0)}</span>`:""}</div>
      <div class="qty-track"><div class="qty-fill" style="width:${width}%"></div></div>
    </div>`;
  }).join("") : `<div class="empty compact">ยังไม่มีออเดอร์</div>`;
  return `<section class="board-column">${header}<div class="board-code-list">${list}</div></section>`;
}

function renderGroupBoard(groupId) {
  const overall = overallRiskFor(groupId);
  const gRows = codeRowsFor(groupId, "G");
  return `<section class="summary-group-board">
    <div class="group-risk-header ${riskClass(overall?.risk_pct)}">
      <div><h3>${escapeHtml(groupName(groupId))}</h3><span>${overall?.risk_mode === "ACTUAL" ? "Point จริง" : "Point สำรอง"}</span></div>
      <div class="group-risk-summary">
        <div class="group-risk-metrics"><span>รับ <strong>${formatNumber(overall?.gross_received || 0)}</strong></span><span>หลังหัก <strong>${formatNumber(overall?.adjusted_received || 0)}</strong></span><span>Point <strong>${formatNumber(overall?.risk_point_total || 0)}</strong></span><span>ควรตัด <strong>${formatNumber(distributionPlanFor(groupId)?.transfer_required_total || 0)}</strong></span></div>
        <details class="group-risk-details"><summary>ดูรายละเอียด</summary><div><span>ยอมขาดทุน <strong>${formatNumber(overall?.point_loss_tolerance || 0)}</strong></span><span>รับได้ <strong>${formatNumber(overall?.risk_budget || 0)}</strong></span><span>Point เกิน <strong>${formatNumber(overall?.excess_point_risk || 0)}</strong></span><span>เสี่ยง <strong>${formatNumber(overall?.risk_pct || 0)}%</strong></span></div></details>
      </div>
    </div>
    <div class="four-column-board">${["A","B","E","F"].map((c) => renderCategoryColumn(groupId,c)).join("")}</div>
    ${gRows.length ? `<div class="g-board"><div class="category-heading"><h3>หมวด G</h3><span>×${formatNumber(profileFor("G")?.special_multiplier || 20)} · สูงสุด ${formatNumber(profileFor("G")?.max_special_codes || 4)} รหัส</span></div><div class="g-code-grid">${gRows.map((row)=>`<div class="g-code ${row.reserve_candidate?"reserve":""} ${row.actual_special_point?"actual":""}"><strong>G${escapeHtml(row.code)}</strong><span>${formatNumber(row.order_total)}</span>${row.actual_special_point?`<em>★</em>`:row.reserve_candidate?`<em>สำรอง</em>`:""}${Number(row.promotion_factor_pct??100)<100?`<small>PROMO ${formatNumber(row.promotion_factor_pct)}%</small>`:""}</div>`).join("")}</div></div>` : ""}
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
  const rows = allRows.filter((row) => Number(row.order_total || 0) > 0 || Number(row.confirmed_cut || 0) > 0);
  const transferredTotal = allRows.reduce((sum, row) => sum + Number(row.confirmed_cut || 0), 0);
  const receivedTotal = allRows.reduce((sum, row) => sum + Number(row.order_total || 0), 0);
  const retainedTotal = allRows.reduce((sum, row) => sum + Number(row.retained_quantity ?? row.available_to_cut ?? row.order_total ?? 0), 0);
  const categoryRounds = new Set();
  for (const row of allRows) {
    for (const round of roundsByCode.get(`${groupId}|${category}|${row.code}`) || []) categoryRounds.add(round.batch_number);
  }
  const header = `<div class="board-column-head postcut-column-head">
    <div class="category-title"><strong>${escapeHtml(category)}</strong><span>ตัด ${formatNumber(transferredTotal)} · ${formatNumber(categoryRounds.size)} รอบ</span></div>
    <div class="category-risk-mini"><span>รับ ${formatNumber(receivedTotal)}</span><span>ตัด ${formatNumber(transferredTotal)}</span><span>คง ${formatNumber(retainedTotal)}</span></div>
  </div>`;

  const list = rows.length ? rows.map((row) => {
    const qty = Number(row.order_total || 0);
    const cut = Number(row.confirmed_cut || 0);
    const retained = Number(row.retained_quantity ?? row.available_to_cut ?? Math.max(0, qty - cut));
    const rounds = roundsByCode.get(`${groupId}|${category}|${row.code}`) || [];
    const roundHtml = rounds.length
      ? `<div class="postcut-rounds">${rounds.map((round) => `<span class="round-chip">#${formatNumber(round.batch_number)} ${escapeHtml(round.destination)} ${formatNumber(round.quantity)}</span>`).join("")}</div>`
      : (qty > 0 ? `<div class="postcut-rounds"><span class="round-empty">ยังไม่ตัด</span></div>` : "");
    return `<div class="board-code-row postcut-code-row ${qty === 0 ? "zero" : ""} ${cut > 0 ? "has-cut" : ""}">
      <div class="board-code-main"><strong>${escapeHtml(row.code)}</strong><span>${formatNumber(retained)}</span></div>
      <div class="postcut-code-stats"><span>รับ ${formatNumber(qty)}</span><span>ตัด ${formatNumber(cut)}</span><strong>คง ${formatNumber(retained)}</strong></div>
      ${roundHtml}
    </div>`;
  }).join("") : `<div class="empty compact">ยังไม่มีรายการ</div>`;
  return `<section class="board-column postcut-board-column">${header}<div class="board-code-list">${list}</div></section>`;
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
      return `<div class="g-code postcut-g-code ${cut > 0 ? "has-cut" : ""}"><strong>G${escapeHtml(row.code)}</strong><span>คง ${formatNumber(retainedQty)}</span><em>รับ ${formatNumber(qty)} · ตัด ${formatNumber(cut)}</em>${rounds.length ? `<small>${rounds.map((round) => `#${formatNumber(round.batch_number)} ${escapeHtml(round.destination)} ${formatNumber(round.quantity)}`).join(" · ")}</small>` : ""}</div>`;
    }).join("")}</div></div>` : ""}
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

function recommendationMapFor(groupId) {
  return new Map((distributionPlanFor(groupId)?.recommendations || []).map((row) => [`${row.category}|${row.code}`, row]));
}

function selectedRecommendedCodes() {
  return $$(".allocation-code-select:checked").map((input) => ({
    category: input.dataset.category,
    code: input.dataset.code,
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

function renderAllocationCategoryColumn(groupId, category) {
  const profile = profileFor(category);
  const risk = categoryRiskFor(groupId, category);
  const recommendations = recommendationMapFor(groupId);
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
        ${recommended > 0 ? `<input class="allocation-code-select" type="checkbox" checked data-category="${escapeHtml(category)}" data-code="${escapeHtml(row.code)}" aria-label="เลือก ${escapeHtml(category)}${escapeHtml(row.code)}" />` : `<span class="allocation-code-spacer"></span>`}
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

function updateBulkDistributionSummary(invalidatePreview = true) {
  const groupId = summaryGroupSelect.value;
  const recommendations = recommendationMapFor(groupId);
  const codes = selectedRecommendedCodes();
  const warehouses = selectedWarehouseNames();
  const selectedQty = codes.reduce((sum, item) => sum + Number(recommendations.get(`${item.category}|${item.code}`)?.recommended_transfer || 0), 0);
  const required = Number(distributionPlanFor(groupId)?.transfer_required_total || 0);
  const root = $("#bulkDistributionSummary");
  const button = $("#runBulkDistributionButton");

  if (!required) {
    root.className = "transfer-selection-bar";
    root.innerHTML = `<span>ยอดปัจจุบัน</span><strong>ยังไม่ต้องตัด</strong>`;
  } else if (!codes.length) {
    root.className = "transfer-selection-bar over";
    root.innerHTML = `<span>ควรตัด ${formatNumber(required)}</span><strong>เลือกรหัส</strong>`;
  } else if (!warehouses.length) {
    root.className = "transfer-selection-bar over";
    root.innerHTML = `<span>${formatNumber(codes.length)} รหัส · ${formatNumber(selectedQty)}</span><strong>เลือกคลัง</strong>`;
  } else {
    root.className = "transfer-selection-bar ready";
    root.innerHTML = `<span>${formatNumber(codes.length)} รหัส · ${formatNumber(selectedQty)} หน่วย</span><strong>${formatNumber(warehouses.length)} คลัง</strong>`;
  }
  button.disabled = state.dashboardStale || required <= 0 || !codes.length || !warehouses.length;
  if (invalidatePreview) clearTransferPreview();
}

function renderAllocation() {
  const riskSummary = $("#allocationRiskSummary");
  const board = $("#allocationBoard");
  const groupId = summaryGroupSelect.value;
  const warehouses = state.dashboard?.warehouse_limits || [];

  if (!state.dashboard?.settlement_session) {
    riskSummary.innerHTML = "";
    $("#warehouseChoices").innerHTML = "";
    board.innerHTML = `<div class="empty">ยังไม่ได้เปิดยอด</div>`;
    updateBulkDistributionSummary(false);
    return;
  }
  if (!groupId || groupId === "ALL") {
    riskSummary.innerHTML = `<div class="risk-notice">เลือก <strong>กลุ่มสรุป</strong> ด้านบน 1 กลุ่มก่อนตัดยอด</div>`;
    $("#warehouseChoices").innerHTML = "";
    board.innerHTML = "";
    updateBulkDistributionSummary(false);
    return;
  }

  const overall = overallRiskFor(groupId);
  const plan = distributionPlanFor(groupId);
  if (!overall || !plan) {
    riskSummary.innerHTML = `<div class="risk-notice">${escapeHtml(groupName(groupId))} ยังไม่มีออเดอร์สำหรับคำนวณ</div>`;
    $("#warehouseChoices").innerHTML = "";
    board.innerHTML = "";
    updateBulkDistributionSummary(false);
    return;
  }

  const safetyMargin = Number(overall.safety_margin ?? overall.net_safe_capacity ?? 0);
  const excessPoint = Math.max(0, Number(overall.excess_point_risk || 0));
  const required = Math.max(0, Number(plan.transfer_required_total || 0));
  const blocked = excessPoint <= 0 || required <= 0;

  riskSummary.innerHTML = `<section class="cut-capacity-card ${blocked ? "blocked" : ""}">
    <div class="capacity-main">
      <span>${escapeHtml(groupName(groupId))}</span>
      <strong>${formatNumber(required)}</strong>
      <b>ควรตัด</b>
      ${blocked
        ? `<em>ยังไม่ต้องตัดเพิ่ม</em>`
        : `<em>เลือกรหัสและคลัง แล้วกดยืนยัน</em>`}
    </div>
    <details class="capacity-details">
      <summary>ดูรายละเอียด</summary>
      <div class="capacity-detail-grid risk-policy-detail-grid">
        <div><span>ยอดหลังหัก %</span><strong>${formatNumber(overall.adjusted_received)}</strong></div>
        <div><span>ยอมขาดทุน</span><strong>${formatNumber(overall.point_loss_tolerance)}</strong></div>
        <div><span>ระดับที่รับได้</span><strong>${formatNumber(overall.risk_budget)}</strong></div>
        <div><span>Point สำรอง</span><strong>${formatNumber(overall.risk_point_total)}</strong></div>
        <div class="${excessPoint > 0 ? "danger-value" : ""}"><span>Point เกิน</span><strong>${formatNumber(excessPoint)}</strong></div>
        <div class="${safetyMargin < 0 ? "danger-value" : ""}"><span>คงเหลือ</span><strong>${formatNumber(safetyMargin)}</strong></div>
      </div>
    </details>
  </section>`;

  renderWarehouseChoices(warehouses);

  if (blocked) {
    board.innerHTML = `<div class="risk-notice">ยังไม่ต้องตัดยอด</div>`;
    updateBulkDistributionSummary(false);
    return;
  }

  const gRows = codeRowsFor(groupId, "G");
  const gRecommendations = recommendationMapFor(groupId);
  board.innerHTML = `<section class="summary-group-board allocation-summary-board">
    <div class="four-column-board">${["A","B","E","F"].map((category) => renderAllocationCategoryColumn(groupId,category)).join("")}</div>
    ${gRows.length ? `<div class="g-board allocation-g-board"><div class="category-heading"><h3>หมวด G</h3><span>Point ×${formatNumber(profileFor("G")?.special_multiplier || 0)}</span></div><div class="g-code-grid">${gRows.map((row) => {
      const rec = gRecommendations.get(`G|${row.code}`);
      const recommended = Math.min(Number(row.retained_quantity ?? row.available_to_cut ?? 0),Number(rec?.recommended_transfer || 0));
      return `<label class="g-code allocation-g-code ${recommended > 0 ? "recommended" : ""}">
        ${recommended > 0 ? `<input class="allocation-code-select" type="checkbox" checked data-category="G" data-code="${escapeHtml(row.code)}" aria-label="เลือก G${escapeHtml(row.code)}" />` : `<span></span>`}
        <strong>G${escapeHtml(row.code)}</strong><span>รับ ${formatNumber(row.order_total)} · คง ${formatNumber(row.retained_quantity ?? 0)}</span>${recommended > 0 ? `<em>ตัด ${formatNumber(recommended)}</em>` : ""}
      </label>`;
    }).join("")}</div></div>` : ""}
  </section>`;

  $$(".allocation-code-select").forEach((input) => input.addEventListener("change", () => updateBulkDistributionSummary(true)));
  updateBulkDistributionSummary(false);
}

async function runBulkDistribution() {
  if (state.dashboardStale) return toast("ข้อมูลเปลี่ยน กรุณาอัปเดต", true);
  const groupId = summaryGroupSelect.value;
  const selectedCodes = selectedRecommendedCodes();
  const destinations = selectedWarehouseNames();
  if (!groupId || groupId === "ALL") return toast("กรุณาเลือกกลุ่มสรุป", true);
  if (!selectedCodes.length) return toast("กรุณาเลือกรหัสที่ต้องการตัด", true);
  if (!destinations.length) return toast("กรุณาเลือกคลังปลายทาง", true);

  const button = $("#runBulkDistributionButton");
  button.disabled = true;
  button.textContent = "กำลังจัดแผน...";
  try {
    const preview = await api("/api/risk-distribution-preview", {
      method:"POST",
      body:JSON.stringify({ summary_group_id:groupId, destinations, selected_codes:selectedCodes }),
    });
    state.bulkDistributionPreview = preview;
    const roundsPreview = (preview.rounds || []).slice(0,8).map((round) =>
      `รอบ ${formatNumber(round.round_index)} · ${round.destination} · ${formatNumber(round.quantity)}`
    ).join("\n");
    const extraRounds = Math.max(0, Number(preview.planned_rounds || 0) - 8);
    $("#transferPreview").innerHTML = `<div class="preview-box ok transfer-confirm-card">
      <div class="preview-heading"><strong>พร้อมตัดยอด</strong><span>${formatNumber(preview.selected_code_count)} รหัส · ${formatNumber(preview.selected_warehouse_count)} คลัง</span></div>
      <div class="confirm-totals"><div><span>ยอดตัด</span><strong>${formatNumber(preview.planned_quantity)}</strong></div><div><span>รอบ</span><strong>${formatNumber(preview.planned_rounds)}</strong></div><div><span>Point เกินหลังตัด</span><strong>${formatNumber(preview.projected_excess_point_risk)}</strong></div></div>
      <div class="preview-policy-note">ระบบแบ่งรอบตามคลัง</div>
    </div>`;

    const confirmed = window.confirm(
      `ยืนยันตัดยอด?\n\n` +
      `รหัส ${formatNumber(preview.selected_code_count)} รายการ\n` +
      `รวม ${formatNumber(preview.planned_quantity)} หน่วย\n` +
      `แบ่ง ${formatNumber(preview.planned_rounds)} รอบ\n\n` +
      `${roundsPreview}${extraRounds ? `\n...อีก ${formatNumber(extraRounds)} รอบ` : ""}`
    );
    if (!confirmed) return;

    button.textContent = "กำลังยืนยันทุกรอบ...";
    const payload = await api("/api/risk-distribution-confirm", {
      method:"POST",
      body:JSON.stringify({ confirmation_token:preview.confirmation_token }),
    });
    const run = payload.run || {};
    toast(`ตัดยอดสำเร็จ ${formatNumber(run.confirmed_quantity || 0)}`);
    clearTransferPreview();
    await loadDashboard();
    await loadAllocationHistory();
  } catch (error) {
    const stale = ["RISK_STATE_STALE","CONFIRMATION_EXPIRED","TRANSFER_EXCEEDS_CODE_AVAILABLE","DESTINATION_LIMIT_NOT_CONFIGURED"].includes(error.message);
    if (stale) {
      setDashboardStale(true);
      toast("ข้อมูลเปลี่ยน กรุณาตรวจใหม่", true);
    } else {
      const friendly = {
        NO_RISK_DISTRIBUTION_REQUIRED:"ยังไม่ต้องตัดเพิ่ม",
        NO_SELECTED_DISTRIBUTION_TARGETS:"รหัสที่เลือกไม่มีส่วนเกินตามแผนปัจจุบัน",
        WAREHOUSE_SELECTION_REQUIRED:"กรุณาเลือกคลังปลายทาง",
      }[error.message] || error.message;
      toast(`ตัดยอดไม่สำเร็จ: ${friendly}`, true);
    }
  } finally {
    button.textContent = "ตัดยอดที่เลือก";
    updateBulkDistributionSummary(false);
  }
}

async function loadAllocationHistory({ silent = false } = {}) {
  const root=$("#allocationHistoryList");
  if(root && !silent) root.innerHTML=`<div class="empty compact">กำลังโหลด...</div>`;
  try{
    const group=summaryGroupSelect.value||"ALL";
    const payload=await api(`/api/allocation-history?group=${encodeURIComponent(group)}`);
    state.allocationHistory=payload.history||[];
    renderAfterCut();
    if(!root)return;
    if(!state.allocationHistory.length){root.innerHTML=`<div class="empty compact">ยังไม่มีรอบส่งในชุดยอดปัจจุบัน</div>`;return;}
    root.innerHTML=state.allocationHistory.map((item)=>`<article class="history-card"><div class="history-head"><strong>รอบ #${formatNumber(item.batch_number)} · ${escapeHtml(item.destination)}</strong><span>${escapeHtml(formatBangkokTime(item.confirmed_at))}</span></div><div class="transfer-lines">${item.lines.map(line=>`<div>${escapeHtml(line)}</div>`).join("")}</div><div class="history-meta"><span>ตัด ${formatNumber(item.cut_total)}</span><span>สูงสุด ${formatNumber(item.warehouse_batch_limit || 0)}</span><span>${escapeHtml(item.confirmed_by||"-")}</span></div></article>`).join("");
  }catch(error){
    if(root && !silent) root.innerHTML=`<div class="empty compact">โหลดประวัติไม่สำเร็จ</div>`;
    if(!silent) toast("โหลดประวัติไม่สำเร็จ",true);
    else console.warn("silent allocation history refresh failed",error);
  }
}

function reviewReasonsHtml(item) {
  return (item.reason_codes || []).map((reason) => `
    <div><strong>${escapeHtml(reason.code)}</strong>${reason.detail ? ` — ${escapeHtml(reason.detail)}` : ""}</div>
  `).join("") || "ต้องตรวจสอบ";
}

function previewItemsHtml(preview) {
  const statusClass = preview.can_apply ? "ok" : "warn";
  const errors = (preview.errors || []).map((x) => `<div>${escapeHtml(x.code)}${x.detail ? ` — ${escapeHtml(x.detail)}` : ""}</div>`).join("");
  const items = (preview.items || []).map((x) => `<span class="item-chip">${escapeHtml(x.category)}${escapeHtml(x.code)} = ${formatNumber(x.quantity)}</span>`).join("");
  return `
    <div class="preview-box ${statusClass}">
      <div class="preview-heading">ผลตรวจ <strong>${escapeHtml(preview.status)}</strong></div>
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

function onReviewEditorInput(event) {
  const card = event.currentTarget.closest(".review-card");
  if (!card._reviewPreview) return;
  clearReviewPreview(card, "ข้อความถูกแก้หลังจากตรวจผลแล้ว กรุณากด “ตรวจผล” ใหม่ก่อนยืนยัน");
}

async function previewReview(event) {
  const card = event.currentTarget.closest(".review-card");
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

async function applyReview(card) {
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
    await loadDashboard();
    await loadReviews();
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
  const reviewId = Number(card.dataset.reviewId);
  if (!window.confirm("ยืนยันว่าข้อความนี้ไม่ใช่ออเดอร์และให้ข้าม? ถ้ามีรายการ PARTIAL ที่เคยสร้างไว้ ระบบจะถอนรายการของข้อความนี้ออก")) return;
  event.currentTarget.disabled = true;
  try {
    await api("/api/review-resolve", {
      method: "POST",
      body: JSON.stringify({ review_id: reviewId, action: "IGNORE" }),
    });
    toast("ข้าม Review แล้ว");
    await loadDashboard();
    await loadReviews();
  } catch (error) {
    toast(`ข้าม Review ไม่สำเร็จ: ${error.message}`, true);
  } finally {
    event.currentTarget.disabled = false;
  }
}

async function loadReviews() {
  const list = $("#reviewList");
  list.innerHTML = `<div class="empty">กำลังโหลด...</div>`;
  try {
    const payload = await api(`/api/reviews?${selectedQuery()}`);
    if (!payload.items.length) {
      list.innerHTML = `<div class="empty">ไม่มีรายการ Review ที่เปิดอยู่</div>`;
      return;
    }
    list.innerHTML = payload.items.map((item) => `
      <article class="review-card" data-review-id="${escapeHtml(item.id)}">
        <div class="review-meta">
          <span>${escapeHtml(item.line_group_name)}</span>
          <span>${escapeHtml(item.message_type)}</span>
          <span>${escapeHtml(formatBangkokTime(item.created_at))}</span>
          <span>${escapeHtml(item.user_id || "ไม่ทราบผู้ส่ง")}</span>
        </div>
        <div class="reason">${reviewReasonsHtml(item)}</div>
        <label class="editor-label">ข้อความสำหรับ Parse
          <textarea class="review-editor" rows="5" placeholder="แก้หรือกรอกข้อความออเดอร์ที่ถูกต้อง">${escapeHtml(item.text || "")}</textarea>
        </label>
        <div class="review-actions">
          <button class="button primary small preview-review">ตรวจผล</button>
          <button class="button ghost small ignore-review">ไม่ใช่ออเดอร์ / ข้าม</button>
        </div>
        <div class="review-preview"></div>
      </article>`).join("");
    $$(".preview-review").forEach((button) => button.addEventListener("click", previewReview));
    $$(".ignore-review").forEach((button) => button.addEventListener("click", ignoreReview));
    $$(".review-editor").forEach((editor) => editor.addEventListener("input", onReviewEditorInput));
  } catch (error) {
    list.innerHTML = `<div class="empty">โหลด Review ไม่สำเร็จ</div>`;
    toast(error.message, true);
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
    <div class="settings-row"><span><strong>${escapeHtml(row.category)} ×${formatNumber(row.special_multiplier)}</strong><small>Point พิเศษสูงสุด ${formatNumber(row.max_special_codes)} รหัส</small></span><span></span><button class="button ghost small edit-profile" data-id="${escapeHtml(row.category)}">แก้ไข</button></div>`).join("");

  $("#riskBudgetList").innerHTML = (s.risk_budgets || []).map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(groupName(row.summary_group_id))}</strong><small>ยอมติดลบได้ ${formatNumber(row.point_loss_tolerance)} Point</small></span><span></span><button class="button ghost small edit-risk-budget" data-id="${escapeHtml(row.summary_group_id)}">แก้ไข</button></div>`).join("");

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
    form.elements.category.value=row.category;form.elements.special_multiplier.value=row.special_multiplier;form.elements.max_special_codes.value=row.max_special_codes;
  }));
  $$(".edit-risk-budget").forEach((button)=>button.addEventListener("click",()=>{
    const row=(s.risk_budgets||[]).find((x)=>x.summary_group_id===button.dataset.id);const form=$("#riskBudgetForm");
    setSummaryOptions(form.elements.summary_group_id,row.summary_group_id);form.elements.point_loss_tolerance.value=row.point_loss_tolerance;
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

function bindSettingForms() {
  $("#summaryGroupForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("SUMMARY_GROUP", { id: f.elements.id.value, name: f.elements.name.value, enabled: f.elements.enabled.checked }, f);
  });
  $("#lineGroupForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("LINE_GROUP", { line_group_id: f.elements.line_group_id.value, line_group_name: f.elements.line_group_name.value, summary_group_id: f.elements.summary_group_id.value, reduction_pct: Number(f.elements.reduction_pct.value || 0), enabled: f.elements.enabled.checked }, f);
  });
  $("#pointProfileForm").addEventListener("submit", (event)=>{
    event.preventDefault();const f=event.currentTarget;
    saveSetting("POINT_PROFILE",{category:f.elements.category.value,special_multiplier:Number(f.elements.special_multiplier.value),max_special_codes:Number(f.elements.max_special_codes.value)},f);
  });
  $("#riskBudgetForm").addEventListener("submit", (event)=>{
    event.preventDefault();const f=event.currentTarget;
    saveSetting("RISK_BUDGET",{summary_group_id:f.elements.summary_group_id.value,point_loss_tolerance:Number(f.elements.point_loss_tolerance.value)},f);
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

function renderPromotionDrafts() {
  const list=$("#promotionDraftList");
  renderProfileStrip("#openingPointProfiles",state.settlement?.company_point_profiles||state.settlement?.point_profiles||[]);
  if(!state.promotionDrafts.length){list.innerHTML=`<div class="muted">ไม่มี Promotion — ถ้ารหัสใดถูก Point พิเศษ จะใช้ตัวคูณเต็มของหมวด</div>`;return;}
  const profileMap=new Map((state.settlement?.company_point_profiles||state.settlement?.point_profiles||[]).map(p=>[p.category,Number(p.special_multiplier)]));
  list.innerHTML=state.promotionDrafts.map((r,i)=>{const effective=(profileMap.get(r.category)||0)*Number(r.point_factor_pct||0)/100;return `<div class="settings-row"><span><strong>${escapeHtml(r.category)}${escapeHtml(r.code)} · ${formatNumber(r.point_factor_pct)}% ของ Point</strong><small>ถ้าได้ Point พิเศษ → ×${formatNumber(effective)}</small></span><span></span><button class="button ghost small remove-promo" data-i="${i}">ลบ</button></div>`;}).join("");
  $$(".remove-promo").forEach(b=>b.addEventListener("click",()=>{state.promotionDrafts.splice(Number(b.dataset.i),1);renderPromotionDrafts();}));
}

function renderSettlementStatus(payload) {
  state.settlement=payload;
  const open=payload.open_session;
  $("#prepareOpenButton").classList.toggle("hidden",Boolean(open));
  $("#closeSettlementButton").classList.toggle("hidden",!open);
  if(open){
    businessDateInput.value=open.business_date;businessDateInput.disabled=true;
    $("#settlementStatus").textContent=`เปิดยอดอยู่ · ${open.business_date}`;
    $("#settlementMeta").textContent=`เริ่ม ${formatBangkokTime(open.opened_at)} · Promotion ${formatNumber((payload.promotions||[]).length)} รหัส · ${payload.actual_point_status?.actual_codes_ready?"Point ครบ":"Point ยังไม่ครบ"}`;
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
  if(previousSessionId && sessions.some(s=>s.id===previousSessionId))select.value=previousSessionId;
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
  try{await api("/api/settlement",{method:"POST",body:JSON.stringify({action:"OPEN",business_date:date,promotions:state.promotionDrafts})});state.promotionDrafts=[];renderPromotionDrafts();toast("เปิดยอดแล้ว");await loadSettlement();await loadDashboard();}
  catch(error){if(error.message==="SETTLEMENT_ALREADY_OPEN")await recoverAlreadyOpenSettlement(error);else toast(`เปิดยอดไม่สำเร็จ: ${error.payload?.user_message||error.message}`,true);}finally{$("#openSettlementButton").disabled=false;}
}

async function closeSettlement() {
  const open=state.settlement?.open_session;if(!open)return;
  if(Number(state.dashboard?.metrics?.review_open||0)>0){activateTab("review");toast(`ยังมีรายการต้องตรวจ ${formatNumber(state.dashboard.metrics.review_open)}`,true);return;}
  if(!window.confirm("ปิดยอดปัจจุบัน?\nหลังปิดยังระบุ Point ได้"))return;
  $("#closeSettlementButton").disabled=true;
  try{
    await api("/api/settlement",{method:"POST",body:JSON.stringify({action:"CLOSE",settlement_session_id:open.id})});
    toast("ปิดยอดแล้ว");
    state.specialPointSessionId=null;
    await loadSettlement();
    await loadDashboard();
    if($("#reportSessionSelect").value) await loadReport();
  }
  catch(error){if(error.message==="SETTLEMENT_HAS_OPEN_REVIEW"){activateTab("review");toast("ยังมีรายการต้องตรวจ",true);}else toast(`ปิดยอดไม่สำเร็จ: ${error.message}`,true);}finally{$("#closeSettlementButton").disabled=false;}
}

function pointProfileMap() { return new Map((state.specialPointProfiles||[]).map(p=>[p.category,p])); }
function promotionMap() { return new Map((state.specialPointPromotions||[]).map(p=>[`${p.category}|${p.code}`,Number(p.point_factor_pct)])); }

function pointDraftReady() {
  const counts=new Map();for(const r of state.specialPointRules)counts.set(r.category,(counts.get(r.category)||0)+1);
  for(const p of state.specialPointProfiles||[]){
    const count=counts.get(p.category)||0;
    if(["A","B","E"].includes(p.category) && count!==1)return false;
    if(p.category==="G" && count!==Number(p.max_special_codes||4))return false;
    if(p.category==="F" && count>Number(p.max_special_codes||0))return false;
  }
  return Boolean((state.specialPointProfiles||[]).length);
}

function renderSpecialPoints() {
  renderProfileStrip("#specialPointProfiles",state.specialPointProfiles);
  const profileMap=pointProfileMap();const promo=promotionMap();
  const counts=new Map();for(const r of state.specialPointRules)counts.set(r.category,(counts.get(r.category)||0)+1);
  const requirements=(state.specialPointProfiles||[]).map(p=>`${p.category} ${formatNumber(counts.get(p.category)||0)}/${formatNumber(p.max_special_codes)}`).join(" · ");
  const ready=pointDraftReady();
  $("#specialPointStatus").innerHTML=`<div class="point-status-line ${ready?"ready":"pending"}"><strong>${ready?"Point ครบ":"รอ Point"}</strong><span>${escapeHtml(requirements)}</span></div>`;
  const list=$("#specialPointRules");
  if(!state.specialPointRules.length){list.innerHTML=`<div class="muted">ยังไม่ได้ระบุ Point</div>`;return;}
  list.innerHTML=state.specialPointRules.map((r,i)=>{const p=profileMap.get(r.category);const factor=promo.get(`${r.category}|${r.code}`)??100;const effective=Number(p?.special_multiplier||0)*factor/100;return `<div class="settings-row"><span><strong>★ ${escapeHtml(r.category)}${escapeHtml(r.code)}</strong><small>×${formatNumber(effective)}${factor<100?` · Promotion ${formatNumber(factor)}%`:""}</small></span><span></span><button class="button ghost small remove-point" data-i="${i}">ลบ</button></div>`;}).join("");
  $$(".remove-point").forEach(b=>b.addEventListener("click",()=>{state.specialPointRules.splice(Number(b.dataset.i),1);renderSpecialPoints();}));
}

async function loadSpecialPoints(sessionId = null) {
  const targetId=sessionId || state.settlement?.open_session?.id || $("#reportSessionSelect")?.value || state.specialPointSessionId || "";
  const query=targetId?`?session_id=${encodeURIComponent(targetId)}`:"";
  const payload=await api(`/api/special-points${query}`);
  state.specialPointSession=payload.session||null;
  state.specialPointSessionId=payload.session?.id||null;
  state.specialPointProfiles=payload.profiles||[];
  state.specialPointPromotions=payload.promotions||[];
  state.specialPointRules=(payload.codes||[]).map(r=>({category:r.category,code:r.code}));
  renderSpecialPoints();
  const enabled=Boolean(payload.session);
  $("#specialPointForm").querySelectorAll("input,select,button").forEach(el=>{el.disabled=!enabled;});
  $("#saveSpecialPointsButton").disabled=!enabled;
  const context=$("#specialPointContext");
  if(context) context.textContent=payload.session?`${payload.session.status==="CLOSED"?"ปิดยอดแล้ว":"ยอดปัจจุบัน"} · ${formatThaiDate(payload.session.business_date)}`:"ยังไม่มีชุดยอด";
}

async function saveSpecialPoints() {
  const sessionId=state.specialPointSessionId;
  const editingStatus=state.specialPointSession?.status;
  if(!sessionId)return toast("ยังไม่มีชุดยอด",true);
  try{
    await api("/api/special-points",{method:"POST",body:JSON.stringify({settlement_session_id:sessionId,codes:state.specialPointRules})});
    toast("บันทึก Point แล้ว");
    await loadSpecialPoints(sessionId);
    await loadSettlement();
    if(editingStatus==="OPEN")await loadDashboard();
    await loadReport();
  }
  catch(error){toast(`บันทึก Point ไม่สำเร็จ: ${error.message}`,true);}
}

function editReportPoints(sessionId) {
  if(!sessionId)return;
  state.specialPointSessionId=sessionId;
  activateTab("points",{pointSessionId:sessionId});
}


function renderReport(payload) {
  const root=$("#reportContent");
  if(!payload.session){root.innerHTML=`<div class="empty">ยังไม่มีชุดยอดสำหรับรายงาน</div>`;return;}
  if(!payload.groups.length){root.innerHTML=`<div class="empty">ยังไม่มีข้อมูลในชุดยอดนี้</div>`;return;}
  const finalReady=Boolean(payload.actual_point_status?.actual_codes_ready);
  const pointActionLabel=finalReady?"แก้ไข Point":"ระบุ Point";
  const pointNotice=`<div class="report-point-state ${finalReady?"ready":"pending"}"><span><strong>${finalReady?"Point ครบ":"รอ Point"}</strong>${payload.session.status==="CLOSED"&&!finalReady?" · ปิดยอดแล้ว ระบุภายหลังได้":""}</span><button class="button ghost small edit-report-points" data-session-id="${escapeHtml(payload.session.id)}">${pointActionLabel}</button></div>`;
  root.innerHTML=`<div class="report-session-heading"><strong>รายงานประจำวัน ${escapeHtml(formatThaiDate(payload.session.business_date))}</strong><span>${payload.session.status === "OPEN" ? "ยอดปัจจุบัน" : `ปิด ${escapeHtml(formatBangkokTime(payload.session.closed_at))}`}</span></div>${pointNotice}` + payload.groups.map(g=>`<section class="report-card">
    <div class="report-title"><div><h3>${escapeHtml(g.line_group_name)}</h3><span>${escapeHtml(groupName(g.summary_group_id))}</span></div><span>${formatNumber(g.message_count)} ข้อความ</span></div>
    <div class="report-metrics"><div><span>ยอดรับจริง</span><strong>${formatNumber(g.received_total)}</strong></div><div><span>ลด</span><strong>${formatNumber(g.reduction_pct)}%</strong></div><div><span>ยอดหลังลด</span><strong>${formatNumber(g.after_reduction)}</strong></div><div><span>Point พิเศษ</span><strong>${finalReady?formatNumber(g.special_point_total):"รอระบุ"}</strong></div><div class="net"><span>ยอดสุทธิเทียบ</span><strong>${finalReady?formatNumber(g.reconciliation_total):"—"}</strong></div></div>
    <div class="special-summary"><h4>Point พิเศษ</h4>${g.special_point_codes.length?`<div class="table-wrap"><table><thead><tr><th>รหัส</th><th class="num">จำนวนรวม</th><th class="num">ตัวคูณ</th><th class="num">Point</th></tr></thead><tbody>${g.special_point_codes.map(x=>`<tr><td><strong>${escapeHtml(x.category)}${escapeHtml(x.code)}</strong></td><td class="num">${formatNumber(x.quantity)}</td><td class="num">×${formatNumber(x.multiplier)}</td><td class="num">${formatNumber(x.points)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="muted">${finalReady?"ไม่มี Point พิเศษ":"รอระบุ"}</div>`}</div>
    <div class="table-wrap"><table><thead><tr><th>ลำดับ</th><th>เวลา</th><th class="num">สรุปจำนวน</th><th>Point พิเศษ</th></tr></thead><tbody>${g.ledger.map(row=>`<tr><td>${String(row.sequence).padStart(3,"0")}</td><td>${escapeHtml(new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(row.event_timestamp)))}</td><td class="num"><strong>${formatNumber(row.summary_quantity)}</strong></td><td>${row.special_points.length?`★ ${row.special_points.map(x=>`${escapeHtml(x.category)}${escapeHtml(x.code)}=${formatNumber(x.quantity)} ×${formatNumber(x.multiplier)}`).join(", ")}`:""}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="2">รวม</th><th class="num">${formatNumber(g.received_total)}</th><th></th></tr></tfoot></table></div>
  </section>`).join("");
  $$(".edit-report-points").forEach(button=>button.addEventListener("click",()=>editReportPoints(button.dataset.sessionId)));
}

async function loadReport(options = {}) {
  const silent = options?.silent === true;
  const sessionId=$("#reportSessionSelect").value || state.settlement?.open_session?.id;
  if(!sessionId){renderReport({session:null,groups:[]});return;}
  try { const payload=await api(`/api/accounting-report?session_id=${encodeURIComponent(sessionId)}&group=${encodeURIComponent(summaryGroupSelect.value||"ALL")}&line_group=${encodeURIComponent($("#reportLineGroupSelect").value||"ALL")}`); renderReport(payload); }
  catch(error){
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
    event.preventDefault();const f=event.currentTarget;const category=f.elements.category.value;const code=f.elements.code.value.trim();const point_factor_pct=Number(f.elements.point_factor_pct.value);
    const expectedLength=["A","B"].includes(category)?2:3;if(!new RegExp(`^\\d{${expectedLength}}$`).test(code))return toast(`รหัส ${category} ต้องเป็น ${expectedLength} หลัก`,true);
    if(!Number.isFinite(point_factor_pct)||point_factor_pct<0||point_factor_pct>100)return toast("Promotion ต้องอยู่ระหว่าง 0–100%",true);
    const rule={category,code,point_factor_pct};const existing=state.promotionDrafts.findIndex(x=>x.category===category&&x.code===code);if(existing>=0)state.promotionDrafts[existing]=rule;else state.promotionDrafts.push(rule);
    f.elements.code.value="";f.elements.point_factor_pct.value="";renderPromotionDrafts();
  });
  $("#openSettlementButton").addEventListener("click",openSettlement);$("#closeSettlementButton").addEventListener("click",closeSettlement);
  $("#specialPointForm").addEventListener("submit",event=>{
    event.preventDefault();const f=event.currentTarget;const category=f.elements.category.value;const code=f.elements.code.value.trim();const p=pointProfileMap().get(category);const expectedLength=["A","B"].includes(category)?2:3;
    if(!new RegExp(`^\\d{${expectedLength}}$`).test(code))return toast(`รหัส ${category} ต้องเป็น ${expectedLength} หลัก`,true);
    if(state.specialPointRules.some(x=>x.category===category&&x.code===code))return toast("มีรหัสนี้แล้ว",true);
    if(state.specialPointRules.filter(x=>x.category===category).length>=Number(p?.max_special_codes||1))return toast(`${category} กำหนดได้สูงสุด ${formatNumber(p?.max_special_codes||1)} รหัส`,true);
    state.specialPointRules.push({category,code});f.elements.code.value="";renderSpecialPoints();
  });
  $("#saveSpecialPointsButton").addEventListener("click",saveSpecialPoints);
  $("#selectAllRecommendedButton").addEventListener("click",()=>setRecommendedSelection(true));
  $("#clearRecommendedButton").addEventListener("click",()=>setRecommendedSelection(false));
  $("#runBulkDistributionButton").addEventListener("click",runBulkDistribution);
  $("#reportSessionSelect").addEventListener("change",loadReport);$("#reportLineGroupSelect").addEventListener("change",loadReport);
}

async function loadDashboard({ silent = false } = {}) {
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
    if (activeTab === "review") await loadReviews();
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
  if (name === "points") loadSpecialPoints(options.pointSessionId || null);
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
