import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";

import {
  buildCurrentRoundScope,
  selectCurrentSummaryGroupRounds,
} from "./src/lib/dashboard-round-context.mjs";


const api =
  readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

const dashboard =
  readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const freshness =
  readFileSync(
    "netlify/functions/dashboard-freshness.mjs",
    "utf8",
  );

const reviews =
  readFileSync(
    "netlify/functions/reviews.mjs",
    "utf8",
  );

const unsends =
  readFileSync(
    "netlify/functions/unsends.mjs",
    "utf8",
  );

const roundModule =
  readFileSync(
    "src/lib/dashboard-round-context.mjs",
    "utf8",
  );


function blockBetween(
  source,
  start,
  end,
) {
  const startIndex =
    source.indexOf(start);

  assert.ok(
    startIndex >= 0,
    `missing start marker: ${start}`,
  );

  const endIndex =
    source.indexOf(
      end,
      startIndex + start.length,
    );

  assert.ok(
    endIndex > startIndex,
    `missing end marker: ${end}`,
  );

  return source.slice(
    startIndex,
    endIndex,
  );
}


const rows = [
  {
    id: "N1",
    summary_group_id: "NORTH",
    round_no: 7,
    business_date: "2026-09-10",
    daily_round_no: 1,
    status: "CLOSED",
  },
  {
    id: "N2",
    summary_group_id: "NORTH",
    round_no: 8,
    business_date: "2026-09-11",
    daily_round_no: 1,
    status: "CLOSED",
  },
  {
    id: "S3",
    summary_group_id: "SOUTH",
    round_no: 3,
    business_date: "2026-09-10",
    daily_round_no: 2,
    status: "OPEN",
  },
];


assert.deepEqual(
  selectCurrentSummaryGroupRounds(
    rows,
  ).map(
    (row) => row.id,
  ),
  [
    "N2",
    "S3",
  ],
);

console.log(
  "PASS DR1D-C1-01: latest OPEN/CLOSED Round selected independently",
);


const north =
  buildCurrentRoundScope(
    rows,
    "NORTH",
  );

assert.deepEqual(
  north.roundIds,
  ["N2"],
);

assert.equal(
  north.businessDate,
  "2026-09-11",
);

console.log(
  "PASS DR1D-C1-02: selected group owns one current Round/date",
);


const all =
  buildCurrentRoundScope(
    rows,
  );

assert.deepEqual(
  all.businessDates,
  [
    "2026-09-10",
    "2026-09-11",
  ],
);

assert.equal(
  all.businessDate,
  null,
);

console.log(
  "PASS DR1D-C1-03: ALL does not invent one business date",
);


assert.match(
  roundModule,
  /\.in\(\s*"status"[\s\S]*"OPEN"[\s\S]*"CLOSED"/,
);

assert.match(
  roundModule,
  /\.order\(\s*"round_no"[\s\S]*ascending:\s*false/,
);

console.log(
  "PASS DR1D-C1-04: resolver follows latest OPEN/CLOSED round_no",
);


const reviewBlock =
  blockBetween(
    api,
    "export async function fetchOpenReviews(",
    "export async function fetchOpenReviewCount(",
  );

assert.match(
  reviewBlock,
  /\.in\(\s*"summary_group_round_id"\s*,\s*normalizedRoundIds\s*,?\s*\)/,
);

assert.doesNotMatch(
  reviewBlock,
  /\.eq\(\s*"business_date"/,
);

console.log(
  "PASS DR1D-C1-05: detailed Review feed is Round scoped",
);


const countBlock =
  blockBetween(
    api,
    "export async function fetchOpenReviewCount(",
    "export async function fetchUnsends(",
  );

assert.match(
  countBlock,
  /\.select\("id"\)/,
);

assert.match(
  countBlock,
  /\.in\(\s*"summary_group_round_id"\s*,\s*normalizedRoundIds\s*,?\s*\)/,
);

assert.match(
  countBlock,
  /count:\s*"exact"/,
);

assert.match(
  countBlock,
  /head:\s*true/,
);

assert.doesNotMatch(
  countBlock,
  /\.eq\(\s*"business_date"/,
);

console.log(
  "PASS DR1D-C1-06: Review count remains lightweight + Round scoped",
);


const unsendBlock =
  blockBetween(
    api,
    "export async function fetchUnsends(",
    "export async function loadParserConfig(",
  );

assert.match(
  unsendBlock,
  /\.from\("messages"\)/,
);

assert.match(
  unsendBlock,
  /\.in\(\s*"summary_group_round_id"\s*,\s*normalizedRoundIds\s*,?\s*\)/,
);

assert.match(
  unsendBlock,
  /\.in\(\s*"matched_message_record_id"\s*,\s*ids\s*,?\s*\)/,
);

assert.doesNotMatch(
  unsendBlock,
  /bangkokDayRange/,
);

assert.doesNotMatch(
  unsendBlock,
  /\.gte\(\s*"unsent_at"/,
);

console.log(
  "PASS DR1D-C1-07: UNSEND follows accepted-message Round ownership",
);


assert.match(
  dashboard,
  /loadDashboardRoundContext/,
);

assert.match(
  dashboard,
  /\.in\(\s*"summary_group_round_id"\s*,\s*messageRoundIds\s*\)/,
);

assert.match(
  dashboard,
  /fetchOpenReviewCount\(\s*messageRoundIds/,
);

assert.match(
  dashboard,
  /fetchUnsends\(\s*messageRoundIds/,
);

assert.doesNotMatch(
  dashboard,
  /fetchOpenReviewCount\(\s*session\.business_date/,
);

assert.doesNotMatch(
  dashboard,
  /fetchUnsends\(\s*session\.business_date/,
);

console.log(
  "PASS DR1D-C1-08: Dashboard message/Review/UNSEND uses current Rounds",
);


assert.match(
  dashboard,
  /business_date:roundContext\.businessDate/,
);

assert.match(
  dashboard,
  /business_dates:roundContext\.businessDates/,
);

assert.match(
  dashboard,
  /current_rounds:roundContext\.rounds/,
);

assert.doesNotMatch(
  dashboard,
  /business_date:session\.business_date/,
);

console.log(
  "PASS DR1D-C1-09: parent session date no longer presented as active Round date",
);


assert.match(
  freshness,
  /loadDashboardRoundContext/,
);

assert.match(
  freshness,
  /\.in\(\s*"summary_group_round_id"\s*,\s*messageRoundIds\s*\)/,
);

assert.match(
  freshness,
  /current_rounds:roundContext\.rounds/,
);

console.log(
  "PASS DR1D-C1-10: freshness message timestamp is Round scoped",
);


assert.match(
  reviews,
  /loadDashboardRoundContext/,
);

assert.match(
  reviews,
  /fetchOpenReviews\(\s*roundContext\.roundIds/,
);

assert.doesNotMatch(
  reviews,
  /session\.business_date/,
);

console.log(
  "PASS DR1D-C1-11: Review endpoint delegates current Round IDs",
);


assert.match(
  unsends,
  /loadDashboardRoundContext/,
);

assert.match(
  unsends,
  /fetchUnsends\(\s*roundContext\.roundIds/,
);

assert.doesNotMatch(
  unsends,
  /\.from\("messages"\)/,
);

assert.doesNotMatch(
  unsends,
  /session\.business_date/,
);

console.log(
  "PASS DR1D-C1-12: UNSEND endpoint shares Round boundary",
);


assert.match(
  dashboard,
  /dashboard_risk_snapshot/,
);

assert.match(
  dashboard,
  /p_settlement_session_id:session\.id/,
);

console.log(
  "PASS DR1D-C1-13: Accounting/Risk remains deferred",
);


console.log(
  "PASS: DR1D-C1 DASHBOARD/REVIEW CURRENT-ROUND READ MODEL",
);
