function displayCode(item) {
  const category = String(item?.category ?? '').toUpperCase();
  const code = String(item?.code ?? '').trim();
  if (!code) return '';
  return ['H', 'L'].includes(category) ? `${category}${code}` : code;
}

function numericCodePosition(text, code) {
  const source = String(text ?? '');
  const value = String(code ?? '').trim();
  if (!source || !/^\d{1,3}$/.test(value)) return -1;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^0-9])(${escaped})(?![0-9])`).exec(source);
  if (!match) return -1;
  return match.index + String(match[1] ?? '').length;
}

/**
 * Return the first order code as it appears in the source message.
 * Parsed items can be sorted/expanded (ABC, permutations, sweeps), so we
 * locate each parsed code back in the original text and choose the earliest
 * literal occurrence. If the source was cleared (e.g. LINE unsend), fall back
 * to insertion order from order_items.
 */
export function firstLedgerCode(items = [], sourceText = '') {
  const rows = [...(items ?? [])].filter((item) => item?.code != null);
  if (!rows.length) return '';

  let best = null;
  for (const item of rows) {
    const position = numericCodePosition(sourceText, item.code);
    if (position < 0) continue;
    const candidate = {
      position,
      id: Number(item.id ?? Number.MAX_SAFE_INTEGER),
      value: displayCode(item),
    };
    if (!best || candidate.position < best.position || (candidate.position === best.position && candidate.id < best.id)) {
      best = candidate;
    }
  }
  if (best?.value) return best.value;

  rows.sort((a, b) => Number(a.id ?? Number.MAX_SAFE_INTEGER) - Number(b.id ?? Number.MAX_SAFE_INTEGER));
  return displayCode(rows[0]);
}
