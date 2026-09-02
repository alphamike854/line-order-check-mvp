import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  authenticateWorkbenchActor,
} from "../../src/lib/staff-access.mjs";

import {
  loadActorSessionLineGroupIds,
  loadStaffWorkbenchReadModel,
  normalizeWorkbenchLimit,
  normalizeWorkbenchOffset,
} from "../../src/lib/staff-workbench.mjs";


const REVIEW_IMAGE_BUCKET =
  "review-images";

const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS =
  900;


async function loadScopedImageStoragePaths(
  messageRecordIds,
) {
  const ids = [
    ...new Set(
      (messageRecordIds ?? [])
        .filter(Boolean),
    ),
  ];

  if (!ids.length) {
    return new Map();
  }

  const {
    data,
    error,
  } = await supabase
    .from("messages")
    .select(
      "id,image_storage_path",
    )
    .in(
      "id",
      ids,
    );

  if (error) {
    throw error;
  }

  return new Map(
    (data ?? []).map(
      (row) => [
        row.id,
        row.image_storage_path
        ?? null,
      ],
    ),
  );
}


async function addScopedReviewImageEvidence(
  items,
) {
  return Promise.all(
    items.map(
      async (item) => {
        const {
          image_storage_path:
            storagePath,
          ...publicItem
        } = item;

        if (
          item.message_type
          !== "image"
          || !storagePath
        ) {
          return {
            ...publicItem,
            image_evidence_url:
              null,
          };
        }

        try {
          const {
            data,
            error,
          } = await supabase.storage
            .from(
              REVIEW_IMAGE_BUCKET,
            )
            .createSignedUrl(
              storagePath,
              REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
            );

          if (
            error
            || !data?.signedUrl
          ) {
            console.warn(
              "staff review image signing failed",
              {
                review_id:
                  item.id,

                message_record_id:
                  item.message_record_id,

                error:
                  error?.message
                  ?? "SIGNED_URL_MISSING",
              },
            );

            return {
              ...publicItem,
              image_evidence_url:
                null,
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
          // Storage failure must not make
          // the Staff Workbench unavailable.
          console.warn(
            "staff review image signing failed",
            {
              review_id:
                item.id,

              message_record_id:
                item.message_record_id,

              error:
                error?.message
                ?? String(error),
            },
          );

          return {
            ...publicItem,
            image_evidence_url:
              null,
          };
        }
      },
    ),
  );
}


function staffReviewItem(
  row,
  imageStoragePath,
) {
  return {
    id:
      row.review_id,

    message_record_id:
      row.message_record_id,

    summary_group_id:
      row.summary_group_id,

    line_group_id:
      row.line_group_id,

    line_group_name:
      row.line_group_name,

    user_id:
      row.user_id,

    message_type:
      row.message_type,

    image_storage_path:
      imageStoragePath
      ?? null,

    parse_status:
      row.parse_status,

    parser_version:
      row.parser_version,

    text:
      row.display_text
      ?? "",

    reason_codes:
      Array.isArray(
        row.reason_codes,
      )
        ? row.reason_codes
        : [],

    warnings:
      Array.isArray(
        row.warnings,
      )
        ? row.warnings
        : [],

    created_at:
      row.review_created_at
      ?? row.message_created_at
      ?? row.event_timestamp
      ?? null,
  };
}


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

    // This endpoint is intentionally Staff-only.
    //
    // Legacy Dashboard/Admin keeps using /api/reviews.
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
      new URL(req.url);

    const summaryGroupId =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    const limit =
      normalizeWorkbenchLimit(
        url.searchParams.get(
          "limit",
        ),
      );

    const offset =
      normalizeWorkbenchOffset(
        url.searchParams.get(
          "offset",
        ),
      );

    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return json({
        ok: true,

        actor:
          auth.actor,

        settlement_session:
          null,

        items: [],

        pagination: {
          limit,
          offset,
          returned: 0,
          has_more: false,
        },
      });
    }

    const lineGroupIds =
      await loadActorSessionLineGroupIds(
        supabase,
        auth.actor,
        session.id,
      );

    const {
      workItems,
    } =
      await loadStaffWorkbenchReadModel(
        supabase,
        {
          settlementSessionId:
            session.id,

          lineGroupIds,

          summaryGroupId,

          limit,

          offset,
        },
      );

    // Evidence is loaded only after Workbench scope
    // has determined the exact message identities.
    const messageRecordIds =
      workItems
        .filter(
          (item) =>
            item.message_type
              === "image"
            && item.has_image_evidence,
        )
        .map(
          (item) =>
            item.message_record_id,
        );

    const imagePathByMessage =
      await loadScopedImageStoragePaths(
        messageRecordIds,
      );

    const scopedItems =
      workItems.map(
        (row) =>
          staffReviewItem(
            row,
            imagePathByMessage.get(
              row.message_record_id,
            ),
          ),
      );

    const publicItems =
      await addScopedReviewImageEvidence(
        scopedItems,
      );

    return json({
      ok: true,

      actor:
        auth.actor,

      settlement_session:
        session,

      items:
        publicItems,

      pagination: {
        limit,
        offset,

        returned:
          publicItems.length,

        has_more:
          publicItems.length
          === limit,
      },
    });
  } catch (error) {
    console.error(
      "staff-reviews failed",
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
    "/api/staff-reviews",
};
