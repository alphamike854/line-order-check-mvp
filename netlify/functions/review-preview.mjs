import { parseOrder } from "../../src/lib/order-parser.mjs";
import {
  createReviewPreviewToken,
  reviewPreviewFingerprint,
} from "../../src/lib/review-safety.mjs";
import {
  fetchOpenReviewById,
  json,
  loadParserConfig,
  requireDashboardAccess,
} from "../../src/lib/dashboard-api.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const reviewId = Number(body.review_id);
    const correctedText = String(body.corrected_text ?? "");
    if (!Number.isInteger(reviewId) || reviewId <= 0) return json({ ok: false, error: "INVALID_REVIEW_ID" }, 400);
    if (!correctedText.trim()) return json({ ok: false, error: "CORRECTED_TEXT_REQUIRED" }, 400);

    const { message } = await fetchOpenReviewById(reviewId);
    if (message.unsent) return json({ ok: false, error: "MESSAGE_ALREADY_UNSENT" }, 409);

    const config = await loadParserConfig();
    const summaryGroupId = message.summary_group_id;
    if (!summaryGroupId) return json({ ok: false, error: "MESSAGE_GROUP_NOT_CONFIGURED" }, 409);
    const result = parseOrder(correctedText, config);
    const canApply = result.status === "PARSED" && result.items.length > 0;

    let previewToken = null;
    let previewFingerprint = null;
    let previewIssuedAt = null;
    let previewExpiresAt = null;

    if (canApply) {
      previewFingerprint = reviewPreviewFingerprint({
        reviewId,
        messageRecordId: message.id,
        correctedText,
        normalizedText: result.normalized_text,
        parserVersion: result.parser_version,
        items: result.items,
        parserConfig: config,
        summaryGroupId,
      });
      const signed = createReviewPreviewToken({
        reviewId,
        messageRecordId: message.id,
        fingerprint: previewFingerprint,
      });
      previewToken = signed.token;
      previewIssuedAt = signed.issued_at;
      previewExpiresAt = signed.expires_at;
    }

    return json({
      ok: true,
      review_id: reviewId,
      preview_token: previewToken,
      preview_fingerprint: previewFingerprint,
      preview_issued_at: previewIssuedAt,
      preview_expires_at: previewExpiresAt,
      preview: {
        status: result.status,
        items: result.items,
        warnings: result.warnings,
        errors: result.errors,
        checksums: result.checksums,
        parser_version: result.parser_version,
        normalized_text: result.normalized_text,
        summary_group_id: summaryGroupId,
        can_apply: canApply,
      },
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    const status = message === "REVIEW_NOT_FOUND" ? 404
      : message === "REVIEW_NOT_OPEN" ? 409
        : message === "MESSAGE_ALREADY_UNSENT" || message === "MESSAGE_GROUP_NOT_CONFIGURED" ? 409
          : message === "REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED" ? 503
            : 500;
    console.error("review-preview failed", error);
    return json({ ok: false, error: message }, status);
  }
};

export const config = { path: "/api/review-preview" };
