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
// Static additive contract
// ------------------------------------------------------------

assert.match(
  helper,
  /staff_workbench_open_reviews/,
  "legacy Review feed must remain",
);

assert.match(
  helper,
  /staff_workbench_pending_verifications/,
  "pending Verification feed must be added",
);

assert.match(
  helper,
  /p_sort_mode:[\s\S]*?"RECENT"/,
  "server cutover must use RECENT, not PRIORITY",
);

assert.match(
  helper,
  /verification_items/,
);

assert.match(
  helper,
  /verification_pagination/,
);

assert.match(
  endpoint,
  /verification_limit/,
);

assert.match(
  endpoint,
  /verification_offset/,
);

assert.doesNotMatch(
  endpoint,
  /p_line_group_ids[\s\S]*url\.searchParams/,
  "trusted LINE Group scope must remain server-resolved",
);


// ------------------------------------------------------------
// Runtime read-model composition
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
            round_no: 1,
            round_status:
              "OPEN",
            order_total:
              1000,
            open_review_count:
              8,
          },
        ],
        error: null,
      };
    }

    if (
      name
      === "staff_workbench_open_reviews"
    ) {
      return {
        data: [
          {
            review_id: 101,
            message_record_id:
              "message-review",
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
            round_no: 1,
            round_status:
              "OPEN",
            event_timestamp:
              "2026-09-07T03:00:00Z",
            message_created_at:
              "2026-09-07T03:00:00Z",
            review_created_at:
              "2026-09-07T03:00:01Z",
            user_id:
              "U1",
            message_type:
              "text",
            display_text:
              "01=20",
            parse_status:
              "REVIEW",
            parser_version:
              "1.7.19",
            reason_codes: [],
            warnings: [],
            has_image_evidence:
              false,
            message_order_total:
              0,
            items: [],
          },
        ],
        error: null,
      };
    }

    if (
      name
      === "staff_workbench_pending_verifications"
    ) {
      return {
        data: [
          // Same message appears in Review and
          // Verification feeds: union must dedupe it.
          {
            message_record_id:
              "message-review",
            review_id: 101,
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
            round_no: 1,
            round_status:
              "OPEN",
            event_timestamp:
              "2026-09-07T03:00:00Z",
            message_created_at:
              "2026-09-07T03:00:00Z",
            review_created_at:
              "2026-09-07T03:00:01Z",
            user_id:
              "U1",
            message_type:
              "text",
            raw_text:
              "01=20",
            normalized_text:
              "01=20",
            ocr_text: null,
            display_text:
              "01=20",
            parse_status:
              "REVIEW",
            parser_version:
              "1.7.19",
            reason_codes: [],
            warnings: [],
            has_image_evidence:
              false,
            message_order_total:
              0,
            items: [],
            verification_status:
              "PENDING",
            needs_interpretation:
              true,
          },

          {
            message_record_id:
              "message-parsed",
            review_id: null,
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
            round_no: 1,
            round_status:
              "OPEN",
            event_timestamp:
              "2026-09-07T03:01:00Z",
            message_created_at:
              "2026-09-07T03:01:00Z",
            review_created_at:
              null,
            user_id:
              "U2",
            message_type:
              "text",
            raw_text:
              "02=50",
            normalized_text:
              "02=50",
            ocr_text: null,
            display_text:
              "02=50",
            parse_status:
              "PARSED",
            parser_version:
              "1.7.19",
            reason_codes: [],
            warnings: [],
            has_image_evidence:
              false,
            message_order_total:
              50,
            items: [
              {
                category: "A",
                code: "02",
                quantity: 50,
              },
            ],
            verification_status:
              "PENDING",
            needs_interpretation:
              false,
          },
        ],
        error: null,
      };
    }

    if (
      name
      === "staff_workbench_claim_state"
    ) {
      return {
        data: [],
        error: null,
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


const verificationCall =
  rpcCalls.find(
    (call) =>
      call.name
      === "staff_workbench_pending_verifications",
  );

assert.ok(
  verificationCall,
);

assert.equal(
  verificationCall.args.p_sort_mode,
  "RECENT",
);

assert.equal(
  verificationCall.args.p_limit,
  2,
);

assert.equal(
  verificationCall.args.p_offset,
  4,
);


const claimCall =
  rpcCalls.find(
    (call) =>
      call.name
      === "staff_workbench_claim_state",
  );

assert.ok(
  claimCall,
);

assert.deepEqual(
  new Set(
    claimCall.args
      .p_message_record_ids,
  ),
  new Set([
    "message-review",
    "message-parsed",
  ]),
  "claim-state read must use one deduplicated union",
);

assert.equal(
  rpcCalls.filter(
    (call) =>
      call.name
      === "staff_workbench_claim_state",
  ).length,
  1,
  "shared claim state must be read once",
);


// ------------------------------------------------------------
// Payload compatibility + new Verification feed
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

    limit:
      1,

    offset:
      0,

    verificationLimit:
      2,

    verificationOffset:
      4,
  });


assert.equal(
  payload.work_items.length,
  1,
  "legacy Review work_items remains intact",
);

assert.equal(
  payload.work_items[0].review_id,
  101,
);

assert.deepEqual(
  payload.pagination,
  {
    limit: 1,
    offset: 0,
    returned: 1,
    has_more: true,
    next_offset: 1,
  },
  "legacy Review pagination contract remains intact",
);


assert.equal(
  payload.verification_items.length,
  2,
);

const parsed =
  payload.verification_items.find(
    (item) =>
      item.message_record_id
      === "message-parsed",
  );

assert.ok(parsed);

assert.equal(
  parsed.review_id,
  null,
  "PARSED message does not require Review identity",
);

assert.equal(
  parsed.normalized_text,
  "02=50",
);

assert.equal(
  parsed.parser_version,
  "1.7.19",
);

assert.deepEqual(
  parsed.items,
  [
    {
      category: "A",
      code: "02",
      quantity: 50,
    },
  ],
);

assert.equal(
  parsed.verification_status,
  "PENDING",
);

assert.equal(
  parsed.needs_interpretation,
  false,
);

assert.equal(
  parsed.claim_state,
  "AVAILABLE",
);


assert.deepEqual(
  payload.verification_pagination,
  {
    sort_mode: "RECENT",
    limit: 2,
    offset: 4,
    returned: 2,
    has_more: true,
    next_offset: 6,
  },
);


console.log(
  "PASS: Staff Workbench Pending Verification additive cutover",
);
