import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('public/app.js', 'utf8');
const begin = src.indexOf('async function loadDashboard({');
const end = src.indexOf('function activateTab(', begin);
assert.ok(begin >= 0 && end > begin, 'Dashboard function boundaries');
const body = src.slice(begin, end);
assert.match(body, /refreshSettlementFirst = true/);
assert.match(body, /refreshSettlementFirst && state\.authMode === "DASHBOARD"/);
assert.match(body, /refreshSettlementFirst: false/);
assert.match(body, /if \(state\.settlement && !state\.settlement\.open_session && !businessDateInput\.value\)/);
assert.match(body, /renderSettlementStatus\(state\.settlement\)/);
assert.equal((body.match(/await loadSettlement\(\)/g) || []).length, 1);
assert.ok(body.indexOf('await loadSettlement()') < body.indexOf('await api(`/api/dashboard?'), 'round read before dashboard read');
assert.ok(body.indexOf('renderSettlementStatus(state.settlement)') < body.indexOf('renderMetrics(payload.metrics)'), 'round date synced before render');

async function simulate({ settlementFails }) {
  const events = [];
  // Distinct DOM elements: dashboard freshness must NOT overwrite round metadata.
  const elements = {
    '#freshness': { textContent: '' },
    '#settlementStatus': { textContent: '' },
    '#settlementMeta': { textContent: '' },
  };
  const ctx = {
    state: { authMode: 'DASHBOARD', dashboard: null, settlement: null },
    refreshButton: { disabled: false, textContent: '' },
    businessDateInput: { value: '', disabled: false },
    $: (selector) => {
      assert.ok(elements[selector], `unexpected DOM selector ${selector}`);
      return elements[selector];
    },
    hideReviewBadgeUntilLoaded: () => {},
    hideUnsendBadgeUntilLoaded: () => {},
    loadSettlement: async () => {
      events.push('settlement');
      if (settlementFails) throw new Error('SETTLEMENT_UNAVAILABLE');
      ctx.state.settlement = { open_session: { id: 'fixture' } };
      elements['#settlementStatus'].textContent = 'พร้อมรับยอดรายกลุ่ม';
      elements['#settlementMeta'].textContent = 'วันที่อ้างอิง 2026-10-16';
      ctx.businessDateInput.value = '2026-10-16';
      ctx.businessDateInput.disabled = true;
    },
    api: async () => { events.push('dashboard'); throw Error('DASHBOARD_UNAVAILABLE'); },
    selectedQuery: () => 'date=&group=',
    toast: () => {},
    console: { error: () => {} },
  };
  vm.runInNewContext(body + '\nglobalThis.testDashboard = loadDashboard;', ctx);
  await ctx.testDashboard();
  assert.deepEqual(events, ['settlement', 'dashboard'], 'settlement requested first even if dashboard fails');
  assert.equal(ctx.refreshButton.disabled, false, 'refresh button released on dashboard failure');
  assert.equal(elements['#freshness'].textContent, 'โหลดข้อมูลไม่สำเร็จ', 'dashboard failure shown in freshness only');
  if (settlementFails) {
    assert.equal(elements['#settlementStatus'].textContent, 'โหลดสถานะรอบไม่สำเร็จ');
    assert.equal(elements['#settlementMeta'].textContent, 'ยังไม่สามารถยืนยันรอบล่าสุดได้ กรุณาอัปเดตอีกครั้ง');
    assert.equal(ctx.businessDateInput.value, '');
    assert.equal(ctx.businessDateInput.disabled, true);
  } else {
    assert.equal(ctx.state.settlement.open_session.id, 'fixture');
    assert.equal(elements['#settlementStatus'].textContent, 'พร้อมรับยอดรายกลุ่ม', 'dashboard failure must preserve round status');
    assert.equal(elements['#settlementMeta'].textContent, 'วันที่อ้างอิง 2026-10-16', 'dashboard failure must preserve round date');
    assert.equal(ctx.businessDateInput.value, '2026-10-16');
  }
}
await simulate({ settlementFails: false });
await simulate({ settlementFails: true });
console.log('PASS: independent DOM mocks; dashboard failure does not overwrite round status/date');
console.log('PASS: settlement failure remains fail-closed while dashboard still attempts');
console.log('PASS: bootstrap source contract, one settlement read, round-first ordering');
