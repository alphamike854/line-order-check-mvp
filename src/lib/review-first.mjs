/*
 * Emergency Review-first read model.
 * Read-only; the database RPC owns active Round + OPEN Review filtering.
 * Never use Timeline's review_id as authorization to mutate a Review.
 */

const PAGE_SIZE = 200;
const IMAGE_CHUNK = 100;

function uniqueValues(items) {
  return [...new Set(items.map(value => String(value || '').trim()).filter(Boolean))];
}

export async function fetchOpenReviewsReviewFirst({
  client,
  settlementSessionId,
  summaryGroupId = null,
  roundIds,
  rounds = [],
  pageSize = PAGE_SIZE,
}) {
  const allowedRounds = uniqueValues(roundIds || []);
  if (!settlementSessionId || !allowedRounds.length) return [];

  // Match the settlement's own LINE-group mapping. No unrestricted staff
  // query, and no scan of the round's entire message history.
  let mappingQuery = client
    .from('settlement_line_group_config')
    .select('line_group_id,summary_group_id')
    .eq('settlement_session_id', settlementSessionId)
    .eq('enabled', true);
  if (summaryGroupId) {
    mappingQuery = mappingQuery.eq('summary_group_id', summaryGroupId);
  }
  const { data: mappings, error: mappingError } = await mappingQuery;
  if (mappingError) throw mappingError;
  const lineGroupIds = uniqueValues((mappings || []).map(row => row.line_group_id));
  if (!lineGroupIds.length) return [];

  const limit = Number.isSafeInteger(pageSize)
    ? Math.max(1, Math.min(pageSize, PAGE_SIZE)) : PAGE_SIZE;
  const allowedSet = new Set(allowedRounds);
  const roundDateById = new Map((rounds || []).map(row => [String(row.id), row.business_date || null]));
  const accepted = [];

  for (let offset = 0; ; offset += limit) {
    // This existing SQL RPC is already the authorized/bounded current-Round
    // Review read model used by /api/staff-reviews. It returns OPEN only.
    const { data, error } = await client.rpc('staff_workbench_open_reviews', {
      p_settlement_session_id: settlementSessionId,
      p_line_group_ids: lineGroupIds,
      p_summary_group_id: summaryGroupId || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    const page = data || [];
    if (!Array.isArray(page) || page.length > limit) {
      throw new Error('REVIEW_FIRST_PAGE_INVALID');
    }
    for (const row of page) {
      if (!allowedSet.has(String(row.summary_group_round_id || ''))) continue;
      if (summaryGroupId && row.summary_group_id !== summaryGroupId) continue;
      if (row.review_id == null || !row.message_record_id) continue;
      accepted.push(row);
    }
    if (page.length < limit) break;
  }

  // Preserve legacy descending Review-created ordering across paged results.
  accepted.sort((a,b) => (Date.parse(b.review_created_at || 0) - Date.parse(a.review_created_at || 0)) || (Number(b.review_id) - Number(a.review_id)));

  // Fetch Storage paths for returned image Reviews only; never load all
  // messages before locating OPEN Review records.
  const imageIds = uniqueValues(accepted
    .filter(row => String(row.message_type || '').toLowerCase() === 'image' && row.has_image_evidence)
    .map(row => row.message_record_id));
  const pathByMessage = new Map();
  for (let i = 0; i < imageIds.length; i += IMAGE_CHUNK) {
    const ids = imageIds.slice(i, i + IMAGE_CHUNK);
    const { data, error } = await client
      .from('messages')
      .select('id,image_storage_path')
      .eq('settlement_session_id', settlementSessionId)
      .eq('unsent', false)
      .in('summary_group_round_id', allowedRounds)
      .in('id', ids);
    if (error) throw error;
    for (const row of data || []) {
      pathByMessage.set(row.id, row.image_storage_path || null);
    }
  }

  // Preserve the legacy /api/reviews JSON field contract for the UI.
  return accepted.map(row => ({
    id: row.review_id,
    message_record_id: row.message_record_id,
    business_date: roundDateById.get(String(row.summary_group_round_id)) || null,
    settlement_session_id: settlementSessionId,
    summary_group_id: row.summary_group_id,
    summary_group_round_id: row.summary_group_round_id,
    line_group_id: row.line_group_id,
    line_group_name: row.line_group_name || row.line_group_id,
    user_id: row.user_id,
    message_type: row.message_type,
    raw_text: row.raw_text,
    normalized_text: row.normalized_text,
    ocr_text: row.ocr_text,
    image_storage_path: pathByMessage.get(row.message_record_id) || null,
    parse_status: row.parse_status,
    parser_version: row.parser_version,
    source_text: row.ocr_text ?? row.raw_text ?? '',
    reason_codes: row.reason_codes ?? [],
    warnings: row.warnings ?? [],
    created_at: row.review_created_at ?? row.message_created_at ?? row.event_timestamp,
  }));
}
