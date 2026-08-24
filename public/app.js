const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  accessKey: sessionStorage.getItem("lineOrderDashboardKey") || "",
  dashboard: null,
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
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP_${response.status}`);
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
  toast.timer = setTimeout(() => el.classList.add("hidden"), 3200);
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
  return state.dashboard?.summary_groups?.find((g) => g.id === id)?.name || id;
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

async function loadReviews() {
  const list = $("#reviewList");
  list.innerHTML = `<div class="empty">กำลังโหลด...</div>`;
  try {
    const payload = await api(`/api/reviews?${selectedQuery()}`);
    if (!payload.items.length) {
      list.innerHTML = `<div class="empty">ไม่มีรายการ Review ที่เปิดอยู่</div>`;
      return;
    }
    list.innerHTML = payload.items.map((item) => {
      const reasons = (item.reason_codes || []).map((r) => `${r.code}${r.detail ? ` — ${r.detail}` : ""}`).join("<br>");
      return `
        <article class="review-card">
          <div class="review-meta">
            <span>${escapeHtml(item.line_group_name)}</span>
            <span>${escapeHtml(item.message_type)}</span>
            <span>${escapeHtml(formatBangkokTime(item.created_at))}</span>
            <span>${escapeHtml(item.user_id || "ไม่ทราบผู้ส่ง")}</span>
          </div>
          <pre class="review-text">${escapeHtml(item.text || "(ไม่มีข้อความ)")}</pre>
          <div class="reason">${reasons || "ต้องตรวจสอบ"}</div>
        </article>`;
    }).join("");
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

async function loadDashboard() {
  refreshButton.disabled = true;
  refreshButton.textContent = "กำลังอัปเดต...";
  try {
    const payload = await api(`/api/dashboard?${selectedQuery()}`);
    state.dashboard = payload;

    if (!businessDateInput.value) businessDateInput.value = payload.business_date;
    if (!state.groupsLoaded) {
      for (const group of payload.summary_groups) {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        summaryGroupSelect.append(option);
      }
      state.groupsLoaded = true;
    }

    renderMetrics(payload.metrics);
    renderSummary(payload.summary);
    renderAllocation(payload.allocation);

    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "review") await loadReviews();
    if (activeTab === "unsend") await loadUnsends();
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

if (state.accessKey) {
  showApp();
  loadDashboard();
} else {
  showLogin();
}
