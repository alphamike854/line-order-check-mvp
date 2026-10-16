import assert from "node:assert/strict";
import fs from "node:fs";
import { buildIncidentAbAdvisory } from "./src/lib/incident-ab-advisory.mjs";

const dashboard = fs.readFileSync("netlify/functions/dashboard.mjs", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const incidentStart = dashboard.indexOf('process.env.DASHBOARD_INCIDENT_MODE');
const normalStart = dashboard.indexOf('\n  try {\n    const url=new URL(req.url);', incidentStart);
assert.ok(incidentStart >= 0 && normalStart > incidentStart);
const incident = dashboard.slice(incidentStart, normalStart);

assert.match(incident, /buildIncidentAbAdvisory\(/);
assert.match(incident, /from\("summary_group_risk_pool_settings"\)/);
assert.match(incident, /\.eq\("risk_pool", "MAIN"\)/);
assert.match(incident, /AB_LOSS_SETTING_READ_FAILED/);
assert.match(incident, /ab_advisory: incidentAbAdvisory/);
assert.match(incident, /ab_advisory: null/); // static fail-closed fallback
assert.match(incident, /line_group_distribution_plans:\s*\[\]/);
assert.match(incident, /distribution_incomplete:\s*true/);
assert.equal((incident.match(/"dashboard_risk_snapshot"/g)||[]).length,1,
  "Incident branch cannot repeat the heavy risk snapshot query");
assert.match(app, /Emergency A\/B live Round duplicate-RPC relief v1/);

const row = (category, lineGroupId=null) => ({
  settlement_session_id: "fixture-session",
  summary_group_id: "SOUTH",
  ...(lineGroupId ? {line_group_id:lineGroupId,line_group_name:"Fixture LINE"} : {}),
  category,code:"20",order_total:10000,adjusted_total:6000,
  retained_quantity:1200,effective_multiplier:10,max_special_codes:1,
});
const snapshot={
  risk_codes:[row("A"),row("B")],
  line_group_risk_codes:[row("A","LG-1"),row("B","LG-1")],
};
const zero = buildIncidentAbAdvisory({
  snapshot, summaryGroupId:"SOUTH",
  riskBudgetRows:[{summary_group_id:"SOUTH",risk_pool:"MAIN",point_loss_tolerance:0}],
});
assert.equal(zero.calculation_status,"READY");
assert.equal(zero.shared_max_loss,0);
assert.equal(zero.shared_max_loss_source,"MAIN_POINT_LOSS_TOLERANCE");
assert.equal(zero.summary_groups.length,1);
assert.equal(zero.summary_groups[0].decision_role,"AUTHORITATIVE");
assert.equal(zero.summary_groups[0].plan.A.transfer_required_total,600);
assert.equal(zero.summary_groups[0].plan.B.transfer_required_total,600);
assert.equal(zero.line_groups.length,1);
assert.equal(zero.line_groups[0].decision_role,"ATTRIBUTION_ONLY");

const missing = buildIncidentAbAdvisory({
  snapshot, summaryGroupId:"SOUTH", riskBudgetRows:[],
});
assert.equal(missing.shared_max_loss,200000);
assert.equal(missing.shared_max_loss_source,"FALLBACK_200000");
assert.equal(missing.summary_groups[0].plan.transfer_required_total,0);

assert.throws(() => buildIncidentAbAdvisory({
  snapshot,summaryGroupId:"SOUTH",riskBudgetRows:null,
}),/AB_INCIDENT_INPUT_INCOMPLETE/);
assert.throws(() => buildIncidentAbAdvisory({
  snapshot,summaryGroupId:"SOUTH",riskBudgetRows:[{
    summary_group_id:"SOUTH",risk_pool:"MAIN",point_loss_tolerance:-1,
  }],
}),/AB_SHARED_MAX_LOSS_CONFIG_INVALID/);
assert.throws(() => buildIncidentAbAdvisory({
  snapshot:{...snapshot,risk_codes:[{...row("A"),summary_group_id:"SOUTHEAST"}]},
  summaryGroupId:"SOUTH",riskBudgetRows:[],
}),/AB_INCIDENT_GROUP_SCOPE_MISMATCH/);
assert.throws(() => buildIncidentAbAdvisory({
  snapshot:{...snapshot,line_group_risk_codes:null},
  summaryGroupId:"SOUTH",riskBudgetRows:[],
}),/AB_INCIDENT_INPUT_INCOMPLETE/);
assert.throws(() => buildIncidentAbAdvisory({
  snapshot,summaryGroupId:"SOUTH",riskBudgetRows:[{summary_group_id:"SOUTHEAST",risk_pool:"MAIN",point_loss_tolerance:500}],
}),/AB_INCIDENT_GROUP_SCOPE_MISMATCH/);

console.log("PASS: Snapshot-based A/B Preview retains authoritative shared A/B math");
console.log("PASS: explicit MAIN=0 and missing MAIN use distinct authoritative budgets");
console.log("PASS: fail-closed missing/invalid/mixed-group inputs");
console.log("PASS: incident API preserves heavy-RPC single read and disabled operational cuts");
