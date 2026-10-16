import {
  json,
  requireDashboardAccess,
  fetchOpenSettlementSession,
  normalizeSummaryGroup,
  supabase,
} from "../../src/lib/dashboard-api.mjs";
import { authenticateWorkbenchActor } from "../../src/lib/staff-access.mjs";
import { loadActorSessionLineGroupIds } from "../../src/lib/staff-workbench.mjs";
import { validReviewId, readExactOpenReview } from "../../src/lib/review-exact-read.mjs";

const notFound = () => json({ ok: true, item: null });

export default async function handler(req) {
  if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const staffKey = String(req.headers.get("x-staff-key") ?? "").trim();
  let actor = null;
  if (staffKey) {
    const auth = await authenticateWorkbenchActor(req, { client: supabase });
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    if (!auth.actor?.staff_id) return json({ ok: false, error: "STAFF_IDENTITY_REQUIRED" }, 403);
    actor = auth.actor;
  } else {
    const denied = requireDashboardAccess(req);
    if (denied) return denied;
  }

  const url = new URL(req.url);
  const reviewId = validReviewId(url.searchParams.get("review_id"));
  if (!reviewId) return json({ ok: false, error: "INVALID_REVIEW_ID" }, 400);
  const summaryGroupId = normalizeSummaryGroup(url.searchParams.get("group"));
  const messageRecordId = url.searchParams.get("message_record_id") || null;

  try {
    const session = await fetchOpenSettlementSession();
    if (!session) return notFound();

    const allowedLineGroupIds = actor
      ? await loadActorSessionLineGroupIds(supabase, actor, session.id)
      : null;
    if (actor && !allowedLineGroupIds?.length) return notFound();

    const exact = await readExactOpenReview(supabase, {
      reviewId,
      settlementSessionId: session.id,
      summaryGroupId,
      messageRecordId,
      allowedLineGroupIds,
      actorStaffId: actor?.staff_id ?? null,
    });
    if (!exact) return notFound();

    const item = { ...exact.item, image_evidence_url: null };
    if (item.message_type === "image" && exact.image_storage_path) {
      try {
        const signed = await supabase.storage.from("review-images")
          .createSignedUrl(exact.image_storage_path, 900);
        if (!signed.error && signed.data?.signedUrl) {
          item.image_evidence_url = signed.data.signedUrl;
          item.image_evidence_expires_in = 900;
        }
      } catch {
        // Missing private image evidence cannot authorize a Review mutation.
      }
    }

    return json({ ok: true, item, actor: actor
      ? { staff_id: actor.staff_id, staff_code: actor.staff_code,
          display_name: actor.display_name, role: actor.role }
      : null });
  } catch (error) {
    console.error("review-exact failed", error);
    return json({ ok: false, error: "REVIEW_EXACT_READ_FAILED" }, 500);
  }
}

export const config = { path: "/api/review-exact", region: "sin" };
