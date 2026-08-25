import { parseOrder } from "../../src/lib/order-parser.mjs";
import {
  reviewPreviewFingerprint,
  verifyReviewPreviewToken,
} from "../../src/lib/review-safety.mjs";
import {
  fetchOpenReviewById,
  json,
  loadParserConfig,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

const OPERATOR = process.env.DASHBOARD_OPERATOR_NAME || "DASHBOARD";

function mapRpcError(error) {
  const message = String(error?.message ?? error ?? "UNKNOWN_ERROR");
  if (message.includes("REVIEW_NOT_FOUND")) return [404, "REVIEW_NOT_FOUND"];
  if (message.includes("REVIEW_NOT_OPEN")) return [409, "REVIEW_NOT_OPEN"];
  if (message.includes("MESSAGE_ALREADY_UNSENT")) return [409, "MESSAGE_ALREADY_UNSENT"];
  if (message.includes("MESSAGE_GROUP_NOT_CONFIGURED")) return [409, "MESSAGE_GROUP_NOT_CONFIGURED"];
  if (message.includes("SETTLEMENT_NOT_OPEN")) return [409, "SETTLEMENT_NOT_OPEN"];
  if (message.includes("MESSAGE_SETTLEMENT_NOT_ASSIGNED")) return [409, "MESSAGE_SETTLEMENT_NOT_ASSIGNED"];
  return [500, message];
}

function previewErrorStatus(code) {
  if (code === "PREVIEW_REQUIRED") return 428;
  if (code === "PREVIEW_EXPIRED" || code === "PREVIEW_STALE") return 409;
  if (code === "PREVIEW_TOKEN_INVALID") return 400;
  return 409;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const denied = requireDashboardAccess(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const reviewId = Number(body.review_id);
    const action = String(body.action ?? "CORRECT").trim().toUpperCase();
    if (!Number.isInteger(reviewId) || reviewId <= 0) return json({ ok: false, error: "INVALID_REVIEW_ID" }, 400);

    const { message } = await fetchOpenReviewById(reviewId);

    if (action === "IGNORE") {
      const { data, error } = await supabase.rpc("ignore_review", {
        p_review_id: reviewId,
        p_resolved_by: OPERATOR,
      });
      if (error) {
        const [status, code] = mapRpcError(error);
        return json({ ok: false, error: code }, status);
      }
      return json({ ok: true, resolution: data });
    }

    if (action !== "CORRECT") return json({ ok: false, error: "INVALID_REVIEW_ACTION" }, 400);
    if (message.unsent) return json({ ok: false, error: "MESSAGE_ALREADY_UNSENT" }, 409);

    const correctedText = String(body.corrected_text ?? "");
    const previewToken = String(body.preview_token ?? "");
    if (!correctedText.trim()) return json({ ok: false, error: "CORRECTED_TEXT_REQUIRED" }, 400);
    if (!previewToken) return json({ ok: false, error: "PREVIEW_REQUIRED" }, 428);

    const config = await loadParserConfig();
    const summaryGroupId = message.summary_group_id;
    if (!summaryGroupId) return json({ ok: false, error: "MESSAGE_GROUP_NOT_CONFIGURED" }, 409);
    const result = parseOrder(correctedText, config);
    if (result.status !== "PARSED" || !result.items.length) {
      return json({
        ok: false,
        error: "CORRECTION_NOT_PARSEABLE",
        preview: {
          status: result.status,
          items: result.items,
          warnings: result.warnings,
          errors: result.errors,
        },
      }, 409);
    }

    const fingerprint = reviewPreviewFingerprint({
      reviewId,
      messageRecordId: message.id,
      correctedText,
      normalizedText: result.normalized_text,
      parserVersion: result.parser_version,
      items: result.items,
      parserConfig: config,
      summaryGroupId,
    });
    const verified = verifyReviewPreviewToken({
      token: previewToken,
      reviewId,
      messageRecordId: message.id,
      expectedFingerprint: fingerprint,
    });
    if (!verified.ok) {
      return json({ ok: false, error: verified.error, requires_preview: true }, previewErrorStatus(verified.error));
    }

    const { data, error } = await supabase.rpc("resolve_review_with_preview", {
      p_review_id: reviewId,
      p_corrected_text: result.normalized_text,
      p_parser_version: result.parser_version,
      p_items: result.items,
      p_resolved_by: OPERATOR,
      p_preview_fingerprint: verified.fingerprint,
      p_previewed_at: verified.issued_at,
    });
    if (error) {
      const [status, code] = mapRpcError(error);
      return json({ ok: false, error: code }, status);
    }

    return json({
      ok: true,
      resolution: data,
      items: result.items,
      preview_fingerprint: verified.fingerprint,
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    const status = message === "REVIEW_NOT_FOUND" ? 404
      : message === "REVIEW_NOT_OPEN" || message === "MESSAGE_ALREADY_UNSENT" || message === "MESSAGE_GROUP_NOT_CONFIGURED" || message === "SETTLEMENT_NOT_OPEN" || message === "MESSAGE_SETTLEMENT_NOT_ASSIGNED" ? 409
        : message === "REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED" ? 503
          : 500;
    console.error("review-resolve failed", error);
    return json({ ok: false, error: message }, status);
  }
};

export const config = { path: "/api/review-resolve" };
