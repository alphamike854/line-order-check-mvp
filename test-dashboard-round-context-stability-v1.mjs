import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";

import {
  sameDashboardRoundScope,
} from "./src/lib/dashboard-round-context.mjs";


const dashboard =
  readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );


// D1A-01: ordering differences do not create false race.
assert.equal(
  sameDashboardRoundScope(
    {
      roundIds: [
        "ROUND-B",
        "ROUND-A",
      ],
    },
    {
      roundIds: [
        "ROUND-A",
        "ROUND-B",
      ],
    },
  ),
  true,
);

console.log(
  "PASS DR1D-D1A-01: Round-scope comparison is order-independent",
);


// D1A-02: duplicate IDs do not create false mismatch.
assert.equal(
  sameDashboardRoundScope(
    {
      roundIds: [
        "ROUND-A",
        "ROUND-A",
      ],
    },
    {
      roundIds: [
        "ROUND-A",
      ],
    },
  ),
  true,
);

console.log(
  "PASS DR1D-D1A-02: Round-scope comparison is duplicate-safe",
);


// D1A-03: changed Round identity is detected.
assert.equal(
  sameDashboardRoundScope(
    {
      roundIds: [
        "NORTH-8",
        "SOUTH-4",
      ],
    },
    {
      roundIds: [
        "NORTH-9",
        "SOUTH-4",
      ],
    },
  ),
  false,
);

console.log(
  "PASS DR1D-D1A-03: OPEN/REOPEN Round change is detectable",
);


// D1A-04: empty/non-empty transition is detected.
assert.equal(
  sameDashboardRoundScope(
    {
      roundIds: [],
    },
    {
      roundIds: [
        "NORTH-1",
      ],
    },
  ),
  false,
);

console.log(
  "PASS DR1D-D1A-04: NOT_STARTED to active Round transition is detectable",
);


// D1A-05: Dashboard resolves Round context twice.
const resolverCall =
  "await loadDashboardRoundContext({";

const resolverCalls =
  dashboard
    .split(resolverCall)
    .length
    - 1;

assert.equal(
  resolverCalls,
  2,
  "Dashboard must resolve Round context before and after its read window",
);

console.log(
  "PASS DR1D-D1A-05: Dashboard has initial + final Round-context reads",
);


// D1A-06: final context is compared before consuming Risk payload.
const finalContextIndex =
  dashboard.indexOf(
    "const finalRoundContext="
  );

const compareIndex =
  dashboard.indexOf(
    "sameDashboardRoundScope("
  );

const errorIndex =
  dashboard.indexOf(
    '"DASHBOARD_ROUND_CONTEXT_CHANGED"'
  );

const riskConsumeIndex =
  dashboard.indexOf(
    "const riskSnapshot=riskSnapshotResult.data;"
  );

assert.ok(
  finalContextIndex >= 0,
);

assert.ok(
  compareIndex
    > finalContextIndex,
);

assert.ok(
  errorIndex
    > compareIndex,
);

assert.ok(
  riskConsumeIndex
    > errorIndex,
);

console.log(
  "PASS DR1D-D1A-06: Round drift fails before Risk payload consumption",
);


// D1A-07: accepted Risk RPC contract remains unchanged.
assert.match(
  dashboard,
  /"dashboard_risk_snapshot"/,
);

assert.match(
  dashboard,
  /p_settlement_session_id\s*:\s*session\.id/,
);

assert.match(
  dashboard,
  /p_summary_group_id\s*:\s*summaryGroupId\s*\?\?\s*null/,
);

assert.doesNotMatch(
  dashboard,
  /p_summary_group_round_ids/,
);

console.log(
  "PASS DR1D-D1A-07: existing Risk RPC signature remains unchanged",
);


// D1A-08: existing initial Round ownership still drives messages.
assert.match(
  dashboard,
  /\.in\(\s*"summary_group_round_id"\s*,\s*messageRoundIds\s*\)/,
);

console.log(
  "PASS DR1D-D1A-08: message metrics remain bound to initial current Rounds",
);


// D1A-09: Accounting is not part of Dashboard Risk stability patch.
assert.doesNotMatch(
  dashboard,
  /accounting_report_line_group_summary/,
);

console.log(
  "PASS DR1D-D1A-09: Risk stability remains isolated from Accounting",
);


console.log(
  "PASS: DR1D-D1A DASHBOARD/RISK ROUND-CONTEXT STABILITY",
);
