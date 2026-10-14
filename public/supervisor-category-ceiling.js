import {
  CATEGORIES, formatQty, parsePositiveLimit,
  buildCeilingReport, buildAnnouncement,
} from './supervisor-category-ceiling-calc.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'locSupervisorCategoryCeilingKeyV2';
const PREF_KEY_PREFIX = 'locSupervisorCategoryCeilingPreferencesV2:';
let accessKey = sessionStorage.getItem(STORAGE_KEY) || '';
let snapshot = null;
let preferences = {};
function status(text) { $('status').textContent = text; }
function elem(tag, cls = '', text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
function preferencesKey() { return PREF_KEY_PREFIX + snapshot.business_date; }
function restorePreferences() {
  try { preferences = JSON.parse(sessionStorage.getItem(preferencesKey()) || '{}'); }
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
function render() {
  if (!snapshot) return;
  const cats = buildCeilingReport(snapshot.rows, snapshot.profiles, preferences);
  $('day').textContent = `ข้อมูลวันที่ ${snapshot.business_date}`;
  $('freshness').textContent = `อ่านข้อมูลล่าสุดเมื่อ ${new Date(snapshot.fetched_at).toLocaleString('th-TH')}`;
  const included = snapshot.scope.filter(r => r.included);
  $('coverage').textContent = `ข้อมูลครบ ${included.length}/${snapshot.scope.length} กลุ่มสรุป · ` +
    `ครอบคลุม: ${included.map(r => r.id).join(', ') || 'ไม่มี'}`;
  const missingGroups = snapshot.scope.filter(r => !r.included).map(r => r.id);
  const unsetCategories = cats.filter(c => c.records.some(r => r.total > 0 && r.cap === null));
  const warnings = [];
  if (!snapshot.complete_scope) warnings.push(`ข้อมูลกลุ่มสรุปไม่ครบ: ${missingGroups.join(', ') || 'ไม่มี Round วันนี้'}`);
  if (unsetCategories.length) warnings.push('มีรหัสที่ไม่มีเพดานคำนวณได้: ' + unsetCategories.map(c => c.category).join(', '));
  $('warning').classList.toggle('hidden', warnings.length === 0);
  $('warning').textContent = warnings.join(' · ') + (warnings.length ? ' — ปิดการคัดลอกประกาศรวมเพื่อป้องกันประกาศผิด' : '');
  $('categories').replaceChildren();
  for (const c of cats) {
    const category = c.category;
    const pref = categoryPreferences(category);
    const panel = elem('section', 'panel');
    panel.append(elem('h2', '', `หมวด ${category} · รวมทุกกลุ่มสรุป`));
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
    const wrap = elem('div', 'table-wrap');
    const table = elem('table');
    const head = elem('tr');
    for (const h of ['รหัส', 'ออเดอร์รวม', 'เพดาน', 'ส่วนต่าง', 'กำหนดเฉพาะรหัส']) {
      head.append(elem('th', ['ออเดอร์รวม', 'เพดาน', 'ส่วนต่าง'].includes(h) ? 'num' : '', h));
    }
    table.append(elem('thead')); table.tHead.append(head);
    const tbody = elem('tbody');
    let displayed = 0;
    for (const r of c.records) {
      if ($('filter').value === 'over' && !r.reached) continue;
      if ($('filter').value === 'near' && !r.reached && !r.near) continue;
      displayed++;
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
    if (!displayed) {
      const tr = elem('tr'); const cell = elem('td', 'muted', 'ไม่มีรหัสในตัวกรองนี้');
      cell.colSpan = 5; tr.append(cell); tbody.append(tr);
    }
    table.append(tbody); wrap.append(table); panel.append(wrap);
    $('categories').append(panel);
  }
  const notice = buildAnnouncement(cats, snapshot.business_date, snapshot.complete_scope);
  $('announcement').textContent = notice || 'ไม่มีรหัสถึงเพดาน หรือข้อมูล/เพดานยังไม่ครบ';
  $('copy').disabled = !notice;
}

async function load() {
  if (!accessKey) return;
  $('refresh').disabled = true;
  status('กำลังโหลดข้อมูลล่าสุด...');
  try {
    const response = await fetch('/api/supervisor-category-ceiling', {
      method: 'GET', headers: { 'x-dashboard-key': accessKey, 'x-staff-key': accessKey }, cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw Error(payload.error || `HTTP_${response.status}`);
    const previousDate = snapshot?.business_date;
    snapshot = payload;
    if (previousDate !== snapshot.business_date) restorePreferences();
    $('login').classList.add('hidden'); $('workspace').classList.remove('hidden');
    render(); status('อ่านข้อมูลสำเร็จ · ไม่มีการแก้ไขข้อมูล Production');
  } catch (error) {
    status('อ่านข้อมูลไม่สำเร็จ: ' + error.message);
    // Never leave a stale display actionable after a failed refresh.
    snapshot = null;
    $('categories').replaceChildren(); $('copy').disabled = true;
    $('announcement').textContent = 'ไม่สามารถยืนยันยอดล่าสุดได้';
    if (error.message === 'UNAUTHORIZED') {
      accessKey = ''; sessionStorage.removeItem(STORAGE_KEY);
      $('login').classList.remove('hidden'); $('workspace').classList.add('hidden');
    }
  } finally { $('refresh').disabled = false; }
}

$('loginForm').addEventListener('submit', event => {
  event.preventDefault(); accessKey = $('key').value.trim();
  sessionStorage.setItem(STORAGE_KEY, accessKey); load();
});
$('refresh').addEventListener('click', load);
$('filter').addEventListener('change', render);
$('reset').addEventListener('click', () => {
  if (!snapshot) return;
  preferences = {}; sessionStorage.removeItem(preferencesKey()); render();
  status('ล้างเพดานที่กำหนดเองแล้ว (เฉพาะเบราว์เซอร์นี้)');
});
$('logout').addEventListener('click', () => {
  accessKey = ''; snapshot = null;
  sessionStorage.removeItem(STORAGE_KEY); $('key').value = '';
  $('workspace').classList.add('hidden'); $('login').classList.remove('hidden');
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
