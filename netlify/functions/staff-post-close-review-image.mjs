import {
  json,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
  loadWorkbenchActorLineGroups,
} from "../../src/lib/staff-access.mjs";

import {
  loadStaffPostCloseReviewImageAccess,
} from "../../src/lib/staff-post-close-review.mjs";


const REVIEW_IMAGE_BUCKET =
  "review-images";

const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS =
  900;


export default async function handler(
  req,
) {
  if (req.method !== "GET") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  try {
    const auth =
      await authenticateWorkbenchActor(
        req,
        {
          client: supabase,
        },
      );

    if (!auth.ok) {
      return json(
        {
          ok: false,
          error:
            auth.error,
        },
        auth.status,
      );
    }

    if (!auth.actor.staff_id) {
      return json(
        {
          ok: false,
          error:
            "STAFF_IDENTITY_REQUIRED",
        },
        403,
      );
    }

    const url =
      new URL(
        req.url,
      );

    const archiveId =
      String(
        url.searchParams.get(
          "archive_id",
        )
        ?? "",
      ).trim();

    if (!archiveId) {
      return json(
        {
          ok: false,
          error:
            "INVALID_ARCHIVE_ID",
        },
        400,
      );
    }

    // Authorization is intentionally identical
    // to the post-close queue:
    //
    // current Staff <-> LINE Group assignments
    // authorize historical archive access.
    const lineGroups =
      await loadWorkbenchActorLineGroups(
        supabase,
        auth.actor,
      );

    const lineGroupIds =
      [
        ...new Set(
          (lineGroups ?? [])
            .map(
              (row) =>
                row?.line_group_id,
            )
            .filter(Boolean),
        ),
      ];

    // The archive lookup itself is scoped by both
    // archive identity and allowed LINE Groups.
    //
    // Unauthorized and missing archive rows are
    // deliberately indistinguishable.
    const access =
      await loadStaffPostCloseReviewImageAccess(
        supabase,
        {
          archiveId,
          lineGroupIds,
        },
      );

    if (
      !access
      || access.message_type
        !== "image"
      || !access.image_storage_path
      || access.image_deleted_at
    ) {
      return json(
        {
          ok: false,
          error:
            "POST_CLOSE_REVIEW_IMAGE_NOT_FOUND",
        },
        404,
      );
    }

    const {
      data,
      error,
    } =
      await supabase.storage
        .from(
          REVIEW_IMAGE_BUCKET,
        )
        .createSignedUrl(
          access.image_storage_path,
          REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
        );

    if (
      error
      || !data?.signedUrl
    ) {
      console.warn(
        "post-close review image signing failed",
        {
          archive_id:
            access.id,
          error:
            error?.message
            ?? "SIGNED_URL_MISSING",
        },
      );

      return json(
        {
          ok: false,
          error:
            "POST_CLOSE_REVIEW_IMAGE_SIGNING_FAILED",
        },
        502,
      );
    }

    return json({
      ok: true,

      archive_id:
        access.id,

      image_evidence_url:
        data.signedUrl,

      image_evidence_expires_in:
        REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error(
      "staff-post-close-review-image failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error?.message
          ?? String(error),
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/staff-post-close-review-image",
};
