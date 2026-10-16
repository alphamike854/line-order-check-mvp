import {
  CATEGORIES, formatQty, parsePositiveLimit,
  buildCeilingReport, buildAnnouncement,
} from './supervisor-category-ceiling-calc.js';
import { CODE_ROW_LIMIT, selectCodeRows } from './supervisor-code-collapse.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'locSupervisorCategoryCeilingKeyV2';
const PREF_KEY_PREFIX = 'locSupervisorCategoryCeilingPreferencesV2:';
let accessKey = sessionStorage.getItem(STORAGE_KEY) || '';
let snapshot = null;
let preferences = {};
let selectedGroupIds = null; // null = all enabled groups; [] = none
let availableGroups = [];
const expandedCodeCategories = new Set();
function status(text) { $('status').textContent = text; }
function elem(tag, cls = '', text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
function preferencesKey() {
  const ids = (snapshot?.selected_group_ids || []).slice().sort();
  return PREF_KEY_PREFIX + snapshot.business_date + ':' + ids.join(',');
}
function restorePreferences() {
  let stored = sessionStorage.getItem(preferencesKey());
  // Preserve existing V2 per-day manual limits for the default ALL scope only.
  if (!stored && snapshot.selected_group_ids.length === snapshot.available_groups.length) {
    stored = sessionStorage.getItem(PREF_KEY_PREFIX + snapshot.business_date);
  }
  try { preferences = JSON.parse(stored || '{}'); }
  catch { preferences = {}; }
}
function savePreferences() { sessionStorage.setItem(preferencesKey(), JSON.stringify(preferences)); }
function categoryPreferences(category) {
  if (!preferences[category] || typeof preferences[category] !== 'object') preferences[category] = {};
  if (!preferences[category].codeCaps || typeof preferences[category].codeCaps !== 'object') {
    preferences[category].codeCaps = {};
  }
  return preferences[category];
}
function money(value) { return formatQty(value); }
function clearReport(message) {
  snapshot = null;
  $('categories').replaceChildren();
  $('copy').disabled = true;
  $('announcement').textContent = message;
  $('coverage').textContent = '';
  $('warning').classList.add('hidden');
  $('warning').textContent = '';
}
function renderGroupSelector() {
  const container = $('groupOptions');
  container.replaceChildren();
  const selected = new Set(selectedGroupIds === null
    ? availableGroups.map(g => g.id) : selectedGroupIds);
  for (const group of availableGroups) {
    const label = elem('label', 'group-option');
    const checkbox = elem('input'); checkbox.type = 'checkbox';
    checkbox.checked = selected.has(group.id);
    checkbox.addEventListener('change', () => {
      const next = new Set(selectedGroupIds === null
        ? availableGroups.map(g => g.id) : selectedGroupIds);
      if (checkbox.checked) next.add(group.id); else next.delete(group.id);
      const ids = availableGroups.map(g => g.id).filter(id => next.has(id));
      selectedGroupIds = ids.length === availableGroups.length ? null : ids;
      renderGroupSelector();
      load();
    });
    label.append(checkbox, document.createTextNode(
      group.name === group.id ? group.id : `${group.id} · ${group.name}`));
    container.append(label);
  }
  $('groupSelectionCount').textContent =
    `เลือก ${selected.size}/${availableGroups.length} กลุ่มสรุป`;
  $('selectAllGroups').disabled = selected.size === availableGroups.length;
}
function render() {
  if (!snapshot) return;
  const cats = buildCeilingReport(snapshot.rows, snapshot.profiles, preferences);
  $('day').textContent = `ข้อมูลวันที่ ${snapshot.business_date}`;
  $('freshness').textContent = `อ่านข้อมูลล่าสุดเมื่อ ${new Date(snapshot.fetched_at).toLocaleString('th-TH')}`;
  const included = snapshot.scope.filter(r => r.included);
  $('coverage').textContent = `ข้อมูลครบ ${included.length}/${snapshot.scope.length} กลุ่มสรุปที่เลือก · ` +
    `ครอบคลุม: ${included.map(r => r.id).join(', ') || 'ไม่มี'}`;
  const missingGroups = snapshot.scope.filter(r => !r.included).map(r => r.id);
  const unsetCategories = cats.filter(c => c.records.some(r => r.total > 0 && r.cap === null));
  const warnings = [];
  const roundDates = [...new Set((snapshot.scope || [])
      .filter(row => row.included && row.business_date)
      .map(row => row.business_date))].sort();
    if (roundDates.length > 1) warnings.push(
      `คำเตือน: รายงานรวมหลาย Business Date (${roundDates.join(', ')}) — ตรวจสอบวันที่ของแต่ละกลุ่มก่อนใช้ยอดรวม`
    );
    if (!snapshot.complete_scope) warnings.push(`ข้อมูลกลุ่มสรุปไม่ครบ: ${missingGroups.join(', ') || 'ไม่พบรอบล่าสุดที่เข้าเงื่อนไข'}`);
  if (unsetCategories.length) warnings.push('มีรหัสที่ไม่มีเพดานคำนวณได้: ' + unsetCategories.map(c => c.category).join(', '));
  $('warning').classList.toggle('hidden', warnings.length === 0);
  $('warning').textContent = warnings.join(' · ') + (warnings.length ? ' — ปิดการคัดลอกประกาศรวมเพื่อป้องกันประกาศผิด' : '');
  $('categories').replaceChildren();
  for (const c of cats) {
    const category = c.category;
    const pref = categoryPreferences(category);
    const panel = elem('section', 'panel');
    panel.append(elem('h2', '', `หมวด ${category} · จาก ${snapshot.selected_group_ids.length} กลุ่มสรุปที่เลือก`));
    const metrics = elem('div', 'metrics');
    for (const [label, value] of [
      ['ยอดออเดอร์รวม', money(c.orderTotal)],
      ['ยอดสุทธิรวม', money(c.netTotal)],
    ]) {
      const card = elem('div', 'metric');
      card.append(elem('span', '', label), elem('div', 'money', value));
      metrics.append(card);
    }
    panel.append(metrics);
    const info = c.profile.status === 'READY'
      ? `ตัวคูณ Point ${money(c.profile.multiplier)} × จำนวนรหัสเสี่ยงร่วม ${c.divisor} · เพดานคำนวณ ${c.automatic === null ? '—' : money(c.automatic)}`
      : `การตั้งค่า Point ไม่ครบหรือไม่ตรงกัน (${c.profile.status})`;
    panel.append(elem('p', 'muted small', info));
    const capForm = elem('div', 'cap-form');
    const modeLabel = elem('label', '', 'โหมดเพดาน');
    const mode = elem('select');
    for (const [value, label] of [['AUTO', 'คำนวณอัตโนมัติ'], ['MANUAL', 'กำหนดเอง']]) {
      const option = elem('option', '', label); option.value = value; mode.append(option);
    }
    mode.value = pref.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    mode.addEventListener('change', () => { pref.mode = mode.value; savePreferences(); render(); });
    modeLabel.append(mode); capForm.append(modeLabel);
    if (mode.value === 'MANUAL') {
      const manualLabel = elem('label', '', 'เพดานต่อรหัสของหมวด');
      const field = elem('input'); field.type = 'number'; field.min = '1'; field.step = '1';
      field.value = pref.manualCap ?? ''; field.placeholder = 'กรอกจำนวน';
      field.addEventListener('change', () => { pref.manualCap = field.value; savePreferences(); render(); });
      manualLabel.append(field); capForm.append(manualLabel);
    }
    panel.append(capForm);
    panel.append(elem('p', 'small muted',
      `ถึงเพดาน ${c.reached.length} รหัส · ` +
      (c.defaultCap !== null ? `เพดานพื้นฐาน ${money(c.defaultCap)}` : 'ยังไม่มีเพดานพื้นฐานที่ใช้ได้')));
    const { matched, visible, hasMore } = selectCodeRows(
      c.records, $('filter').value, expandedCodeCategories.has(category));
    const wrap = elem('div', 'table-wrap');
    wrap.id = `code-table-${category}`;
    wrap.classList.toggle('code-list-expanded', expandedCodeCategories.has(category) && hasMore);
    const table = elem('table');
    const head = elem('tr');
    for (const h of ['รหัส', 'ออเดอร์รวม', 'เพดาน', 'ส่วนต่าง', 'กำหนดเฉพาะรหัส']) {
      head.append(elem('th', ['ออเดอร์รวม', 'เพดาน', 'ส่วนต่าง'].includes(h) ? 'num' : '', h));
    }
    table.append(elem('thead')); table.tHead.append(head);
    const tbody = elem('tbody');
    for (const r of visible) {
      const tr = elem('tr', r.reached ? 'over' : r.near ? 'near' : '');
      tr.append(elem('td', '', r.code), elem('td', 'num', money(r.total)),
        elem('td', 'num', r.cap === null ? '—' : money(r.cap)),
        elem('td', 'num ' + (r.reached ? 'over-text' : r.near ? 'near-text' : ''),
          r.delta === null ? 'รอเพดาน' : r.delta >= 0 ? '+' + money(r.delta) : '−' + money(-r.delta)));
      const overrideCell = elem('td');
      const overrideInput = elem('input', 'code-cap'); overrideInput.type = 'number';
      overrideInput.min = '1'; overrideInput.step = '1';
      overrideInput.placeholder = 'ตามหมวด'; overrideInput.title = `เพดานเฉพาะ ${category}${r.code}`;
      overrideInput.value = pref.codeCaps[r.code] ?? '';
      overrideInput.addEventListener('change', () => {
        if (overrideInput.value === '') delete pref.codeCaps[r.code];
        else pref.codeCaps[r.code] = overrideInput.value;
        savePreferences(); render();
      });
      overrideCell.append(overrideInput); tr.append(overrideCell); tbody.append(tr);
    }
    if (!visible.length) {
      const tr = elem('tr'); const cell = elem('td', 'muted', 'ไม่มีรหัสในตัวกรองนี้');
      cell.colSpan = 5; tr.append(cell); tbody.append(tr);
    }
    table.append(tbody); wrap.append(table); panel.append(wrap);
    if (hasMore) {
      const controls = elem('div', 'code-list-controls');
      const expanded = expandedCodeCategories.has(category);
      controls.append(elem('span', 'small muted', `แสดง ${visible.length}/${matched.length} รหัส`));
      const toggle = elem('button', '', expanded
        ? `ย่อเหลือ ${CODE_ROW_LIMIT} รหัส` : `ดูรหัสทั้งหมด (${matched.length})`);
      toggle.type = 'button';
      toggle.id = `code-toggle-${category}`;
      toggle.setAttribute('aria-expanded', String(expandedCodeCategories.has(category)));
      toggle.setAttribute('aria-controls', wrap.id);
      toggle.addEventListener('click', () => {
        if (expandedCodeCategories.has(category)) expandedCodeCategories.delete(category);
        else expandedCodeCategories.add(category);
        render();
        document.getElementById(`code-toggle-${category}`)?.focus({ preventScroll: true });
      });
      controls.append(toggle);
      panel.append(controls);
    }
    $('categories').append(panel);
  }
  const notice = buildAnnouncement(cats, snapshot.business_date, snapshot.complete_scope,
    snapshot.selected_group_ids,
    snapshot.selected_group_ids.length === snapshot.available_groups.length);
  $('announcement').textContent = notice || 'ไม่มีรหัสถึงเพดาน หรือข้อมูล/เพดานยังไม่ครบ';
  $('copy').disabled = !notice;
}

let activeRequest = 0;
async function load() {
  if (!accessKey) return;
  const requestId = ++activeRequest;
  const previousKey = snapshot ? preferencesKey() : null;
  clearReport('กำลังโหลดข้อมูลใหม่ตามกลุ่มสรุปที่เลือก...');
  if (selectedGroupIds !== null && selectedGroupIds.length === 0) {
    $('warning').classList.remove('hidden');
    $('warning').textContent = 'ต้องเลือกอย่างน้อยหนึ่งกลุ่มสรุป — ไม่สามารถคำนวณหรือคัดลอกประกาศได้';
    status('ยังไม่ได้เลือกกลุ่มสรุป');
    $('refresh').disabled = false;
    return;
  }
  $('refresh').disabled = true;
  status('กำลังโหลดข้อมูลล่าสุด...');
  try {
    const params = new URLSearchParams();
    if (selectedGroupIds !== null) {
      for (const id of selectedGroupIds) params.append('group', id);
    }
    const endpoint = '/api/supervisor-category-ceiling' +
      (params.size ? '?' + params.toString() : '');
    const response = await fetch(endpoint, {
      method: 'GET', headers: { 'x-dashboard-key': accessKey, 'x-staff-key': accessKey }, cache: 'no-store',
    });
    const payload = await response.json();
    if (requestId !== activeRequest) return;
    if (!response.ok || !payload.ok) throw Error(payload.error || `HTTP_${response.status}`);
    if (!Array.isArray(payload.available_groups) || !Array.isArray(payload.selected_group_ids) ||
        !Array.isArray(payload.scope) || !Array.isArray(payload.rows)) throw Error('INVALID_REPORT_SCOPE');
    snapshot = payload;
    expandedCodeCategories.clear();
    availableGroups = payload.available_groups;
    selectedGroupIds = payload.selected_group_ids.length === availableGroups.length
      ? null : payload.selected_group_ids;
    if (previousKey !== preferencesKey()) restorePreferences();
    $('login').classList.add('hidden'); $('workspace').classList.remove('hidden');
    renderGroupSelector(); render();
    status('อ่านข้อมูลสำเร็จ · รายงานเฉพาะกลุ่มที่เลือก · ไม่มีการแก้ไขข้อมูล Production');
  } catch (error) {
    if (requestId !== activeRequest) return;
    clearReport('ไม่สามารถยืนยันยอดล่าสุดได้');
    status('อ่านข้อมูลไม่สำเร็จ: ' + error.message);
    if (error.message === 'UNAUTHORIZED') {
      accessKey = ''; sessionStorage.removeItem(STORAGE_KEY);
      $('login').classList.remove('hidden'); $('workspace').classList.add('hidden');
    }
  } finally {
    if (requestId === activeRequest) $('refresh').disabled = false;
  }
}
$('loginForm').addEventListener('submit', event => {
  event.preventDefault(); accessKey = $('key').value.trim();
  sessionStorage.setItem(STORAGE_KEY, accessKey); load();
});
$('refresh').addEventListener('click', load);
$('selectAllGroups').addEventListener('click', () => {
  selectedGroupIds = null;
  renderGroupSelector();
  load();
});
$('filter').addEventListener('change', () => { expandedCodeCategories.clear(); render(); });
$('reset').addEventListener('click', () => {
  if (!snapshot) return;
  preferences = {}; sessionStorage.removeItem(preferencesKey()); render();
  status('ล้างเพดานที่กำหนดเองแล้ว (เฉพาะเบราว์เซอร์นี้)');
});
$('logout').addEventListener('click', () => {
  activeRequest++; accessKey = ''; snapshot = null; selectedGroupIds = null; availableGroups = [];
  expandedCodeCategories.clear();
  sessionStorage.removeItem(STORAGE_KEY); $('key').value = '';
  $('workspace').classList.add('hidden'); $('login').classList.remove('hidden');
  $('groupOptions').replaceChildren();
  status('ออกจากหน้ารายงานแล้ว');
});
$('copy').addEventListener('click', async () => {
  if ($('copy').disabled) return;
  try {
    await navigator.clipboard.writeText($('announcement').textContent);
    status('คัดลอกประกาศแล้ว · กรุณาตรวจสอบยอดและส่งด้วยตนเอง');
  } catch { status('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง'); }
});
if (accessKey) load();
