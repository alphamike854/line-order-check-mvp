// Presentation only. No Accounting/round/LINE operations.
export const CODE_ROW_LIMIT = 20;

export function selectCodeRows(records, filter = 'all', expanded = false) {
  const matched = (records || []).filter(row => filter === 'over'
    ? Boolean(row.reached)
    : filter === 'near' ? Boolean(row.reached || row.near) : true);
  const visible = expanded ? matched : matched.slice(0, CODE_ROW_LIMIT);
  return { matched, visible, hasMore: matched.length > CODE_ROW_LIMIT };
}
