/*
 * Single Review read with the same OPEN/current-session/latest-Round
 * and immutable Round lineage boundaries as Staff Review mutations.
 * Never grants claim/resolve authority; those APIs independently enforce it.
 */
import { resolveWorkbenchClaimState } from "./staff-workbench.mjs";

function requireData(result) {
  if (result?.error) throw result.error;
  return result?.data ?? null;
}

export function validReviewId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

export async function readExactOpenReview(client, {
  reviewId, settlementSessionId, summaryGroupId = null,
  messageRecordId = null, allowedLineGroupIds = null,
  actorStaffId = null,
} = {}) {
  const id = validReviewId(reviewId);
  if (!id || !settlementSessionId) return null;

  const review = requireData(await client.from("review_items")
    .select("id,message_record_id,status,reason_codes,warnings,created_at")
    .eq("id", id).maybeSingle());
  if (!review || review.status !== "OPEN" || !review.message_record_id) return null;

  if (messageRecordId && String(review.message_record_id) !== String(messageRecordId)) {
    return null;
  }

  const message = requireData(await client.from("messages")
    .select("id,business_date,settlement_session_id,summary_group_id,summary_group_round_id,line_group_id,user_id,message_type,raw_text,normalized_text,ocr_text,parse_status,parser_version,unsent,event_timestamp,created_at,image_storage_path")
    .eq("id", review.message_record_id).maybeSingle());

  if (!message || message.unsent === true
    || message.settlement_session_id !== settlementSessionId
    || !message.summary_group_id || !message.summary_group_round_id
    || (summaryGroupId && message.summary_group_id !== summaryGroupId)
    || (Array.isArray(allowedLineGroupIds)
      && !allowedLineGroupIds.includes(message.line_group_id))) {
    return null;
  }

  const rounds = requireData(await client.from("settlement_summary_group_rounds")
    .select("id,round_no,status")
    .eq("settlement_session_id", settlementSessionId)
    .eq("summary_group_id", message.summary_group_id)
    .order("round_no", { ascending: false }).limit(1));
  const latestRound = rounds?.[0] ?? null;
  if (!latestRound || latestRound.id !== message.summary_group_round_id
    || !["OPEN", "CLOSED"].includes(latestRound.status)) return null;

  // Historical Review cards must never be promoted through this endpoint.
  // Same immutable lineage check as the Staff Review Preview/Resolve guard.
  const roundLine = requireData(await client.from("settlement_line_group_round_config")
    .select("round_id,line_group_id,line_group_name")
    .eq("round_id", latestRound.id)
    .eq("line_group_id", message.line_group_id).maybeSingle());
  if (!roundLine) return null;

  const item = {
    id: review.id,
    message_record_id: message.id,
    business_date: message.business_date,
    settlement_session_id: settlementSessionId,
    summary_group_id: message.summary_group_id,
    summary_group_round_id: message.summary_group_round_id,
    line_group_id: message.line_group_id,
    line_group_name: roundLine.line_group_name || message.line_group_id,
    user_id: message.user_id,
    message_type: message.message_type,
    raw_text: message.raw_text,
    normalized_text: message.normalized_text,
    ocr_text: message.ocr_text,
    source_text: message.ocr_text ?? message.raw_text ?? "",
    parse_status: message.parse_status,
    parser_version: message.parser_version,
    reason_codes: review.reason_codes ?? [],
    warnings: review.warnings ?? [],
    created_at: review.created_at ?? message.created_at ?? message.event_timestamp,
    claim_state: "AVAILABLE",
    claimed_by_staff_id: null,
    claimed_by_staff_code: null,
    claimed_by_display_name: null,
    claimed_at: null,
    claim_expires_at: null,
    lease_version: null,
  };

  if (actorStaffId) {
    const claimRows = requireData(await client.rpc("staff_workbench_claim_state", {
      p_message_record_ids: [message.id],
    })) ?? [];
    const claim = claimRows.find(row => String(row.message_record_id) === String(message.id));
    item.claimed_by_staff_id = claim?.staff_id ?? null;
    item.claimed_by_staff_code = claim?.staff_code ?? null;
    item.claimed_by_display_name = claim?.staff_display_name ?? null;
    item.claimed_at = claim?.claimed_at ?? null;
    item.claim_expires_at = claim?.claim_expires_at ?? null;
    item.lease_version = claim?.lease_version ?? null;
    item.claim_state = resolveWorkbenchClaimState({
      actorStaffId,
      claimStaffId: claim?.staff_id ?? null,
      claimExpiresAt: claim?.claim_expires_at ?? null,
    });
  }

  return { item, image_storage_path: message.image_storage_path ?? null };
}
