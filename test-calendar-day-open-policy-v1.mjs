import assert from "node:assert/strict";
import fs from "node:fs";

const lifecyclePath =
  "supabase/migrations/" +
  "20260902043000_add_independent_summary_group_round_lifecycle.sql";

const dailyIdentityPath =
  "supabase/migrations/" +
  "20260911153000_add_daily_summary_group_round_identity.sql";

const settlementApiPath =
  "netlify/functions/settlement.mjs";

const browserPath =
  "public/app.js";

const lifecycle =
  fs.readFileSync(
    lifecyclePath,
    "utf8",
  );

const dailyIdentity =
  fs.readFileSync(
    dailyIdentityPath,
    "utf8",
  );

const settlementApi =
  fs.readFileSync(
    settlementApiPath,
    "utf8",
  );

const browser =
  fs.readFileSync(
    browserPath,
    "utf8",
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      "package.json",
      "utf8",
    ),
  );


console.log(
  "===== Calendar-Day OPEN Policy v1 =====",
);


// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function sqlFunction(
  source,
  functionName,
) {
  const startPattern =
    new RegExp(
      String.raw`create\s+or\s+replace\s+function\s+public\.${functionName}\s*\(`,
      "i",
    );

  const match =
    startPattern.exec(source);

  assert.ok(
    match,
    `${functionName} must exist`,
  );

  const start =
    match.index;

  const end =
    source.indexOf(
      "\n$$;",
      start,
    );

  assert.notEqual(
    end,
    -1,
    `${functionName} must have a complete SQL body`,
  );

  return source.slice(
    start,
    end + 4,
  );
}


function jsFunction(
  source,
  signature,
) {
  const start =
    source.indexOf(signature);

  assert.notEqual(
    start,
    -1,
    `${signature} must exist`,
  );

  const afterSignature =
    start + signature.length;

  const remainder =
    source.slice(afterSignature);

  const nextFunction =
    /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(
      remainder,
    );

  const end =
    nextFunction
      ? afterSignature
        + nextFunction.index
      : source.length;

  return source.slice(
    start,
    end,
  );
}


// Calendar-day classification must never decide whether OPEN_GROUP
// is permitted.
//
// Deliberately NOT checking hour/time-of-day rules here.
// "every calendar day" does not mean "24 hours per day".
const calendarDayBlocker =
  /(?:\bweekday\b|\bweekend\b|\bsaturday\b|\bsunday\b|\bpublic[_ -]?holiday\b|\bholiday\b|\bis_business_day\b|\bworking_day\b|วันหยุด|วันเสาร์|วันอาทิตย์|extract\s*\(\s*(?:iso)?dow\b|date_part\s*\(\s*['"](?:dow|isodow)['"]|\.get(?:UTC)?Day\s*\()/iu;


// ------------------------------------------------------------
// CAL1-01
// Explicit seven-calendar-day contract.
// 2026-09-07 through 2026-09-13 covers Monday through Sunday.
// ------------------------------------------------------------

const sevenCalendarDays = [
  ["MONDAY",    "2026-09-07", 1],
  ["TUESDAY",   "2026-09-08", 2],
  ["WEDNESDAY", "2026-09-09", 3],
  ["THURSDAY",  "2026-09-10", 4],
  ["FRIDAY",    "2026-09-11", 5],
  ["SATURDAY",  "2026-09-12", 6],
  ["SUNDAY",    "2026-09-13", 0],
];

assert.equal(
  sevenCalendarDays.length,
  7,
);

const coveredDays =
  new Set();

for (
  const [
    label,
    date,
    expectedDay,
  ]
  of sevenCalendarDays
) {
  const actualDay =
    new Date(
      `${date}T00:00:00Z`,
    ).getUTCDay();

  assert.equal(
    actualDay,
    expectedDay,
    `${label} fixture must retain its expected weekday`,
  );

  coveredDays.add(
    actualDay,
  );
}

assert.equal(
  coveredDays.size,
  7,
);

console.log(
  "PASS CAL1-01: explicit Monday-Sunday calendar coverage",
);


// ------------------------------------------------------------
// CAL1-02
// Authoritative accepting state is lifecycle-only:
// OPEN Round + OPEN parent settlement.
// ------------------------------------------------------------

const acceptingPredicate =
  sqlFunction(
    lifecycle,
    "is_settlement_summary_group_accepting",
  );

assert.match(
  acceptingPredicate,
  /r\.status\s*=\s*'OPEN'/i,
);

assert.match(
  acceptingPredicate,
  /s\.status\s*=\s*'OPEN'/i,
);

assert.doesNotMatch(
  acceptingPredicate,
  calendarDayBlocker,
);

console.log(
  "PASS CAL1-02: accepting state depends on lifecycle, not day class",
);


// ------------------------------------------------------------
// CAL1-03
// OPEN_GROUP DB mutation must not classify calendar day.
// ------------------------------------------------------------

const openMutation =
  sqlFunction(
    lifecycle,
    "set_settlement_summary_group_accepting",
  );

assert.match(
  openMutation,
  /p_accepting_orders/i,
);

assert.match(
  openMutation,
  /insert\s+into[\s\S]*settlement_summary_group_rounds[\s\S]*'OPEN'/i,
);

assert.doesNotMatch(
  openMutation,
  calendarDayBlocker,
);

console.log(
  "PASS CAL1-03: OPEN_GROUP DB lifecycle has no weekday/weekend/holiday gate",
);


// ------------------------------------------------------------
// CAL1-04
// Round business_date is derived from the Bangkok calendar date
// of opened_at, regardless of weekday classification.
// ------------------------------------------------------------

const dailyIdentityFunction =
  sqlFunction(
    dailyIdentity,
    "assign_summary_group_round_daily_identity",
  );

assert.match(
  dailyIdentityFunction,
  /at\s+time\s+zone\s+'Asia\/Bangkok'/i,
);

assert.match(
  dailyIdentityFunction,
  /new\.business_date/i,
);

assert.doesNotMatch(
  dailyIdentityFunction,
  calendarDayBlocker,
);

console.log(
  "PASS CAL1-04: business_date is Bangkok calendar date without day-class exclusion",
);


// ------------------------------------------------------------
// CAL1-05
// HTTP OPEN_GROUP route delegates directly to the lifecycle
// mutation and does not introduce a calendar-day gate.
// ------------------------------------------------------------

const apiOpenStart =
  settlementApi.indexOf(
    'if (action === "OPEN_GROUP")',
  );

const apiCloseStart =
  settlementApi.indexOf(
    'if (action === "CLOSE_GROUP")',
    apiOpenStart,
  );

assert.notEqual(
  apiOpenStart,
  -1,
);

assert.ok(
  apiCloseStart > apiOpenStart,
);

const apiOpenRoute =
  settlementApi.slice(
    apiOpenStart,
    apiCloseStart,
  );

assert.match(
  apiOpenRoute,
  /changeSummaryGroupState[\s\S]*true/i,
);

assert.doesNotMatch(
  apiOpenRoute,
  calendarDayBlocker,
);

console.log(
  "PASS CAL1-05: settlement API OPEN_GROUP has no calendar-day blocker",
);


// ------------------------------------------------------------
// CAL1-06
// Operator UI must expose OPEN_GROUP without weekday,
// weekend or public-holiday classification.
// ------------------------------------------------------------

const browserOpenFunction =
  jsFunction(
    browser,
    "async function changeSettlementSummaryGroup(",
  );

assert.match(
  browserOpenFunction,
  /nextAccepting[\s\S]*"OPEN_GROUP"[\s\S]*"CLOSE_GROUP"/i,
);

assert.doesNotMatch(
  browserOpenFunction,
  calendarDayBlocker,
);

console.log(
  "PASS CAL1-06: operator OPEN action has no calendar-day blocker",
);


// ------------------------------------------------------------
// CAL1-07
// Saturday and Sunday are explicitly protected against future
// introduction of a day-class gate.
// ------------------------------------------------------------

const weekendFixtures =
  sevenCalendarDays.filter(
    ([label]) =>
      label === "SATURDAY"
      || label === "SUNDAY",
  );

assert.deepEqual(
  weekendFixtures.map(
    ([label]) => label,
  ),
  [
    "SATURDAY",
    "SUNDAY",
  ],
);

for (
  const source
  of [
    acceptingPredicate,
    openMutation,
    dailyIdentityFunction,
    apiOpenRoute,
    browserOpenFunction,
  ]
) {
  assert.doesNotMatch(
    source,
    calendarDayBlocker,
  );
}

console.log(
  "PASS CAL1-07: Saturday/Sunday cannot become OPEN blockers",
);


// ------------------------------------------------------------
// CAL1-08
// Public-holiday classification is intentionally absent.
// There is no holiday calendar / business-day lookup in the
// authoritative OPEN path.
// ------------------------------------------------------------

const authoritativeOpenPath =
  [
    acceptingPredicate,
    openMutation,
    dailyIdentityFunction,
    apiOpenRoute,
    browserOpenFunction,
  ].join("\n");

assert.doesNotMatch(
  authoritativeOpenPath,
  /\bholiday\b|public[_ -]?holiday|วันหยุด|is_business_day|working_day/iu,
);

console.log(
  "PASS CAL1-08: public-holiday classification is not an OPEN gate",
);


// ------------------------------------------------------------
// CAL1-09
// Existing lifecycle safeguards stay present.
// Calendar-day freedom must not weaken lifecycle safety.
// ------------------------------------------------------------

assert.match(
  acceptingPredicate,
  /settlement_summary_group_rounds/i,
);

assert.match(
  acceptingPredicate,
  /settlement_sessions/i,
);

assert.match(
  openMutation,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/i,
);

assert.match(
  openMutation,
  /SETTLEMENT_SUMMARY_GROUP_CONTROL/i,
);

console.log(
  "PASS CAL1-09: lifecycle/concurrency safeguards remain authoritative",
);


// ------------------------------------------------------------
// CAL1-10
// Permanent regression must be part of npm test.
// ------------------------------------------------------------

const standardTest =
  String(
    pkg?.scripts?.test
    ?? "",
  );

assert.ok(
  standardTest.includes(
    "test-calendar-day-open-policy-v1.mjs",
  ),
  "calendar-day OPEN regression must be registered in npm test",
);

console.log(
  "PASS CAL1-10: calendar-day contract is registered in full regression",
);


console.log(
  "PASS: Calendar-Day OPEN Policy v1",
);
