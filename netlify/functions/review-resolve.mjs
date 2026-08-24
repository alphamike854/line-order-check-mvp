import { parseOrder } from "../../src/lib/order-parser.mjs";
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
  return [500, message];
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

    await fetchOpenReviewById(reviewId);

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

    const correctedText = String(body.corrected_text ?? "").trim();
    if (!correctedText) return json({ ok: false, error: "CORRECTED_TEXT_REQUIRED" }, 400);

    const config = await loadParserConfig();
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

    const { data, error } = await supabase.rpc("resolve_review_with_items", {
      p_review_id: reviewId,
      p_corrected_text: result.normalized_text,
      p_parser_version: result.parser_version,
      p_items: result.items,
      p_resolved_by: OPERATOR,
    });
    if (error) {
      const [status, code] = mapRpcError(error);
      return json({ ok: false, error: code }, status);
    }

    return json({ ok: true, resolution: data, items: result.items });
  } catch (error) {
    console.error("review-resolve failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
};

export const config = { path: "/api/review-resolve" };
