import {
  fetchOpenReviews,
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

const REVIEW_IMAGE_BUCKET =
  "review-images";

const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS =
  900;

async function addReviewImageEvidence(items) {
  return Promise.all(
    items.map(async (item) => {
      const {
        image_storage_path: storagePath,
        ...publicItem
      } = item;

      if (
        item.message_type !== "image"
        || !storagePath
      ) {
        return {
          ...publicItem,
          image_evidence_url: null,
        };
      }

      try {
        const {
          data,
          error,
        } = await supabase.storage
          .from(REVIEW_IMAGE_BUCKET)
          .createSignedUrl(
            storagePath,
            REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
          );

        if (error || !data?.signedUrl) {
          console.warn(
            "review image signing failed",
            {
              review_id: item.id,
              message_record_id:
                item.message_record_id,
              error:
                error?.message
                ?? "SIGNED_URL_MISSING",
            },
          );

          return {
            ...publicItem,
            image_evidence_url: null,
          };
        }

        return {
          ...publicItem,
          image_evidence_url:
            data.signedUrl,
          image_evidence_expires_in:
            REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
        };
      } catch (error) {
        // A temporary Storage/signing problem must not make
        // the entire Review workbench unavailable.
        console.warn(
          "review image signing failed",
          {
            review_id: item.id,
            message_record_id:
              item.message_record_id,
            error:
              error?.message ?? String(error),
          },
        );

        return {
          ...publicItem,
          image_evidence_url: null,
        };
      }
    }),
  );
}

export default async function handler(req) {
  if (req.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const denied =
    requireDashboardAccess(req);

  if (denied) {
    return denied;
  }

  try {
    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json({
        ok: true,
        items: [],
      });
    }

    const url =
      new URL(req.url);

    const group =
      normalizeSummaryGroup(
        url.searchParams.get("group"),
      );

    const items =
      await fetchOpenReviews(
        session.business_date,
        group,
        session.id,
      );

    const publicItems =
      await addReviewImageEvidence(items);

    return json({
      ok: true,
      settlement_session: session,
      items: publicItems,
    });
  } catch (error) {
    console.error(
      "reviews failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message ?? String(error),
      },
      500,
    );
  }
}

export const config = {
  path: "/api/reviews",
};
