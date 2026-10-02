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
} from "../../src/lib/staff-workbench.mjs";

import {
  addScopedWorkbenchImageEvidence,
} from "../../src/lib/staff-workbench-image-evidence.mjs";


const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function nullClaim() {
  return {
    claim_staff_id: null,
    claim_staff_code: null,
    claim_display_name: null,
    claimed_at: null,
    claim_expires_at: null,
    lease_version: null,
  };
}


function noItem(session = null) {
  return json({
    ok: true,
    session:
      session
        ? {
            id: session.id,
            status: session.status,
          }
        : null,
    item: null,
  });
}


function queryData(result) {
  if (result?.error) {
    throw result.error;
  }

  return result?.data ?? null;
}


function reviewIsIgnored(review) {
  return (
    review?.resolution_type === "IGNORED"
    && (
      review?.status === "IGNORED"
      || review?.status === "RESOLVED"
    )
  );
}


function classifyVerificationStatus({
  message,
  review,
  verification,
  postClose,
}) {
  if (message?.unsent === true) {
    return "UNSENT";
  }

  if (
    postClose?.post_close_resolution_type
    === "CORRECTED"
  ) {
    return "HUMAN_CORRECTED";
  }

  if (
    postClose?.post_close_resolution_type
    === "IGNORED"
  ) {
    return "HUMAN_IGNORED";
  }

  if (
    verification?.verification_mode
    === "CORRECTED"
  ) {
    return "HUMAN_CORRECTED";
  }

  if (
    review?.resolution_type === "CORRECTED"
    && review?.status === "RESOLVED"
  ) {
    return "HUMAN_CORRECTED";
  }

  if (
    postClose?.source_resolution_type
    === "CORRECTED"
  ) {
    return "HUMAN_CORRECTED";
  }

  if (verification?.message_record_id) {
    return "HUMAN_VERIFIED";
  }

  if (reviewIsIgnored(review)) {
    return "HUMAN_IGNORED";
  }

  if (
    postClose?.source_resolution_type
    === "IGNORED"
  ) {
    return "HUMAN_IGNORED";
  }

  return "PENDING";
}


function effectiveItems({
  review,
  verification,
  postClose,
  canonicalItems,
}) {
  if (
    postClose?.post_close_resolution_type
    === "IGNORED"
  ) {
    return [];
  }

  if (reviewIsIgnored(review)) {
    return [];
  }

  if (
    postClose?.post_close_resolution_type
      === "CORRECTED"
    && Array.isArray(
      postClose?.post_close_items,
    )
  ) {
    return postClose.post_close_items;
  }

  if (
    verification?.message_record_id
    && Array.isArray(
      verification?.verified_order_items,
    )
  ) {
    return verification.verified_order_items;
  }

  return canonicalItems;
}


function itemQuantityTotal(items) {
  return (
    Array.isArray(items)
      ? items
      : []
  ).reduce(
    (sum, item) => {
      const quantity =
        Number(
          item?.quantity
          ?? 0,
        );

      return (
        sum
        + (
          Number.isFinite(quantity)
            ? quantity
            : 0
        )
      );
    },
    0,
  );
}


export default async function handler(req) {
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

    const url =
      new URL(req.url);

    const messageRecordId =
      String(
        url.searchParams.get(
          "message_record_id",
        )
        ?? "",
      ).trim();

    if (
      !UUID_RE.test(
        messageRecordId,
      )
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_MESSAGE_RECORD_ID",
        },
        400,
      );
    }

    const summaryGroupId =
      normalizeSummaryGroup(
        url.searchParams.get(
          "group",
        ),
      );

    const session =
      await fetchOpenSettlementSession();

    if (!session) {
      return noItem();
    }

    const lineGroupIds =
      await loadActorSessionLineGroupIds(
        supabase,
        auth.actor,
        session.id,
      );

    if (!lineGroupIds.length) {
      return noItem(
        session,
      );
    }

    let messageQuery =
      supabase
        .from(
          "messages",
        )
        .select(
          [
            "id",
            "settlement_session_id",
            "summary_group_id",
            "line_group_id",
            "summary_group_round_id",
            "event_timestamp",
            "created_at",
            "user_id",
            "message_type",
            "raw_text",
            "ocr_text",
            "normalized_text",
            "parse_status",
            "parser_version",
            "image_storage_path",
            "unsent",
          ].join(","),
        )
        .eq(
          "id",
          messageRecordId,
        )
        .eq(
          "settlement_session_id",
          session.id,
        )
        .in(
          "line_group_id",
          lineGroupIds,
        );

    if (summaryGroupId) {
      messageQuery =
        messageQuery.eq(
          "summary_group_id",
          summaryGroupId,
        );
    }

    const messageResult =
      await messageQuery
        .maybeSingle();

    const message =
      queryData(
        messageResult,
      );

    if (
      !message
      || !message.summary_group_id
      || !message.summary_group_round_id
    ) {
      return noItem(
        session,
      );
    }

    const [
      configResult,
      summaryGroupResult,
      roundResult,
      reviewResult,
      verificationResult,
      orderItemsResult,
      postCloseResult,
      claimResult,
    ] = await Promise.all([
      supabase
        .from(
          "settlement_line_group_config",
        )
        .select(
          "line_group_id,line_group_name,summary_group_id",
        )
        .eq(
          "settlement_session_id",
          session.id,
        )
        .eq(
          "line_group_id",
          message.line_group_id,
        )
        .eq(
          "summary_group_id",
          message.summary_group_id,
        )
        .maybeSingle(),

      supabase
        .from(
          "summary_groups",
        )
        .select(
          "id,name",
        )
        .eq(
          "id",
          message.summary_group_id,
        )
        .maybeSingle(),

      supabase
        .from(
          "settlement_summary_group_rounds",
        )
        .select(
          "id,summary_group_id,round_no,status",
        )
        .eq(
          "settlement_session_id",
          session.id,
        )
        .eq(
          "summary_group_id",
          message.summary_group_id,
        )
        .order(
          "round_no",
          {
            ascending: false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "review_items",
        )
        .select(
          "id,created_at,status,resolution_type,reason_codes,warnings",
        )
        .eq(
          "message_record_id",
          messageRecordId,
        )
        .order(
          "id",
          {
            ascending: false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "message_verifications",
        )
        .select(
          [
            "message_record_id",
            "verification_mode",
            "verified_normalized_text",
            "verified_parser_version",
            "verified_order_items",
          ].join(","),
        )
        .eq(
          "message_record_id",
          messageRecordId,
        )
        .maybeSingle(),

      supabase
        .from(
          "order_items",
        )
        .select(
          "category,code,quantity",
        )
        .eq(
          "message_record_id",
          messageRecordId,
        )
        .order(
          "category",
          {
            ascending: true,
          },
        )
        .order(
          "code",
          {
            ascending: true,
          },
        )
        .order(
          "quantity",
          {
            ascending: true,
          },
        ),

      supabase
        .from(
          "post_close_review_archive",
        )
        .select(
          [
            "id",
            "archived_at",
            "source_resolution_type",
            "post_close_resolution_type",
            "post_close_normalized_text",
            "post_close_parser_version",
            "post_close_items",
          ].join(","),
        )
        .eq(
          "source_message_record_id",
          messageRecordId,
        )
        .order(
          "archived_at",
          {
            ascending: false,
          },
        )
        .order(
          "id",
          {
            ascending: false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase.rpc(
        "staff_workbench_claim_state",
        {
          p_message_record_ids:
            [
              messageRecordId,
            ],
        },
      ),
    ]);

    const config =
      queryData(
        configResult,
      );

    const summaryGroup =
      queryData(
        summaryGroupResult,
      );

    const round =
      queryData(
        roundResult,
      );

    const review =
      queryData(
        reviewResult,
      );

    const verification =
      queryData(
        verificationResult,
      );

    const canonicalRows =
      queryData(
        orderItemsResult,
      )
      ?? [];

    const postClose =
      queryData(
        postCloseResult,
      );

    const claimRows =
      queryData(
        claimResult,
      )
      ?? [];

    /*
     * Exact lookup is valid only inside the same scope used by the
     * Timeline RPC: configured LINE Group + latest Summary Group Round.
     */
    if (
      !config
      || !summaryGroup
      || !round
      || String(
        round.id,
      ) !== String(
        message.summary_group_round_id,
      )
    ) {
      return noItem(
        session,
      );
    }

    const canonicalItems =
      canonicalRows.map(
        (row) => ({
          category:
            row.category,
          code:
            row.code,
          quantity:
            row.quantity,
        }),
      );

    const items =
      effectiveItems({
        review,
        verification,
        postClose,
        canonicalItems,
      });

    const verificationStatus =
      classifyVerificationStatus({
        message,
        review,
        verification,
        postClose,
      });

    const claim =
      claimRows.find(
        (row) =>
          String(
            row?.message_record_id
            ?? "",
          ) === messageRecordId,
      )
      ?? null;

    let claimFields =
      nullClaim();

    if (claim) {
      let staff = null;

      if (claim.staff_id) {
        const staffResult =
          await supabase
            .from(
              "staff_accounts",
            )
            .select(
              "id,staff_code,display_name",
            )
            .eq(
              "id",
              claim.staff_id,
            )
            .maybeSingle();

        staff =
          queryData(
            staffResult,
          );
      }

      claimFields = {
        claim_staff_id:
          claim.staff_id
          ?? null,

        claim_staff_code:
          staff?.staff_code
          ?? claim.staff_code
          ?? null,

        claim_display_name:
          staff?.display_name
          ?? claim.staff_display_name
          ?? null,

        claimed_at:
          claim.claimed_at
          ?? null,

        claim_expires_at:
          claim.claim_expires_at
          ?? null,

        lease_version:
          claim.lease_version
          ?? null,
      };
    }

    const item = {
      message_record_id:
        message.id,

      review_id:
        review?.id
        ?? null,

      summary_group_id:
        message.summary_group_id,

      summary_group_name:
        summaryGroup.name
        ?? message.summary_group_id,

      line_group_id:
        message.line_group_id,

      line_group_name:
        config.line_group_name
        ?? message.line_group_id,

      summary_group_round_id:
        round.id,

      round_no:
        round.round_no,

      round_status:
        round.status,

      event_timestamp:
        message.event_timestamp,

      message_created_at:
        message.created_at,

      review_created_at:
        review?.created_at
        ?? null,

      user_id:
        message.user_id,

      message_type:
        message.message_type,

      raw_text:
        message.raw_text,

      normalized_text:
        postClose
          ?.post_close_normalized_text
        ?? verification
          ?.verified_normalized_text
        ?? message.normalized_text,

      ocr_text:
        message.ocr_text,

      /*
       * Preserve Timeline semantics: display source text is based on
       * the original normalized/OCR/raw source, not corrected text.
       */
      display_text:
        message.normalized_text
        ?? message.ocr_text
        ?? message.raw_text
        ?? "",

      parse_status:
        message.parse_status,

      parser_version:
        postClose
          ?.post_close_parser_version
        ?? verification
          ?.verified_parser_version
        ?? message.parser_version,

      reason_codes:
        review?.reason_codes
        ?? [],

      warnings:
        review?.warnings
        ?? [],

      has_image_evidence:
        Boolean(
          message.image_storage_path,
        ),

      message_order_total:
        itemQuantityTotal(
          items,
        ),

      items,

      verification_status:
        verificationStatus,

      needs_interpretation:
        verificationStatus
          === "PENDING"
        && (
          message.parse_status
            !== "PARSED"
          || !Array.isArray(
            items,
          )
          || items.length === 0
        ),

      ...claimFields,
    };

    const imagePayload =
      await addScopedWorkbenchImageEvidence(
        supabase,
        {
          work_items: [],
          verification_items:
            [
              item,
            ],
          attention_items: [],
          high_total_items: [],
        },
      );

    const publicItem =
      imagePayload
        ?.verification_items
        ?.[0]
      ?? item;

    return json({
      ok: true,
      session: {
        id:
          session.id,
        status:
          session.status,
      },
      item:
        publicItem,
    });
  } catch (error) {
    console.error(
      "staff-verification-message failed",
      error,
    );

    return json(
      {
        ok: false,
        error:
          "STAFF_VERIFICATION_MESSAGE_FAILED",
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/staff-verification-message",
  region: "sin",
};
