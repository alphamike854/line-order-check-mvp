import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import {
  buildStaffWorkbenchPayload,
  normalizeWorkbenchLimit,
  normalizeWorkbenchOffset,
} from "./src/lib/staff-workbench.mjs";


const migration =
  await readFile(
    "supabase/migrations/20260902072000_add_staff_workbench_read_model.sql",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-workbench.mjs",
    "utf8",
  );

const api =
  await readFile(
    "netlify/functions/staff-workbench.mjs",
    "utf8",
  );


assert.match(
  migration,
  /staff_workbench_summary/,
  "R2D1B-01 summary fast path exists",
);

assert.match(
  migration,
  /staff_workbench_open_reviews/,
  "R2D1B-02 bounded work-item fast path exists",
);

assert.match(
  migration,
  /settlement_line_group_config/,
  "R2D1B-03 workbench uses settlement LINE Group snapshot",
);

assert.match(
  migration,
  /distinct on\s*\(\s*r\.summary_group_id\s*\)/i,
  "R2D1B-04 latest Summary Group Round is selected",
);

assert.match(
  migration,
  /r\.round_no desc/i,
  "R2D1B-05 latest round is determined by round number",
);

assert.match(
  migration,
  /oi\.unsent_flag = false/i,
  "R2D1B-06 order totals count only active canonical items",
);

assert.match(
  migration,
  /review\.status = 'OPEN'/i,
  "R2D1B-07 current pending Review count uses OPEN status",
);

assert.match(
  migration,
  /m\.unsent = false/i,
  "R2D1B-08 unsent messages are excluded from work",
);

assert.match(
  migration,
  /sum\(oi\.quantity\)::bigint/i,
  "R2D1B-09 message order total comes from canonical quantities",
);

assert.match(
  migration,
  /jsonb_agg\(/i,
  "R2D1B-10 canonical system-read items are returned per message",
);

assert.match(
  migration,
  /limit greatest\(/i,
  "R2D1B-11 work item result is bounded",
);

assert.match(
  migration,
  /grant execute[\s\S]*to service_role/i,
  "R2D1B-12 read model follows service-role security boundary",
);

assert.match(
  helper,
  /\.from\(\s*"line_group_staff_assignments"/,
  "R2D1B-13 Staff scope comes from assignments",
);

assert.match(
  helper,
  /\.from\(\s*"settlement_line_group_config"/,
  "R2D1B-14 actor scope is intersected with settlement snapshot",
);

assert.doesNotMatch(
  helper,
  /\.from\("line_groups"\)/,
  "R2D1B-15 workbench scope does not depend on live LINE Group mapping",
);

assert.match(
  api,
  /authenticateWorkbenchActor/,
  "R2D1B-16 API uses authenticated Staff/Admin identity",
);

assert.match(
  api,
  /fetchOpenSettlementSession/,
  "R2D1B-17 API resolves current settlement container",
);

assert.match(
  api,
  /loadActorSessionLineGroupIds/,
  "R2D1B-18 API limits data to actor LINE Group scope",
);

assert.match(
  api,
  /loadStaffWorkbenchReadModel/,
  "R2D1B-19 API uses bounded database read model",
);

assert.doesNotMatch(
  api,
  /image_storage_path/,
  "R2D1B-20 private image storage paths are not exposed by API",
);


assert.equal(
  normalizeWorkbenchLimit(
    null,
  ),
  100,
  "R2D1B-21 default work-item limit is 100",
);

assert.equal(
  normalizeWorkbenchLimit(
    "",
  ),
  100,
  "R2D1B-22 empty work-item limit uses default 100",
);

assert.equal(
  normalizeWorkbenchLimit(
    999,
  ),
  200,
  "R2D1B-23 work-item limit is capped at 200",
);

assert.equal(
  normalizeWorkbenchOffset(
    -5,
  ),
  0,
  "R2D1B-24 invalid offset fails safe to zero",
);


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

      business_date:
        "2026-09-02",
    },

    summaryRows: [
      {
        summary_group_id:
          "NORTH",

        summary_group_name:
          "NORTH",

        line_group_id:
          "LINE-A",

        line_group_name:
          "LINE Group A",

        summary_group_round_id:
          "round-1",

        round_no:
          1,

        round_status:
          "OPEN",

        order_total:
          8240,

        open_review_count:
          22,
      },

      {
        summary_group_id:
          "NORTH",

        summary_group_name:
          "NORTH",

        line_group_id:
          "LINE-B",

        line_group_name:
          "LINE Group B",

        summary_group_round_id:
          "round-1",

        round_no:
          1,

        round_status:
          "OPEN",

        order_total:
          10210,

        open_review_count:
          12,
      },
    ],

    workItems: [
      {
        review_id:
          101,

        message_record_id:
          "message-1",

        summary_group_id:
          "NORTH",

        summary_group_name:
          "NORTH",

        line_group_id:
          "LINE-A",

        line_group_name:
          "LINE Group A",

        summary_group_round_id:
          "round-1",

        round_no:
          1,

        round_status:
          "OPEN",

        event_timestamp:
          "2026-09-02T12:31:14+07:00",

        message_type:
          "text",

        display_text:
          "01 02 03 = 20",

        parse_status:
          "PARSED",

        reason_codes:
          [],

        warnings:
          [],

        has_image_evidence:
          false,

        message_order_total:
          60,

        items: [
          {
            category: "A",
            code: "01",
            quantity: 20,
          },
          {
            category: "A",
            code: "02",
            quantity: 20,
          },
          {
            category: "A",
            code: "03",
            quantity: 20,
          },
        ],
      },
    ],

    limit:
      100,

    offset:
      0,
  });


assert.equal(
  payload.overall.order_total,
  18450,
  "R2D1B-25 assigned Workbench order total is aggregated",
);

assert.equal(
  payload.summary_groups[0]
    .order_total,
  18450,
  "R2D1B-26 Summary Group order total is aggregated",
);

assert.equal(
  payload.summary_groups[0]
    .line_groups[0]
    .order_total,
  8240,
  "R2D1B-28 LINE Group order total is preserved",
);

assert.equal(
  payload.summary_groups[0]
    .line_groups[0]
    .open_review_count,
  22,
  "R2D1B-27 LINE Group pending Review count is preserved",
);

assert.equal(
  payload.work_items[0]
    .line_group_name,
  "LINE Group A",
  "R2D1B-30 every work card carries LINE Group name",
);

assert.equal(
  payload.work_items[0]
    .message_order_total,
  60,
  "R2D1B-29 every work card carries message order total",
);

assert.deepEqual(
  payload.work_items[0]
    .items
    .map(
      (item) =>
        `${item.category}${item.code}:${item.quantity}`,
    ),
  [
    "A01:20",
    "A02:20",
    "A03:20",
  ],
  "R2D1B-31 work card carries canonical system-read items",
);


console.log(
  "PASS: R2D1B Assigned Workbench Read Model + Order Totals",
);
