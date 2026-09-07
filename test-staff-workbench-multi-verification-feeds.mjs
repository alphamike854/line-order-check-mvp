import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildStaffWorkbenchPayload,
  loadStaffWorkbenchReadModel,
} from "./src/lib/staff-workbench.mjs";


const helper =
  fs.readFileSync(
    "src/lib/staff-workbench.mjs",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/staff-workbench.mjs",
    "utf8",
  );


// ------------------------------------------------------------
// Static server contract
// ------------------------------------------------------------

for (const mode of [
  "RECENT",
  "PRIORITY",
  "HIGH_TOTAL",
]) {
  assert.match(
    helper,
    new RegExp(
      `p_sort_mode:[\\s\\S]*?"${mode}"`,
    ),
    `missing ${mode} Verification feed`,
  );
}

for (const field of [
  "verification_items",
  "verification_pagination",
  "attention_items",
  "attention_pagination",
  "high_total_items",
  "high_total_pagination",
]) {
  assert.match(
    helper,
    new RegExp(field),
    `missing payload field ${field}`,
  );
}

for (const param of [
  "verification_limit",
  "verification_offset",
  "attention_limit",
  "attention_offset",
  "high_total_limit",
  "high_total_offset",
]) {
  assert.match(
    endpoint,
    new RegExp(param),
    `missing endpoint parameter ${param}`,
  );
}

assert.match(
  endpoint,
  /loadActorSessionLineGroupIds/,
  "LINE Group scope must remain server-resolved",
);

assert.doesNotMatch(
  endpoint,
  /searchParams\.get\(\s*["'](?:line_group|line_group_ids|lineGroupIds)["']/,
  "browser must not provide trusted LINE Group scope",
);

assert.equal(
  (
    helper.match(
      /"staff_workbench_claim_state"/g,
    ) ?? []
  ).length,
  1,
  "shared claim-state RPC must have one invocation site",
);


// ------------------------------------------------------------
// Test rows
// ------------------------------------------------------------

function verificationRow(
  id,
  {
    total = 10,
    needsInterpretation = false,
    parseStatus = "PARSED",
    reviewId = null,
  } = {},
) {
  return {
    message_record_id:
      id,

    review_id:
      reviewId,

    summary_group_id:
      "NORTH",

    summary_group_name:
      "NORTH",

    line_group_id:
      "LINE-A",

    line_group_name:
      "LINE A",

    summary_group_round_id:
      "round-1",

    round_no:
      1,

    round_status:
      "OPEN",

    event_timestamp:
      "2026-09-07T03:00:00Z",

    message_created_at:
      "2026-09-07T03:00:00Z",

    review_created_at:
      reviewId
        ? "2026-09-07T03:00:01Z"
        : null,

    user_id:
      "U1",

    message_type:
      "text",

    raw_text:
      id,

    normalized_text:
      id,

    ocr_text:
      null,

    display_text:
      id,

    parse_status:
      parseStatus,

    parser_version:
      "1.7.19",

    reason_codes:
      [],

    warnings:
      [],

    has_image_evidence:
      false,

    message_order_total:
      total,

    items:
      needsInterpretation
        ? []
        : [
            {
              category:
                "A",

              code:
                "01",

              quantity:
                total,
            },
          ],

    verification_status:
      "PENDING",

    needs_interpretation:
      needsInterpretation,
  };
}


// ------------------------------------------------------------
// Mock read boundary
// ------------------------------------------------------------

const rpcCalls = [];

const client = {
  async rpc(name, args) {
    rpcCalls.push({
      name,
      args,
    });

    if (
      name
      === "staff_workbench_summary"
    ) {
      return {
        data: [
          {
            summary_group_id:
              "NORTH",

            summary_group_name:
              "NORTH",

            line_group_id:
              "LINE-A",

            line_group_name:
              "LINE A",

            summary_group_round_id:
              "round-1",

            round_no:
              1,

            round_status:
              "OPEN",

            order_total:
              1000,

            open_review_count:
              4,
          },
        ],

        error:
          null,
      };
    }

    if (
      name
      === "staff_workbench_open_reviews"
    ) {
      return {
        data: [
          verificationRow(
            "message-review",
            {
              total:
                0,

              needsInterpretation:
                true,

              parseStatus:
                "REVIEW",

              reviewId:
                101,
            },
          ),
        ],

        error:
          null,
      };
    }

    if (
      name
      === "staff_workbench_pending_verifications"
    ) {
      switch (
        args.p_sort_mode
      ) {
        case "RECENT":
          return {
            data: [
              verificationRow(
                "message-shared",
                {
                  total:
                    50,
                },
              ),

              verificationRow(
                "message-recent",
                {
                  total:
                    40,
                },
              ),
            ],

            error:
              null,
          };

        case "PRIORITY":
          return {
            data: [
              verificationRow(
                "message-attention",
                {
                  total:
                    0,

                  needsInterpretation:
                    true,

                  parseStatus:
                    "REVIEW",
                },
              ),

              verificationRow(
                "message-shared",
                {
                  total:
                    50,
                },
              ),
            ],

            error:
              null,
          };

        case "HIGH_TOTAL":
          return {
            data: [
              verificationRow(
                "message-high",
                {
                  total:
                    900,
                },
              ),

              verificationRow(
                "message-shared",
                {
                  total:
                    50,
                },
              ),
            ],

            error:
              null,
          };

        default:
          throw new Error(
            `UNEXPECTED_SORT:${args.p_sort_mode}`,
          );
      }
    }

    if (
      name
      === "staff_workbench_claim_state"
    ) {
      return {
        data:
          [],

        error:
          null,
      };
    }

    throw new Error(
      `UNEXPECTED_RPC:${name}`,
    );
  },

  from(name) {
    throw new Error(
      `UNEXPECTED_TABLE_READ:${name}`,
    );
  },
};


// ------------------------------------------------------------
// Load all four views
// ------------------------------------------------------------

const readModel =
  await loadStaffWorkbenchReadModel(
    client,
    {
      settlementSessionId:
        "session-1",

      lineGroupIds:
        ["LINE-A"],

      limit:
        1,

      offset:
        0,

      verificationLimit:
        2,

      verificationOffset:
        4,

      attentionLimit:
        3,

      attentionOffset:
        5,

      highTotalLimit:
        4,

      highTotalOffset:
        6,
    },
  );


assert.equal(
  readModel.workItems.length,
  1,
);

assert.equal(
  readModel.verificationItems.length,
  2,
);

assert.equal(
  readModel.attentionItems.length,
  2,
);

assert.equal(
  readModel.highTotalItems.length,
  2,
);


// ------------------------------------------------------------
// Three independent Verification RPC calls
// ------------------------------------------------------------

const pendingCalls =
  rpcCalls.filter(
    (call) =>
      call.name
      === "staff_workbench_pending_verifications",
  );

assert.equal(
  pendingCalls.length,
  3,
);

const pendingByMode =
  new Map(
    pendingCalls.map(
      (call) => [
        call.args.p_sort_mode,
        call,
      ],
    ),
  );

assert.deepEqual(
  [
    ...pendingByMode.keys(),
  ].sort(),
  [
    "HIGH_TOTAL",
    "PRIORITY",
    "RECENT",
  ],
);

assert.deepEqual(
  {
    limit:
      pendingByMode
        .get("RECENT")
        .args.p_limit,

    offset:
      pendingByMode
        .get("RECENT")
        .args.p_offset,
  },
  {
    limit:
      2,

    offset:
      4,
  },
);

assert.deepEqual(
  {
    limit:
      pendingByMode
        .get("PRIORITY")
        .args.p_limit,

    offset:
      pendingByMode
        .get("PRIORITY")
        .args.p_offset,
  },
  {
    limit:
      3,

    offset:
      5,
  },
);

assert.deepEqual(
  {
    limit:
      pendingByMode
        .get("HIGH_TOTAL")
        .args.p_limit,

    offset:
      pendingByMode
        .get("HIGH_TOTAL")
        .args.p_offset,
  },
  {
    limit:
      4,

    offset:
      6,
  },
);


// ------------------------------------------------------------
// One deduplicated shared claim-state read
// ------------------------------------------------------------

const claimCalls =
  rpcCalls.filter(
    (call) =>
      call.name
      === "staff_workbench_claim_state",
  );

assert.equal(
  claimCalls.length,
  1,
  "claim state must be fetched exactly once",
);

assert.deepEqual(
  new Set(
    claimCalls[0]
      .args
      .p_message_record_ids,
  ),

  new Set([
    "message-review",
    "message-shared",
    "message-recent",
    "message-attention",
    "message-high",
  ]),

  "claim state must receive one deduplicated union",
);


// ------------------------------------------------------------
// Payload contract
// ------------------------------------------------------------

const payload =
  buildStaffWorkbenchPayload({
    actor: {
      staff_id:
        "staff-1",

      staff_code:
        "STAFF01",

      display_name:
        "Staff 01",

      role:
        "STAFF",

      is_admin:
        false,
    },

    session: {
      id:
        "session-1",
    },

    summaryRows:
      readModel.summaryRows,

    workItems:
      readModel.workItems,

    verificationItems:
      readModel.verificationItems,

    attentionItems:
      readModel.attentionItems,

    highTotalItems:
      readModel.highTotalItems,

    limit:
      1,

    offset:
      0,

    verificationLimit:
      2,

    verificationOffset:
      4,

    attentionLimit:
      3,

    attentionOffset:
      5,

    highTotalLimit:
      4,

    highTotalOffset:
      6,
  });


assert.equal(
  payload.work_items.length,
  1,
);

assert.deepEqual(
  payload.pagination,
  {
    limit:
      1,

    offset:
      0,

    returned:
      1,

    has_more:
      true,

    next_offset:
      1,
  },
);

assert.equal(
  payload.verification_items.length,
  2,
);

assert.equal(
  payload.attention_items.length,
  2,
);

assert.equal(
  payload.high_total_items.length,
  2,
);


assert.deepEqual(
  payload.verification_pagination,
  {
    sort_mode:
      "RECENT",

    limit:
      2,

    offset:
      4,

    returned:
      2,

    has_more:
      true,

    next_offset:
      6,
  },
);

assert.deepEqual(
  payload.attention_pagination,
  {
    sort_mode:
      "PRIORITY",

    limit:
      3,

    offset:
      5,

    returned:
      2,

    has_more:
      false,

    next_offset:
      7,
  },
);

assert.deepEqual(
  payload.high_total_pagination,
  {
    sort_mode:
      "HIGH_TOTAL",

    limit:
      4,

    offset:
      6,

    returned:
      2,

    has_more:
      false,

    next_offset:
      8,
  },
);


assert.equal(
  payload.high_total_items[0]
    .message_record_id,
  "message-high",
);

assert.equal(
  payload.high_total_items[0]
    .message_order_total,
  900,
);


console.log(
  "PASS: Staff Workbench multi-view Verification feeds",
);
