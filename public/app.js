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
  promotionDrafts: [],
};

const FRESHNESS_POLL_MS = 5_000;

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
  $$(".confirm-transfer").forEach((button) => {
    button.disabled = state.dashboardStale;
    button.closest("tr")?.classList.toggle("row-stale", state.dashboardStale);
  });
}

function stopFreshnessPolling() {
  if (state.freshnessTimer) clearInterval(state.freshnessTimer);
  state.freshnessTimer = null;
}

async function checkFreshness() {
  if (!state.accessKey || !state.dashboard || state.freshnessPollBusy || state.dashboardStale) return;
  state.freshnessPollBusy = true;
  try {
    const payload = await api(`/api/dashboard-freshness?${selectedQuery()}`);
    if (state.freshnessVersion != null && payload.freshness?.version !== state.freshnessVersion) {
      const activeTab = $(".tab.active")?.dataset.tab;
      if (activeTab === "summary") {
        await loadDashboard();
      } else if (activeTab === "report") {
        state.freshnessVersion = payload.freshness?.version ?? state.freshnessVersion;
        await loadReport();
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
    ["ยอดรับทั้งหมด", metrics.order_total, false],
    ["ต้องตัดเพิ่ม", metrics.transfer_now_total, metrics.transfer_now_total > 0],
    ["ข้อความ", metrics.messages_total, false],
    ["Review", metrics.review_open, metrics.review_open > 0],
  ];
  $("#metrics").innerHTML = cards.map(([label, value, alert]) => `
    <article class="metric ${alert ? "alert" : ""}"><div class="label">${escapeHtml(label)}</div><div class="value">${formatNumber(value)}</div></article>`).join("");
  $("#reviewBadge").textContent = formatNumber(metrics.review_open);
  $("#freshness").textContent = `ข้อมูลล่าสุด: ${formatBangkokTime(metrics.last_event_at)} · Pending ${formatNumber(metrics.pending)}`;
}

function groupName(id) {
  return state.dashboard?.summary_groups?.find((g) => g.id === id)?.name
    || state.settings?.summary_groups?.find((g) => g.id === id)?.name
    || id;
}

function renderSummary(rows) {
  const board = $("#summaryBoard");
  if (!rows.length) { board.innerHTML = `<div class="empty">ยังไม่มีออเดอร์ในชุดยอดปัจจุบัน</div>`; return; }
  const allocationMap = new Map((state.dashboard?.allocation || []).map((r) => [`${r.summary_group_id}|${r.category}|${r.code}`, r]));
  const byCategory = new Map();
  for (const row of rows) { if (!byCategory.has(row.category)) byCategory.set(row.category, []); byCategory.get(row.category).push(row); }
  board.innerHTML = [...byCategory.entries()].map(([category, items]) => `
    <section class="category-board">
      <div class="category-heading"><h3>หมวด ${escapeHtml(category)}</h3><span>เรียงยอดมาก → น้อย</span></div>
      <div class="code-stack">${items.sort((a,b)=>Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code)).map(row => {
        const allocation = allocationMap.get(`${row.summary_group_id}|${row.category}|${row.code}`);
        const threshold = Number(allocation?.threshold || 0);
        const total = Number(row.order_total || 0);
        const remainderPct = threshold > 0 ? Math.min(100, ((total % threshold) / threshold) * 100) : 0;
        const segments = threshold > 0 ? Math.floor(total / threshold) : 0;
        const special = row.special_point_multiplier ? `<span class="point-badge">★ ×${formatNumber(row.special_point_multiplier)}</span>` : "";
        const promo = allocation?.promotion_override ? `<span class="promo-badge">PROMO T${formatNumber(threshold)}</span>` : `<span class="threshold-label">T${formatNumber(threshold)}</span>`;
        const transfer = Number(allocation?.transfer_now || 0) > 0 ? `<strong class="transfer-due">ตัดเพิ่ม ${formatNumber(allocation.transfer_now)}</strong>` : "";
        const thresholdClass = Number(allocation?.transfer_now || 0) > 0 ? "threshold-due" : (segments >= 1 ? "threshold-ready" : "threshold-low");
        return `<article class="code-card ${thresholdClass} ${allocation?.promotion_override ? "is-promo" : ""}">
          <div class="code-main"><div><span class="code-label">${escapeHtml(category)} ${escapeHtml(row.code)}</span>${special}</div><strong class="code-total">${formatNumber(total)}</strong></div>
          <div class="code-meta">${promo}${transfer}<span>${escapeHtml(groupName(row.summary_group_id))}</span></div>
          <div class="threshold-track" title="Threshold ${formatNumber(threshold)}"><div class="threshold-fill" style="width:${remainderPct}%"></div></div>
          <div class="threshold-caption">ผ่าน ${formatNumber(segments)} Threshold${allocation?.destination ? ` · ${escapeHtml(allocation.destination)}` : ""}</div>
        </article>`;
      }).join("")}</div>
    </section>`).join("");
}

function renderAllocation(rows) {
  const body = $("#allocationBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10" class="empty">ยังไม่มีกฎ Allocation หรือยังไม่มีออเดอร์</td></tr>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => Number(b.transfer_now) - Number(a.transfer_now) || a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
  body.innerHTML = sorted.map((row) => {
    const required = Number(row.transfer_now) > 0;
    const canConfirm = required && row.confirmation_token;
    return `
      <tr class="${state.dashboardStale && required ? "row-stale" : ""}">
        <td>${escapeHtml(groupName(row.summary_group_id))}</td>
        <td><strong>${escapeHtml(row.category)}</strong></td>
        <td><strong>${escapeHtml(row.code)}</strong></td>
        <td class="num">${formatNumber(row.order_total)}</td>
        <td class="num">${formatNumber(row.threshold)}</td>
        <td class="num">${formatNumber(row.should_transfer)}</td>
        <td class="num">${formatNumber(row.confirmed_transfer)}</td>
        <td class="num"><span class="status-pill ${required ? "required" : ""}">${formatNumber(row.transfer_now)}</span></td>
        <td>${escapeHtml(row.destination || "-")}</td>
        <td>${canConfirm ? `<button class="button primary small confirm-transfer" data-token="${escapeHtml(row.confirmation_token)}" data-category="${escapeHtml(row.category)}" data-code="${escapeHtml(row.code)}" data-qty="${escapeHtml(row.transfer_now)}" data-destination="${escapeHtml(row.destination || "-")}" ${state.dashboardStale ? "disabled" : ""}>ยืนยันตัด ${formatNumber(row.transfer_now)}</button>` : ""}</td>
      </tr>`;
  }).join("");
  $$(".confirm-transfer").forEach((button) => button.addEventListener("click", confirmTransfer));
}

async function loadAllocationHistory() {
  const body = $("#allocationHistoryBody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="8" class="empty">กำลังโหลด...</td></tr>`;
  try {
    const payload = await api(`/api/allocation-history?${selectedQuery()}`);
    if (!payload.items.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty">ยังไม่มีประวัติการยืนยันตัดยอดในช่วงที่เลือก</td></tr>`;
      return;
    }
    body.innerHTML = payload.items.map((item) => `
      <tr>
        <td>${escapeHtml(formatBangkokTime(item.confirmed_at))}</td>
        <td>${escapeHtml(groupName(item.summary_group_id))}</td>
        <td><strong>${escapeHtml(item.category)}${escapeHtml(item.code)}</strong></td>
        <td class="num"><strong>${formatNumber(item.delta_confirmed)}</strong></td>
        <td class="num">${formatNumber(item.previous_confirmed)} → ${formatNumber(item.new_confirmed)}</td>
        <td class="num">${item.order_total == null ? "-" : formatNumber(item.order_total)}</td>
        <td>${escapeHtml(item.destination || "-")}</td>
        <td>${escapeHtml(item.confirmed_by || "-")}</td>
      </tr>`).join("");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="8" class="empty">โหลดประวัติไม่สำเร็จ</td></tr>`;
    toast(`โหลดประวัติตัดยอดไม่สำเร็จ: ${error.message}`, true);
  }
}

async function confirmTransfer(event) {
  const button = event.currentTarget;
  const qty = Number(button.dataset.qty || 0);
  const label = `${button.dataset.category}${button.dataset.code}`;
  if (state.dashboardStale) {
    toast("มีข้อมูลใหม่ กรุณาอัปเดต Dashboard ก่อนยืนยันตัดยอด", true);
    return;
  }
  if (!button.dataset.token) {
    toast("ข้อมูลยืนยันไม่พร้อม กรุณาอัปเดต Dashboard", true);
    setDashboardStale(true);
    return;
  }
  if (!window.confirm(`ยืนยันว่าได้ตัด ${label} จำนวน ${formatNumber(qty)} ไปยัง ${button.dataset.destination || "-"} แล้ว?`)) return;
  button.disabled = true;
  try {
    const payload = await api("/api/confirm-transfer", {
      method: "POST",
      body: JSON.stringify({ confirmation_token: button.dataset.token }),
    });
    if (payload.allocation?.idempotent) {
      toast(`คำขอยืนยัน ${label} นี้ถูกบันทึกไว้แล้ว ระบบไม่บันทึกซ้ำ`);
    } else {
      toast(`ยืนยันตัด ${label} จำนวน ${formatNumber(payload.allocation?.delta_confirmed ?? qty)} แล้ว`);
    }
    await loadDashboard();
  } catch (error) {
    if (["ALLOCATION_STALE", "CONFIRMATION_EXPIRED", "NO_TRANSFER_REQUIRED"].includes(error.message)) {
      setDashboardStale(true);
      toast("ยอดหรือสถานะเปลี่ยนแล้ว กรุณาอัปเดต Dashboard ก่อนยืนยันอีกครั้ง", true);
    } else {
      toast(`ยืนยันไม่สำเร็จ: ${error.message}`, true);
    }
  } finally {
    if (!state.dashboardStale && document.body.contains(button)) button.disabled = false;
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
      <div class="preview-heading">ผลตรวจ: <strong>${escapeHtml(preview.status)}</strong></div>
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
  clearReviewPreview(card, "ข้อความถูกแก้หลังจากตรวจผลแล้ว กรุณากด “ตรวจผล Parser” ใหม่ก่อนยืนยัน");
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
    clearReviewPreview(card, "ผล Preview ไม่ตรงกับข้อความปัจจุบัน กรุณาตรวจผล Parser ใหม่");
    toast("กรุณาตรวจผล Parser ใหม่ก่อนยืนยัน", true);
    return;
  }
  if (!window.confirm("ยืนยันใช้ผล Parser ที่เห็นนี้แทนข้อมูลเดิม? ยอดจากข้อความนี้จะถูกสร้างใหม่ตามผล Preview")) return;
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
      clearReviewPreview(card, "ผล Preview หมดอายุหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจผล Parser ใหม่ก่อนยืนยัน");
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
          <button class="button primary small preview-review">ตรวจผล Parser</button>
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
    const form = $("#lineGroupForm");
    form.elements.line_group_id.value = button.dataset.id;
    form.elements.line_group_name.focus();
  }));

  setSummaryOptions($("#lineGroupForm").elements.summary_group_id);
  setSummaryOptions($("#allocationRuleForm").elements.summary_group_id);

  $("#summaryGroupsList").innerHTML = s.summary_groups.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-summary" data-id="${escapeHtml(row.id)}">แก้ไข</button></div>`).join("");

  $("#lineGroupsList").innerHTML = s.line_groups.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.line_group_name)}</strong><small>${escapeHtml(row.line_group_id)}</small></span><span>${escapeHtml(groupName(row.summary_group_id))} · ลด ${formatNumber(row.reduction_pct || 0)}% · ${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-line" data-id="${escapeHtml(row.line_group_id)}">แก้ไข</button></div>`).join("");

  $("#allocationRulesList").innerHTML = s.allocation_rules.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(groupName(row.summary_group_id))} / ${escapeHtml(row.category)}</strong><small>Threshold ${formatNumber(row.threshold)} · ${escapeHtml(row.destination || "ไม่ระบุปลายทาง")}</small></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-allocation" data-key="${escapeHtml(row.summary_group_id)}|${escapeHtml(row.category)}">แก้ไข</button></div>`).join("");

  $("#aliasesList").innerHTML = s.category_aliases.map((row) => `
    <div class="settings-row"><span><strong>${escapeHtml(row.alias)} → ${escapeHtml(row.canonical_category)}</strong></span><span>${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-alias" data-id="${escapeHtml(row.alias)}">แก้ไข</button></div>`).join("");

  $$(".edit-summary").forEach((button) => button.addEventListener("click", () => {
    const row = s.summary_groups.find((x) => x.id === button.dataset.id);
    const form = $("#summaryGroupForm");
    form.elements.id.value = row.id; form.elements.name.value = row.name; form.elements.enabled.checked = row.enabled;
  }));
  $$(".edit-line").forEach((button) => button.addEventListener("click", () => {
    const row = s.line_groups.find((x) => x.line_group_id === button.dataset.id);
    const form = $("#lineGroupForm");
    form.elements.line_group_id.value = row.line_group_id; form.elements.line_group_name.value = row.line_group_name; setSummaryOptions(form.elements.summary_group_id, row.summary_group_id); form.elements.reduction_pct.value = row.reduction_pct || 0; form.elements.enabled.checked = row.enabled;
  }));
  $$(".edit-allocation").forEach((button) => button.addEventListener("click", () => {
    const [group, category] = button.dataset.key.split("|");
    const row = s.allocation_rules.find((x) => x.summary_group_id === group && x.category === category);
    const form = $("#allocationRuleForm");
    setSummaryOptions(form.elements.summary_group_id, row.summary_group_id); form.elements.category.value = row.category; form.elements.threshold.value = row.threshold; form.elements.destination.value = row.destination || ""; form.elements.enabled.checked = row.enabled;
  }));
  $$(".edit-alias").forEach((button) => button.addEventListener("click", () => {
    const row = s.category_aliases.find((x) => x.alias === button.dataset.id);
    const form = $("#aliasForm");
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
  $("#allocationRuleForm").addEventListener("submit", (event) => {
    event.preventDefault(); const f = event.currentTarget;
    saveSetting("ALLOCATION_RULE", { summary_group_id: f.elements.summary_group_id.value, category: f.elements.category.value, threshold: Number(f.elements.threshold.value), destination: f.elements.destination.value, enabled: f.elements.enabled.checked }, f);
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

function renderPromotionDrafts() {
  const list = $("#promotionDraftList");
  if (!state.promotionDrafts.length) { list.innerHTML = `<div class="muted">ไม่มี Promotion override — ใช้ Threshold ปกติ</div>`; return; }
  list.innerHTML = state.promotionDrafts.map((r,i)=>`<div class="settings-row"><span><strong>${escapeHtml(r.summary_group_id)} / ${escapeHtml(r.category)}${escapeHtml(r.code)}</strong><small>T${formatNumber(r.threshold)}${r.destination?` · ${escapeHtml(r.destination)}`:""}</small></span><button class="button ghost small remove-promo" data-i="${i}">ลบ</button></div>`).join("");
  $$(".remove-promo").forEach(b=>b.addEventListener("click",()=>{state.promotionDrafts.splice(Number(b.dataset.i),1);renderPromotionDrafts();}));
}

function renderSettlementStatus(payload) {
  state.settlement = payload;
  const open = payload.open_session;
  $("#prepareOpenButton").classList.toggle("hidden", Boolean(open));
  $("#closeSettlementButton").classList.toggle("hidden", !open);
  if (open) {
    businessDateInput.value = open.business_date;
    businessDateInput.disabled = true;
    $("#settlementStatus").textContent = `เปิดยอดอยู่ · ${open.business_date}`;
    $("#settlementMeta").textContent = `เริ่ม ${formatBangkokTime(open.opened_at)} · Promotion ${formatNumber((payload.promotions||[]).length)} รหัส`;
    $("#openSettlementEditor").classList.add("hidden");
  } else {
    businessDateInput.disabled = false;
    if (!businessDateInput.value) businessDateInput.value = todayBangkok();
    $("#settlementStatus").textContent = "ยังไม่ได้เปิดยอด";
    $("#settlementMeta").textContent = "กำหนด Promotion ก่อนเปิดยอดได้ เมื่อเปิดแล้วจะเริ่มนับใหม่จาก 0 แม้เป็นวันที่เดิม";
  }
}

async function loadSettlement() {
  const payload = await api("/api/settlement");
  renderSettlementStatus(payload);
  const select = $("#reportSessionSelect");
  const sessions = [payload.open_session, ...(payload.closed_sessions||[])].filter(Boolean);
  select.innerHTML = sessions.map(s=>`<option value="${escapeHtml(s.id)}">${s.status==="OPEN"?"ยอดปัจจุบัน":"ปิด "+formatBangkokTime(s.closed_at)} · ${escapeHtml(s.business_date)}</option>`).join("") || `<option value="">ยังไม่มีรายงาน</option>`;
  const lineSelect=$("#reportLineGroupSelect");
  const lines=state.dashboard?.line_groups||[];
  lineSelect.innerHTML=`<option value="ALL">ทุก LINE Group</option>`+lines.map(g=>`<option value="${escapeHtml(g.line_group_id)}">${escapeHtml(g.line_group_name)}</option>`).join("");
  return payload;
}

async function openSettlement() {
  const date = businessDateInput.value || todayBangkok();
  if (!window.confirm(`เปิดยอดใหม่วันที่ ${date}?\nยอดรับ, Allocation และลำดับข้อความจะเริ่มจาก 0`)) return;
  $("#openSettlementButton").disabled = true;
  try {
    await api("/api/settlement", { method:"POST", body:JSON.stringify({ action:"OPEN", business_date:date, promotions:state.promotionDrafts }) });
    state.promotionDrafts=[]; renderPromotionDrafts(); toast("เปิดยอดใหม่แล้ว เริ่มนับจาก 0");
    await loadSettlement(); await loadDashboard();
  } catch(error) { toast(`เปิดยอดไม่สำเร็จ: ${error.message}`,true); }
  finally { $("#openSettlementButton").disabled=false; }
}

async function closeSettlement() {
  const open = state.settlement?.open_session;
  if (!open) return;
  let summaryText = "";
  try {
    const report = await api(`/api/accounting-report?session_id=${encodeURIComponent(open.id)}`);
    const received = (report.groups||[]).reduce((s,g)=>s+Number(g.received_total||0),0);
    const special = (report.groups||[]).reduce((s,g)=>s+Number(g.special_point_total||0),0);
    summaryText = `\nยอดรับรวม ${formatNumber(received)}\nPoint พิเศษรวม ${formatNumber(special)}`;
  } catch {}
  if (!window.confirm(`ปิดยอดปัจจุบัน?${summaryText}\n\nข้อมูลชุดนี้จะไม่ถูกนำไปสะสมกับยอดที่เปิดใหม่ และจะไม่สามารถแก้ Point พิเศษของชุดนี้ได้`)) return;
  $("#closeSettlementButton").disabled=true;
  try {
    await api("/api/settlement", {method:"POST",body:JSON.stringify({action:"CLOSE",settlement_session_id:open.id})});
    toast("ปิดยอดแล้ว สามารถเปิดยอดใหม่วันที่เดิมได้ทันที");
    await loadSettlement(); await loadDashboard();
  } catch(error){toast(`ปิดยอดไม่สำเร็จ: ${error.message}`,true);}
  finally{$("#closeSettlementButton").disabled=false;}
}

function renderSpecialPoints() {
  const list=$("#specialPointRules");
  if(!state.specialPointRules.length){list.innerHTML=`<div class="muted">ยังไม่มีรหัส Point พิเศษในชุดนี้ ทุกสินค้าเป็น Point ปกติ ×1</div>`;return;}
  list.innerHTML=state.specialPointRules.map((r,i)=>`<div class="settings-row"><span><strong>★ ${escapeHtml(r.category)}${escapeHtml(r.code)}</strong><small>×${formatNumber(r.multiplier)} Point</small></span><button class="button ghost small remove-point" data-i="${i}">ลบ</button></div>`).join("");
  $$(".remove-point").forEach(b=>b.addEventListener("click",()=>{state.specialPointRules.splice(Number(b.dataset.i),1);renderSpecialPoints();}));
}

async function loadSpecialPoints() {
  const payload=await api("/api/special-points");
  state.specialPointRules=(payload.rules||[]).map(r=>({category:r.category,code:r.code,multiplier:Number(r.multiplier)}));
  renderSpecialPoints();
  $("#specialPointForm").querySelectorAll("input,select,button").forEach(el=>{el.disabled=!payload.open_session;});
  $("#saveSpecialPointsButton").disabled=!payload.open_session;
}

async function saveSpecialPoints() {
  try { await api("/api/special-points",{method:"POST",body:JSON.stringify({rules:state.specialPointRules})}); toast("บันทึก Point พิเศษแล้ว ระบบคำนวณย้อนหลังทั้งชุดปัจจุบัน"); await loadDashboard(); await loadReport(); }
  catch(error){toast(`บันทึก Point ไม่สำเร็จ: ${error.message}`,true);}
}

function renderReport(payload) {
  const root=$("#reportContent");
  if(!payload.session){root.innerHTML=`<div class="empty">ยังไม่มีชุดยอดสำหรับรายงาน</div>`;return;}
  if(!payload.groups.length){root.innerHTML=`<div class="empty">ยังไม่มีข้อมูลในชุดยอดนี้</div>`;return;}
  root.innerHTML=`<div class="report-session-heading"><strong>รายงานประจำวัน ${escapeHtml(formatThaiDate(payload.session.business_date))}</strong><span>${payload.session.status === "OPEN" ? "ยอดปัจจุบัน" : `ปิด ${escapeHtml(formatBangkokTime(payload.session.closed_at))}`}</span></div>` + payload.groups.map(g=>`<section class="report-card">
    <div class="report-title"><div><h3>${escapeHtml(g.line_group_name)}</h3><span>${escapeHtml(groupName(g.summary_group_id))}</span></div><span>${formatNumber(g.message_count)} ข้อความ</span></div>
    <div class="report-metrics"><div><span>ยอดรับจริง</span><strong>${formatNumber(g.received_total)}</strong></div><div><span>ลด</span><strong>${formatNumber(g.reduction_pct)}%</strong></div><div><span>ยอดหลังลด</span><strong>${formatNumber(g.after_reduction)}</strong></div><div><span>Point พิเศษ</span><strong>${formatNumber(g.special_point_total)}</strong></div><div class="net"><span>ยอดสุทธิเทียบ</span><strong>${formatNumber(g.reconciliation_total)}</strong></div></div>
    <div class="special-summary"><h4>สรุปรหัส Point พิเศษ</h4>${g.special_point_codes.length?`<div class="table-wrap"><table><thead><tr><th>รหัส</th><th class="num">จำนวนรวม</th><th class="num">ตัวคูณ</th><th class="num">Point</th></tr></thead><tbody>${g.special_point_codes.map(x=>`<tr><td><strong>${escapeHtml(x.category)}${escapeHtml(x.code)}</strong></td><td class="num">${formatNumber(x.quantity)}</td><td class="num">×${formatNumber(x.multiplier)}</td><td class="num">${formatNumber(x.points)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="muted">ไม่มี Point พิเศษ</div>`}</div>
    <div class="table-wrap"><table><thead><tr><th>ลำดับ</th><th>เวลา</th><th class="num">สรุปจำนวน</th><th>Point พิเศษ</th></tr></thead><tbody>${g.ledger.map(row=>`<tr><td>${String(row.sequence).padStart(3,"0")}</td><td>${escapeHtml(new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(row.event_timestamp)))}</td><td class="num"><strong>${formatNumber(row.summary_quantity)}</strong></td><td>${row.special_points.length?`★ ${row.special_points.map(x=>`${escapeHtml(x.category)}${escapeHtml(x.code)}=${formatNumber(x.quantity)} ×${formatNumber(x.multiplier)}`).join(", ")}`:""}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="2">รวม</th><th class="num">${formatNumber(g.received_total)}</th><th></th></tr></tfoot></table></div>
  </section>`).join("");
}

async function loadReport() {
  const sessionId=$("#reportSessionSelect").value || state.settlement?.open_session?.id;
  if(!sessionId){renderReport({session:null,groups:[]});return;}
  try { const payload=await api(`/api/accounting-report?session_id=${encodeURIComponent(sessionId)}&group=${encodeURIComponent(summaryGroupSelect.value||"ALL")}&line_group=${encodeURIComponent($("#reportLineGroupSelect").value||"ALL")}`); renderReport(payload); }
  catch(error){$("#reportContent").innerHTML=`<div class="empty">โหลดรายงานไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;}
}

function bindV5Controls() {
  $("#prepareOpenButton").addEventListener("click",()=>{
    $("#openSettlementEditor").classList.remove("hidden");
    setSummaryOptions($("#promotionDraftForm").elements.summary_group_id);
    renderPromotionDrafts();
  });
  $("#cancelOpenSettlementButton").addEventListener("click",()=>$("#openSettlementEditor").classList.add("hidden"));
  $("#promotionDraftForm").addEventListener("submit",event=>{event.preventDefault();const f=event.currentTarget;const rule={summary_group_id:f.elements.summary_group_id.value,category:f.elements.category.value,code:f.elements.code.value.trim(),threshold:Number(f.elements.threshold.value),destination:f.elements.destination.value.trim()||null};const existing=state.promotionDrafts.findIndex(x=>x.summary_group_id===rule.summary_group_id&&x.category===rule.category&&x.code===rule.code);if(existing>=0)state.promotionDrafts[existing]=rule;else state.promotionDrafts.push(rule);f.elements.code.value="";f.elements.threshold.value="";f.elements.destination.value="";renderPromotionDrafts();});
  $("#openSettlementButton").addEventListener("click",openSettlement);
  $("#closeSettlementButton").addEventListener("click",closeSettlement);
  $("#specialPointForm").addEventListener("submit",event=>{event.preventDefault();const f=event.currentTarget;const rule={category:f.elements.category.value,code:f.elements.code.value.trim(),multiplier:Number(f.elements.multiplier.value)};const existing=state.specialPointRules.findIndex(x=>x.category===rule.category&&x.code===rule.code);if(existing>=0)state.specialPointRules[existing]=rule;else state.specialPointRules.push(rule);f.elements.code.value="";f.elements.multiplier.value="";renderSpecialPoints();});
  $("#saveSpecialPointsButton").addEventListener("click",saveSpecialPoints);
  $("#reportSessionSelect").addEventListener("change",loadReport);
  $("#reportLineGroupSelect").addEventListener("change",loadReport);
}

async function loadDashboard() {
  refreshButton.disabled = true;
  refreshButton.textContent = "กำลังอัปเดต...";
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
    renderSummary(payload.summary);
    renderAllocation(payload.allocation);
    await loadSettlement();
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "allocation") await loadAllocationHistory();
    if (activeTab === "review") await loadReviews();
    if (activeTab === "unsend") await loadUnsends();
    if (activeTab === "settings") await loadSettings();
    if (activeTab === "points") await loadSpecialPoints();
    if (activeTab === "report") await loadReport();
  } catch (error) {
    if (error.message !== "UNAUTHORIZED") toast(`โหลด Dashboard ไม่สำเร็จ: ${error.message}`, true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "อัปเดต ณ ตอนนี้";
  }
}

function activateTab(name) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  $(`#${name}Tab`).classList.remove("hidden");
  if (name === "allocation") loadAllocationHistory();
  if (name === "review") loadReviews();
  if (name === "unsend") loadUnsends();
  if (name === "settings") loadSettings();
  if (name === "points") loadSpecialPoints();
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
summaryGroupSelect.addEventListener("change", async () => { await loadDashboard(); if ($(".tab.active")?.dataset.tab === "report") await loadReport(); });
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
