import { parseOrder } from "../../src/lib/order-parser.mjs";
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
    const correctedText = String(body.corrected_text ?? "").trim();
    if (!Number.isInteger(reviewId) || reviewId <= 0) return json({ ok: false, error: "INVALID_REVIEW_ID" }, 400);
    if (!correctedText) return json({ ok: false, error: "CORRECTED_TEXT_REQUIRED" }, 400);

    const { message } = await fetchOpenReviewById(reviewId);
    if (message.unsent) return json({ ok: false, error: "MESSAGE_ALREADY_UNSENT" }, 409);

    const config = await loadParserConfig();
    const result = parseOrder(correctedText, config);
    return json({
      ok: true,
      review_id: reviewId,
      preview: {
        status: result.status,
        items: result.items,
        warnings: result.warnings,
        errors: result.errors,
        checksums: result.checksums,
        parser_version: result.parser_version,
        normalized_text: result.normalized_text,
        can_apply: result.status === "PARSED" && result.items.length > 0,
      },
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    const status = message === "REVIEW_NOT_FOUND" ? 404 : message === "REVIEW_NOT_OPEN" ? 409 : 500;
    console.error("review-preview failed", error);
    return json({ ok: false, error: message }, status);
  }
};

export const config = { path: "/api/review-preview" };
