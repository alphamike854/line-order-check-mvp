import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(
  fileURLToPath(import.meta.url)
);

const integrationEnabled =
  process.env.DASHBOARD_RISK_INTEGRATION === "1";

if (!integrationEnabled) {
  console.log(
    "SKIP: Dashboard Risk Snapshot integration test "
    + "requires DASHBOARD_RISK_INTEGRATION=1"
  );

  process.exit(0);
}

const dbCwd = path.resolve(
  process.env.DASHBOARD_RISK_DB_CWD
    ?? root
);

assert.ok(
  fs.existsSync(dbCwd),
  `DASHBOARD_RISK_DB_CWD does not exist: ${dbCwd}`
);

console.log(
  `DB_CWD=${dbCwd}`
);

const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260911054000_add_dashboard_risk_snapshot_rpc.sql"
);

const acceptedMigrationSha =
  "a9b58862c76c972d3fb2117212b4b5fb8c673557cf3d0d465100e87b96b0187f";

const maxRpcMs = Number(
  process.env.DASHBOARD_RISK_MAX_MS ?? "8000"
);

const requestedSession =
  process.env.DASHBOARD_RISK_INTEGRATION_SESSION_ID
  ?? null;

const summaryGroup =
  process.env.DASHBOARD_RISK_INTEGRATION_GROUP_ID
  ?? "NORTH";

assert.match(
  summaryGroup,
  /^[A-Za-z0-9_-]+$/,
  "unsafe summary-group id"
);

assert.ok(
  Number.isFinite(maxRpcMs) && maxRpcMs > 0,
  "invalid DASHBOARD_RISK_MAX_MS"
);

const migration = fs.readFileSync(
  migrationPath,
  "utf8"
);

const migrationSha = crypto
  .createHash("sha256")
  .update(migration)
  .digest("hex");

assert.equal(
  migrationSha,
  acceptedMigrationSha,
  "accepted migration hash changed; rerun acceptance verification"
);

console.log(
  `PASS: accepted migration SHA256=${migrationSha}`
);

function runDb(sql) {
  const result = spawnSync(
    "npx",
    [
      "supabase",
      "db",
      "query",
      "--linked",
      sql,
    ],
    {
      cwd: dbCwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function mustRunDb(sql, label) {
  const result = runDb(sql);

  if (result.status !== 0) {
    console.error(
      `FAIL: ${label}`
    );

    console.error(
      result.stderr.slice(-12000)
    );

    throw new Error(
      `${label}: db query failed with ${result.status}`
    );
  }

  return result.stdout;
}

function detectSession() {
  if (requestedSession) {
    assert.match(
      requestedSession,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "invalid DASHBOARD_RISK_INTEGRATION_SESSION_ID"
    );

    return requestedSession;
  }

  const out = mustRunDb(
    `
select
  'SESSION|'
  || id::text
  || '|'
  || business_date::text
    as marker
from public.settlement_sessions
where status = 'OPEN'
order by opened_at desc
limit 1;
`,
    "resolve OPEN settlement session"
  );

  const match = out.match(
    /SESSION\|([0-9a-f-]{36})\|([0-9]{4}-[0-9]{2}-[0-9]{2})/i
  );

  assert.ok(
    match,
    "no OPEN settlement session found"
  );

  console.log(
    `SESSION=${match[1]} BUSINESS_DATE=${match[2]}`
  );

  return match[1];
}

function assertRpcAbsent(label) {
  const out = mustRunDb(
    `
select
  case
    when to_regprocedure(
      'public.dashboard_risk_snapshot(uuid,text)'
    ) is null
      then 'RPC_ABSENT'
    else 'RPC_PRESENT'
  end as marker;
`,
    label
  );

  assert.match(
    out,
    /\bRPC_ABSENT\b/,
    `${label}: RPC unexpectedly present`
  );
}

const session = detectSession();

assertRpcAbsent(
  "pre-transaction RPC absence"
);

const sections = [
  {
    name: "risk_codes",
    view: "session_code_risk_state",
    fields: [
      "settlement_session_id",
      "business_date",
      "summary_group_id",
      "category",
      "code",
      "order_total",
      "adjusted_total",
      "special_multiplier",
      "max_special_codes",
      "promotion_factor_pct",
      "effective_multiplier",
      "point_exposure",
      "reserve_rank",
      "reserve_candidate",
      "actual_special_point",
      "actual_point",
      "confirmed_cut",
      "available_to_cut",
      "retained_quantity",
      "retained_point_exposure",
    ],
    order: [
      "r.summary_group_id",
      "r.category",
      "r.order_total desc",
      "r.code",
    ],
  },
  {
    name: "category_risk",
    view: "session_category_risk_state",
    fields: [
      "settlement_session_id",
      "business_date",
      "summary_group_id",
      "category",
      "special_multiplier",
      "max_special_codes",
      "actual_selected_count",
      "order_total",
      "adjusted_total",
      "point_reserve",
      "actual_point",
      "reserve_safe_capacity",
      "reserve_risk_pct",
    ],
    order: [
      "r.summary_group_id",
      "r.category",
    ],
  },
  {
    name: "overall_risk",
    view: "session_overall_risk_state",
    fields: [
      "settlement_session_id",
      "business_date",
      "summary_group_id",
      "gross_received",
      "adjusted_received",
      "point_reserve_total",
      "actual_point_total",
      "actual_codes_ready",
      "risk_mode",
      "risk_point_total",
      "net_safe_capacity",
      "confirmed_cut_total",
      "remaining_safe_capacity",
      "over_safe_amount",
      "risk_pct",
      "safety_margin",
      "safety_margin_pct",
      "point_loss_tolerance",
      "risk_budget",
      "risk_budget_margin",
      "excess_point_risk",
    ],
    order: [
      "r.summary_group_id",
    ],
  },
  {
    name: "risk_pools",
    view: "session_risk_pool_state",
    fields: [
      "settlement_session_id",
      "business_date",
      "summary_group_id",
      "risk_pool",
      "gross_received",
      "adjusted_received",
      "point_reserve_total",
      "actual_point_total",
      "multiplier_configured",
      "actual_codes_ready",
      "risk_mode",
      "risk_point_total",
      "safety_margin",
      "confirmed_cut_total",
      "point_loss_tolerance",
      "risk_pct",
      "risk_budget",
      "excess_point_risk",
      "risk_budget_margin",
    ],
    order: [
      "r.summary_group_id",
      "r.risk_pool",
    ],
  },
  {
    name: "line_group_risk",
    view: "session_line_group_risk_state",
    fields: [
      "settlement_session_id",
      "business_date",
      "line_group_id",
      "line_group_name",
      "summary_group_id",
      "reduction_pct",
      "enabled",
      "gross_received",
      "calculation_band",
      "risk_budget_pct",
      "risk_budget",
      "amount_to_next_band",
      "calculation_status",
      "multiplier_configured",
      "risk_calculation_ready",
      "risk_status",
      "cut_required",
      "risk_model",
      "over_limit_code_count",
      "recommended_cut_total",
      "recommended_point_reduction",
      "confirmed_cut_total",
      "retained_total",
      "over_cut_code_count",
    ],
    order: [
      "r.summary_group_id",
      "coalesce(r.line_group_name,r.line_group_id)",
      "r.line_group_id",
    ],
  },
  {
    name: "line_group_risk_codes",
    view: "session_line_group_code_retention_state",
    fields: [
      "settlement_session_id",
      "line_group_id",
      "summary_group_id",
      "category",
      "code",
      "order_total",
      "confirmed_cut",
      "retained_quantity",
      "effective_multiplier",
      "retention_limit",
      "recommended_cut",
      "projected_retained",
      "recommended_point_reduction",
      "retention_status",
      "confirmed_cut_exceeds_order_total",
    ],
    order: [
      "r.summary_group_id",
      "r.line_group_id",
      "r.category",
      "r.order_total desc",
      "r.code",
    ],
  },
];

function expectedSql(
  scope,
  groupFilter
) {
  return sections.map(
    ({
      name,
      view,
      fields,
      order,
    }) => `
insert into expected_sections(
  scope,
  section,
  value
)
select
  '${scope}',
  '${name}',
  coalesce(
    jsonb_agg(
      to_jsonb(r)
      order by
        ${order.join(",\n        ")}
    ),
    '[]'::jsonb
  )
from (
  select
    ${fields.join(",\n    ")}
  from public.${view}
  where settlement_session_id =
    '${session}'::uuid
    ${groupFilter}
) r;
`
  ).join("\n");
}

const transactionSql = `
begin;

${migration}

set local statement_timeout = '12s';

create temporary table rpc_payloads (
  scope text primary key,
  payload jsonb not null,
  elapsed_ms numeric(14,3) not null
) on commit drop;

do $block$
declare
  v_started timestamptz;
  v_payload jsonb;
  v_elapsed numeric;
begin
  v_started := clock_timestamp();

  v_payload :=
    public.dashboard_risk_snapshot(
      '${session}'::uuid,
      '${summaryGroup}'
    );

  v_elapsed :=
    extract(
      epoch from (
        clock_timestamp() - v_started
      )
    ) * 1000.0;

  insert into rpc_payloads(
    scope,
    payload,
    elapsed_ms
  )
  values(
    '${summaryGroup}',
    v_payload,
    round(v_elapsed,3)
  );
end
$block$;

do $block$
declare
  v_started timestamptz;
  v_payload jsonb;
  v_elapsed numeric;
begin
  v_started := clock_timestamp();

  v_payload :=
    public.dashboard_risk_snapshot(
      '${session}'::uuid,
      null::text
    );

  v_elapsed :=
    extract(
      epoch from (
        clock_timestamp() - v_started
      )
    ) * 1000.0;

  insert into rpc_payloads(
    scope,
    payload,
    elapsed_ms
  )
  values(
    'ALL',
    v_payload,
    round(v_elapsed,3)
  );
end
$block$;

set local statement_timeout = '30s';

create temporary table expected_sections (
  scope text not null,
  section text not null,
  value jsonb not null,
  primary key(scope,section)
) on commit drop;

${expectedSql(
  summaryGroup,
  `and summary_group_id = '${summaryGroup}'`
)}

${expectedSql(
  "ALL",
  ""
)}

with section_order(
  section,
  seq
) as (
  values
    ('risk_codes'::text,1),
    ('category_risk'::text,2),
    ('overall_risk'::text,3),
    ('risk_pools'::text,4),
    ('line_group_risk'::text,5),
    ('line_group_risk_codes'::text,6)
),

performance_rows as (
  select
    case
      when p.scope = '${summaryGroup}'
        then 1
      else 2
    end as major_order,

    0 as minor_order,

    'VERIFY|PERFORMANCE|'
    || p.scope
    || '|rpc_ms|'
    || case
         when p.elapsed_ms <= ${maxRpcMs}
           then 'PASS'
         else 'FAIL'
       end
    || '|'
    || p.elapsed_ms::text
      as marker

  from rpc_payloads p
),

parity_rows as (
  select
    case
      when p.scope = '${summaryGroup}'
        then 1
      else 2
    end as major_order,

    s.seq as minor_order,

    'VERIFY|PARITY|'
    || p.scope
    || '|'
    || s.section
    || '|'
    || case
         when
           p.payload -> s.section
             = e.value
         then 'PASS'
         else 'FAIL'
       end
    || '|actual='
    || jsonb_array_length(
         p.payload -> s.section
       )::text
    || '|expected='
    || jsonb_array_length(
         e.value
       )::text
      as marker

  from rpc_payloads p

  cross join section_order s

  join expected_sections e
    on e.scope = p.scope
   and e.section = s.section
)

select marker
from (
  select * from performance_rows

  union all

  select * from parity_rows
) x
order by
  major_order,
  minor_order;

rollback;
`;

const transaction = runDb(
  transactionSql
);

// Always prove that the function did not persist.
assertRpcAbsent(
  "post-transaction RPC absence"
);

if (transaction.status !== 0) {
  console.error(
    transaction.stderr.slice(-20000)
  );

  throw new Error(
    `transactional verification failed: ${transaction.status}`
  );
}

const output = transaction.stdout;

const escapedGroup = summaryGroup.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&"
);

const performancePattern = new RegExp(
  String.raw`VERIFY\|PERFORMANCE\|(${escapedGroup}|ALL)\|rpc_ms\|(PASS|FAIL)\|([0-9.]+)`,
  "g"
);

const parityPattern = new RegExp(
  String.raw`VERIFY\|PARITY\|(${escapedGroup}|ALL)\|(risk_codes|category_risk|overall_risk|risk_pools|line_group_risk|line_group_risk_codes)\|(PASS|FAIL)\|actual=([0-9]+)\|expected=([0-9]+)`,
  "g"
);

const performance = [
  ...output.matchAll(
    performancePattern
  ),
];

const parity = [
  ...output.matchAll(
    parityPattern
  ),
];

assert.equal(
  performance.length,
  2,
  "expected exactly two performance results"
);

assert.equal(
  parity.length,
  12,
  "expected exactly twelve parity results"
);

const performanceScopes =
  new Set();

for (const match of performance) {
  const [
    ,
    scope,
    status,
    msText,
  ] = match;

  assert.equal(
    performanceScopes.has(scope),
    false,
    `duplicate performance result: ${scope}`
  );

  performanceScopes.add(scope);

  const ms = Number(msText);

  console.log(
    `${scope}_RPC_MS=${ms}`
  );

  assert.equal(
    status,
    "PASS",
    `${scope} performance gate failed`
  );

  assert.ok(
    ms <= maxRpcMs,
    `${scope} RPC ${ms}ms > ${maxRpcMs}ms`
  );
}

const expectedScopes =
  new Set([
    summaryGroup,
    "ALL",
  ]);

assert.deepEqual(
  performanceScopes,
  expectedScopes,
  "performance scopes mismatch"
);

const seenParity =
  new Set();

for (const match of parity) {
  const [
    ,
    scope,
    section,
    status,
    actual,
    expected,
  ] = match;

  const key =
    `${scope}/${section}`;

  assert.equal(
    seenParity.has(key),
    false,
    `duplicate parity result ${key}`
  );

  seenParity.add(key);

  assert.equal(
    status,
    "PASS",
    `parity failed: ${key}`
  );

  assert.equal(
    actual,
    expected,
    `row-count mismatch: ${key}`
  );

  console.log(
    `PASS: ${key} rows=${actual}`
  );
}

assert.equal(
  seenParity.size,
  12,
  "exact parity result count mismatch"
);

console.log(
  "PASS: Dashboard Risk Snapshot integration performance=2/2 parity=12/12"
);

console.log(
  "PASS: transactional RPC rolled back and is absent"
);
