const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  accessKey: sessionStorage.getItem("lineOrderDashboardKey") || "",
  dashboard: null,
  settings: null,
  groupsLoaded: false,
};

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

function renderMetrics(metrics) {
  const cards = [
    ["ยอดรับทั้งหมด", metrics.order_total, false],
    ["Active", metrics.active_equivalent, false],
    ["Unsend", metrics.unsent_qty, metrics.unsent_qty > 0],
    ["ต้องตัดเพิ่ม", metrics.transfer_now_total, metrics.transfer_now_total > 0],
    ["ข้อความ", metrics.messages_total, false],
    ["Review", metrics.review_open, metrics.review_open > 0],
  ];
  $("#metrics").innerHTML = cards.map(([label, value, alert]) => `
    <article class="metric ${alert ? "alert" : ""}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${formatNumber(value)}</div>
    </article>
  `).join("");
  $("#reviewBadge").textContent = formatNumber(metrics.review_open);
  $("#unsendBadge").textContent = formatNumber(metrics.unsend_count);
  $("#freshness").textContent = `ข้อมูลล่าสุด: ${formatBangkokTime(metrics.last_event_at)} · Pending ${formatNumber(metrics.pending)}`;
}

function groupName(id) {
  return state.dashboard?.summary_groups?.find((g) => g.id === id)?.name
    || state.settings?.summary_groups?.find((g) => g.id === id)?.name
    || id;
}

function renderSummary(rows) {
  const body = $("#summaryBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">ยังไม่มีออเดอร์ในช่วงที่เลือก</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(groupName(row.summary_group_id))}</td>
      <td><strong>${escapeHtml(row.category)}</strong></td>
      <td><strong>${escapeHtml(row.code)}</strong></td>
      <td class="num">${formatNumber(row.order_total)}</td>
      <td class="num">${formatNumber(row.unsent_qty)}</td>
      <td class="num">${formatNumber(row.active_equivalent)}</td>
    </tr>
  `).join("");
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
    return `
      <tr>
        <td>${escapeHtml(groupName(row.summary_group_id))}</td>
        <td><strong>${escapeHtml(row.category)}</strong></td>
        <td><strong>${escapeHtml(row.code)}</strong></td>
        <td class="num">${formatNumber(row.order_total)}</td>
        <td class="num">${formatNumber(row.threshold)}</td>
        <td class="num">${formatNumber(row.should_transfer)}</td>
        <td class="num">${formatNumber(row.confirmed_transfer)}</td>
        <td class="num"><span class="status-pill ${required ? "required" : ""}">${formatNumber(row.transfer_now)}</span></td>
        <td>${escapeHtml(row.destination || "-")}</td>
        <td>${required ? `<button class="button primary small confirm-transfer" data-group="${escapeHtml(row.summary_group_id)}" data-category="${escapeHtml(row.category)}" data-code="${escapeHtml(row.code)}" data-qty="${escapeHtml(row.transfer_now)}">ยืนยันตัด ${formatNumber(row.transfer_now)}</button>` : ""}</td>
      </tr>`;
  }).join("");
  $$(".confirm-transfer").forEach((button) => button.addEventListener("click", confirmTransfer));
}

async function confirmTransfer(event) {
  const button = event.currentTarget;
  const qty = button.dataset.qty;
  const label = `${button.dataset.category}${button.dataset.code}`;
  if (!window.confirm(`ยืนยันว่าได้ตัด ${label} จำนวน ${formatNumber(qty)} แล้ว?`)) return;
  button.disabled = true;
  try {
    await api("/api/confirm-transfer", {
      method: "POST",
      body: JSON.stringify({
        business_date: businessDateInput.value,
        summary_group_id: button.dataset.group,
        category: button.dataset.category,
        code: button.dataset.code,
      }),
    });
    toast(`ยืนยันตัด ${label} จำนวน ${formatNumber(qty)} แล้ว`);
    await loadDashboard();
  } catch (error) {
    toast(`ยืนยันไม่สำเร็จ: ${error.message}`, true);
  } finally {
    button.disabled = false;
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
    if (!payload.items.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">ไม่มี Unsend ในช่วงที่เลือก</td></tr>`;
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
  const groups = state.settings?.summary_groups || [];
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
    <div class="settings-row"><span><strong>${escapeHtml(row.line_group_name)}</strong><small>${escapeHtml(row.line_group_id)}</small></span><span>${escapeHtml(groupName(row.summary_group_id))} · ${row.enabled ? "ใช้งาน" : "ปิด"}</span><button class="button ghost small edit-line" data-id="${escapeHtml(row.line_group_id)}">แก้ไข</button></div>`).join("");

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
    form.elements.line_group_id.value = row.line_group_id; form.elements.line_group_name.value = row.line_group_name; setSummaryOptions(form.elements.summary_group_id, row.summary_group_id); form.elements.enabled.checked = row.enabled;
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
    saveSetting("LINE_GROUP", { line_group_id: f.elements.line_group_id.value, line_group_name: f.elements.line_group_name.value, summary_group_id: f.elements.summary_group_id.value, enabled: f.elements.enabled.checked }, f);
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

async function loadDashboard() {
  refreshButton.disabled = true;
  refreshButton.textContent = "กำลังอัปเดต...";
  try {
    const payload = await api(`/api/dashboard?${selectedQuery()}`);
    state.dashboard = payload;
    if (!businessDateInput.value) businessDateInput.value = payload.business_date;
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
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "review") await loadReviews();
    if (activeTab === "unsend") await loadUnsends();
    if (activeTab === "settings") await loadSettings();
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
  if (name === "review") loadReviews();
  if (name === "unsend") loadUnsends();
  if (name === "settings") loadSettings();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.accessKey = accessKeyInput.value.trim();
  sessionStorage.setItem("lineOrderDashboardKey", state.accessKey);
  loginError.classList.add("hidden");
  showApp();
  await loadDashboard();
});

logoutButton.addEventListener("click", () => {
  sessionStorage.removeItem("lineOrderDashboardKey");
  state.accessKey = "";
  accessKeyInput.value = "";
  showLogin();
});

refreshButton.addEventListener("click", loadDashboard);
businessDateInput.addEventListener("change", loadDashboard);
summaryGroupSelect.addEventListener("change", loadDashboard);
$$(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
bindSettingForms();

if (state.accessKey) {
  showApp();
  loadDashboard();
} else {
  showLogin();
}
