// Historical compatibility check only.
// v6.5 Risk->Cut% migration may already be applied in Supabase; v6.6 deliberately
// keeps migration 011 in history but supersedes its operational policy with Risk Budget.
import fs from "node:fs";
import assert from "node:assert/strict";

const migration011=fs.readFileSync(new URL("./supabase/migrations/202608250011_replace_safe_capacity_with_risk_cut_policy.sql",import.meta.url),"utf8");
const migration012=fs.readFileSync(new URL("./supabase/migrations/202608250012_add_dynamic_risk_budget_distribution.sql",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("./public/app.js",import.meta.url),"utf8");
assert.match(migration011,/risk_cut_policy_bands/);
assert.match(migration012,/Risk Budget/i);
assert.match(migration012,/0::numeric\(7,3\) as recommended_cut_pct/);
assert.doesNotMatch(app,/นโยบายตัด/);
console.log("PASS: Legacy v6.5 Risk policy retained only as migration history");
