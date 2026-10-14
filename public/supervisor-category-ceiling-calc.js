// Presentation-only calculations. Never imported by accounting, Round or LINE workers.
export const CATEGORIES = Object.freeze(['A', 'B', 'E', 'F']);
export const formatQty = value => new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

export function parsePositiveLimit(input) {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function divisorForCategory(category, profile) {
  // Category totals are funded separately. Do NOT divide A/B by 2 again:
  // that factor applies only when both categories share ONE risk budget.
  if (category === 'A' || category === 'B') return 1;
  const count = Number(profile?.max_special_codes);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function buildCeilingReport(rows = [], profiles = {}, preferences = {}) {
  return CATEGORIES.map(category => {
    const records = (rows || []).filter(r => r.category === category)
      .map(r => ({ code: String(r.code), total: Number(r.order_total) || 0,
        net: Number(r.net_total) || 0 }));
    const orderTotal = records.reduce((sum, r) => sum + r.total, 0);
    const netTotal = Math.round(records.reduce((sum, r) => sum + r.net, 0) * 100) / 100;
    const profile = profiles[category] || {};
    const configuredMultiplier = Number(profile.multiplier);
    const divisor = divisorForCategory(category, profile);
    const validProfile = profile.status === 'READY' && Number.isFinite(configuredMultiplier) &&
      configuredMultiplier > 0 && divisor !== null;
    const automatic = validProfile ? Math.floor(netTotal / (configuredMultiplier * divisor)) : null;
    const preference = preferences[category] || {};
    const manualMode = preference.mode === 'MANUAL';
    const defaultCap = manualMode ? parsePositiveLimit(preference.manualCap) : automatic;
    const defaultStatus = manualMode ? defaultCap === null ? 'INVALID_MANUAL' : 'READY'
      : !validProfile ? 'PROFILE_UNAVAILABLE' : netTotal <= 0 ? 'NO_NET' : 'READY';
    const detail = records.map(r => {
      const rawOverride = preference.codeCaps?.[r.code];
      const overrideProvided = rawOverride !== undefined && rawOverride !== null &&
        String(rawOverride).trim() !== '';
      const override = parsePositiveLimit(rawOverride);
      // An invalid explicit override must never fall back silently to AUTO.
      const cap = overrideProvided ? override : defaultCap;
      const validCap = overrideProvided ? override !== null : defaultStatus === 'READY';
      const reached = validCap && r.total > 0 && r.total >= cap;
      const near = validCap && !reached && cap > 0 && r.total >= cap * 0.9;
      return { ...r, cap: validCap ? cap : null, override: overrideProvided,
        delta: validCap ? r.total - cap : null, reached, near };
    }).sort((a,b) => Number(b.reached) - Number(a.reached) ||
      Number(b.near) - Number(a.near) || b.total - a.total || a.code.localeCompare(b.code));
    return { category, orderTotal, netTotal, profile, divisor, automatic,
      defaultCap: defaultStatus === 'READY' ? defaultCap : null,
      defaultStatus, records:detail, reached: detail.filter(r => r.reached) };
  });
}

export function buildAnnouncement(categories, date, completeScope, groupIds = [], allGroupsSelected = true) {
  if (!completeScope) return null;
  // A missing effective cap for any category with orders blocks the collective notice.
  if (categories.some(c => c.records.some(r => r.total > 0 && r.cap === null))) return null;
  const reached = categories.flatMap(c => c.reached.map(r => ({ ...r, category:c.category })));
  if (!reached.length) return null;
  return [
    allGroupsSelected ? 'ประกาศหยุดรับออเดอร์ (รวมทุกกลุ่มสรุป)' :
      `ประกาศหยุดรับออเดอร์ (เฉพาะกลุ่มสรุป: ${groupIds.join(', ')})`,
    `วันที่ ${date}`, '',
    ...reached.map(r => `${r.category}${r.code} ยอดรวม ${formatQty(r.total)} ` +
      `(เพดาน ${formatQty(r.cap)}${r.delta > 0 ? ', เกิน +' + formatQty(r.delta) : ', ถึงเพดาน'})`),
    '', 'โปรดหยุดรับออเดอร์เฉพาะรหัสข้างต้นนับจากเวลาที่ประกาศ',
    'หมายเหตุ: กรุณาตรวจสอบยอดล่าสุดก่อนส่งประกาศ',
  ].join('\n');
}
