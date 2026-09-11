import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(
  fileURLToPath(import.meta.url)
);

const dashboardPath = path.join(
  root,
  "netlify",
  "functions",
  "dashboard.mjs"
);

const source = fs.readFileSync(
  dashboardPath,
  "utf8"
);

function pass(label) {
  console.log(`PASS: ${label}`);
}

function mustMatch(pattern, label) {
  assert.match(
    source,
    pattern,
    label
  );

  pass(label);
}

function mustNotMatch(pattern, label) {
  assert.doesNotMatch(
    source,
    pattern,
    label
  );

  pass(label);
}

const rpcCalls =
  source.match(
    /supabase\.rpc\(\s*"dashboard_risk_snapshot"/g
  ) ?? [];

assert.equal(
  rpcCalls.length,
  1,
  "Dashboard must call dashboard_risk_snapshot exactly once"
);

pass(
  "Dashboard calls dashboard_risk_snapshot exactly once"
);

mustMatch(
  /p_settlement_session_id\s*:\s*session\.id/,
  "RPC is scoped to current settlement session"
);

mustMatch(
  /p_summary_group_id\s*:\s*summaryGroupId\s*\?\?\s*null/,
  "RPC preserves ALL versus selected Summary Group scope"
);

for (const view of [
  "session_code_risk_state",
  "session_category_risk_state",
  "session_overall_risk_state",
  "session_risk_pool_state",
  "session_line_group_risk_state",
]) {
  mustNotMatch(
    new RegExp(
      String.raw`supabase\.from\("${view}"\)`
    ),
    `Dashboard no longer opens ${view} directly`
  );
}

mustNotMatch(
  /\blineGroupCodeQuery\b/,
  "Dashboard no longer starts paginated retention query"
);

mustNotMatch(
  /fetchAllLineGroupCodeRetentionRows\s*\(/,
  "Dashboard no longer invokes retention pagination helper"
);

for (const [key, variable] of [
  ["risk_codes", "riskCodes"],
  ["category_risk", "categoryRisk"],
  ["overall_risk", "overallRisk"],
  ["risk_pools", "riskPools"],
  ["line_group_risk", "lineGroupRisk"],
  ["line_group_risk_codes", "lineGroupRiskCodes"],
]) {
  mustMatch(
    new RegExp(
      String.raw`const\s+${variable}\s*=\s*\[\.\.\.riskSnapshot\.${key}\]\.sort`
    ),
    `${variable} derives from RPC ${key}`
  );
}

for (const key of [
  "risk_codes",
  "category_risk",
  "overall_risk",
  "risk_pools",
  "line_group_risk",
  "line_group_risk_codes",
]) {
  mustMatch(
    new RegExp(
      String.raw`"${key}"`
    ),
    `RPC payload validates ${key}`
  );
}

mustMatch(
  /DASHBOARD_RISK_SNAPSHOT_INVALID/,
  "Malformed RPC payload fails closed"
);

for (const table of [
  "messages",
  "settlement_point_profiles",
  "warehouse_transfer_limits",
  "summary_group_risk_pool_settings",
  "settlement_transfer_batches",
]) {
  mustMatch(
    new RegExp(
      String.raw`\.from\("${table}"\)`
    ),
    `Lightweight read remains: ${table}`
  );
}

mustMatch(
  /fetchOpenReviewCount\(\s*session\.business_date,\s*summaryGroupId,\s*session\.id\s*\)/,
  "Review count read remains"
);

mustMatch(
  /fetchUnsends\(\s*session\.business_date,\s*summaryGroupId\s*\)/,
  "Unsend read remains"
);

for (const response of [
  "risk_codes:riskCodes",
  "category_risk:categoryRisk",
  "overall_risk:overallRisk",
  "risk_pools:riskPools",
  "distribution_plans:distributionPlans",
  "line_group_risk:lineGroupRisk",
  "line_group_risk_codes:lineGroupRiskCodes",
  "line_group_distribution_plans:lineGroupDistributionPlans",
]) {
  mustMatch(
    new RegExp(
      response.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )
    ),
    `Response contract remains ${response}`
  );
}

mustMatch(
  /const\s+distributionPlans\s*=/,
  "Existing summary-group distribution calculation remains"
);

mustMatch(
  /const\s+lineGroupDistributionPlans\s*=/,
  "Existing LINE-group distribution calculation remains"
);


mustMatch(
  /loadDashboardPointContext/,
  "Point metadata uses P3A2 context helper"
);

mustMatch(
  /buildDashboardFreshness/,
  "Freshness uses P3A2 helper"
);

mustNotMatch(
  /\.from\("settlement_point_promotions"\)/,
  "Dashboard does not read Promotion table directly"
);

mustNotMatch(
  /\.from\("settlement_summary_group_actual_special_point_codes"\)/,
  "Dashboard does not read Actual Point table directly"
);

console.log(
  "PASS: Dashboard Risk Snapshot read-path contract"
);
