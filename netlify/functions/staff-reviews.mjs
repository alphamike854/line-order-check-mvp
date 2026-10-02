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

  normalizeWorkbenchLimit,
  normalizeWorkbenchOffset,
  resolveWorkbenchClaimState,
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

    claim_state:
      row.claim_state
      ?? "UNAVAILABLE",

    claimed_by_staff_id:
      row.claimed_by_staff_id
      ?? row.claim_staff_id
      ?? null,

    claimed_by_staff_code:
      row.claimed_by_staff_code
      ?? row.claim_staff_code
      ?? null,

    claimed_by_display_name:
      row.claimed_by_display_name
      ?? row.claim_display_name
      ?? null,

    claimed_at:
      row.claimed_at
      ?? null,

    claim_expires_at:
      row.claim_expires_at
      ?? null,

    lease_version:
      row.lease_version
      ?? null,

    created_at:
      row.review_created_at
      ?? row.message_created_at
      ?? row.event_timestamp
      ?? null,
  };
}



async function loadStaffOpenReviewReadModel(
  client,
  {
    settlementSessionId,
    lineGroupIds,
    summaryGroupId = null,
    actorStaffId = null,
    limit = 100,
    offset = 0,
  },
) {
  if (
    !settlementSessionId
    || !lineGroupIds?.length
  ) {
    return {
      workItems: [],
    };
  }

  const safeLimit =
    normalizeWorkbenchLimit(
      limit,
    );

  const safeOffset =
    normalizeWorkbenchOffset(
      offset,
    );

  /*
   * Staff Review First Paint Hotfix V1
   *
   * Do not load Summary / RECENT / PRIORITY / HIGH_TOTAL.
   * Current Review needs only its bounded Review page
   * plus claim state required for safe mutation.
   */
  const reviewResult =
    await client.rpc(
      "staff_workbench_open_reviews",
      {
        p_settlement_session_id:
          settlementSessionId,

        p_line_group_ids:
          lineGroupIds,

        p_summary_group_id:
          summaryGroupId,

        p_limit:
          safeLimit,

        p_offset:
          safeOffset,
      },
    );

  if (reviewResult.error) {
    throw reviewResult.error;
  }

  const rows =
    reviewResult.data ?? [];

  if (!rows.length) {
    return {
      workItems: [],
    };
  }

  const messageRecordIds = [
    ...new Set(
      rows
        .map(
          (row) =>
            row.message_record_id,
        )
        .filter(Boolean),
    ),
  ];

  let claimRows = [];

  if (messageRecordIds.length) {
    const claimResult =
      await client.rpc(
        "staff_workbench_claim_state",
        {
          p_message_record_ids:
            messageRecordIds,
        },
      );

    if (claimResult.error) {
      throw claimResult.error;
    }

    claimRows =
      claimResult.data ?? [];
  }

  const staffIds = [
    ...new Set(
      claimRows
        .map(
          (row) =>
            row.staff_id,
        )
        .filter(Boolean),
    ),
  ];

  const staffById =
    new Map();

  if (staffIds.length) {
    const {
      data: staffRows,
      error: staffError,
    } = await client
      .from(
        "staff_accounts",
      )
      .select(
        "id,staff_code,display_name",
      )
      .in(
        "id",
        staffIds,
      );

    if (staffError) {
      throw staffError;
    }

    for (
      const staff
      of staffRows ?? []
    ) {
      staffById.set(
        staff.id,
        staff,
      );
    }
  }

  const claimByMessage =
    new Map();

  for (
    const claim
    of claimRows
  ) {
    const staff =
      staffById.get(
        claim.staff_id,
      );

    const staffId =
      claim.staff_id
      ?? null;

    const staffCode =
      staff?.staff_code
      ?? claim.staff_code
      ?? null;

    const displayName =
      staff?.display_name
      ?? claim.staff_display_name
      ?? null;

    const expiresAt =
      claim.claim_expires_at
      ?? null;

    claimByMessage.set(
      claim.message_record_id,
      {
        // Existing internal Workbench contract.
        claim_staff_id:
          staffId,

        claim_staff_code:
          staffCode,

        claim_display_name:
          displayName,

        // Browser/public contract.
        claimed_by_staff_id:
          staffId,

        claimed_by_staff_code:
          staffCode,

        claimed_by_display_name:
          displayName,

        claimed_at:
          claim.claimed_at
          ?? null,

        claim_expires_at:
          expiresAt,

        lease_version:
          claim.lease_version
          ?? null,

        claim_state:
          resolveWorkbenchClaimState({
            actorStaffId,
            claimStaffId:
              staffId,
            claimExpiresAt:
              expiresAt,
          }),
      },
    );
  }

  const unclaimed = {
    claim_staff_id: null,
    claim_staff_code: null,
    claim_display_name: null,

    claimed_by_staff_id: null,
    claimed_by_staff_code: null,
    claimed_by_display_name: null,

    claimed_at: null,
    claim_expires_at: null,
    lease_version: null,

    claim_state:
      "AVAILABLE",
  };

  return {
    workItems:
      rows.map(
        (row) => ({
          ...row,

          ...(
            claimByMessage.get(
              row.message_record_id,
            )
            ?? unclaimed
          ),
        }),
      ),
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
      await loadStaffOpenReviewReadModel(
        supabase,
        {
          settlementSessionId:
            session.id,

          lineGroupIds,

          summaryGroupId,

          actorStaffId:
            auth.actor.staff_id,

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
  region: "sin",
};
