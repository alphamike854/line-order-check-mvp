import assert from "node:assert/strict";
import {
  normalizeBoolean,
  normalizeCategory,
  validateAllocationRule,
  validateCategoryAlias,
  validateLineGroup,
  validateSummaryGroup,
} from "./src/lib/settings-validation.mjs";

assert.equal(normalizeBoolean(true), true);
assert.equal(normalizeBoolean("false"), false);
assert.equal(normalizeCategory("a"), "A");
assert.deepEqual(validateSummaryGroup({ id: "north_2", name: "ภาคเหนือ 2", enabled: true }), {
  id: "NORTH_2",
  name: "ภาคเหนือ 2",
  enabled: true,
});
assert.deepEqual(validateLineGroup({
  line_group_id: "C87107089a6e03db9ca197b90d3cfebe4",
  line_group_name: "กลุ่มทดลอง",
  summary_group_id: "north",
  enabled: true,
}), {
  line_group_id: "C87107089a6e03db9ca197b90d3cfebe4",
  line_group_name: "กลุ่มทดลอง",
  summary_group_id: "NORTH",
  reduction_pct: 0,
  enabled: true,
});
assert.deepEqual(validateAllocationRule({ summary_group_id: "north", category: "a", threshold: 100, destination: "คลัง 2" }), {
  summary_group_id: "NORTH",
  category: "A",
  threshold: 100,
  destination: "คลัง 2",
  enabled: true,
});
assert.deepEqual(validateCategoryAlias({ alias: "น", canonical_category: "a" }), {
  alias: "น",
  canonical_category: "A",
  enabled: true,
});
assert.throws(() => validateAllocationRule({ summary_group_id: "NORTH", category: "A", threshold: 0 }), /INVALID_THRESHOLD/);
assert.throws(() => validateLineGroup({ line_group_id: "bad", line_group_name: "x", summary_group_id: "NORTH" }), /INVALID_LINE_GROUP_ID/);
assert.equal(validateLineGroup({ line_group_id: "C87107089a6e03db9ca197b90d3cfebe4", line_group_name: "x", summary_group_id: "NORTH", reduction_pct: 5 }).reduction_pct, 5);
assert.throws(() => validateLineGroup({ line_group_id: "C87107089a6e03db9ca197b90d3cfebe4", line_group_name: "x", summary_group_id: "NORTH", reduction_pct: 101 }), /INVALID_REDUCTION_PCT/);

console.log("PASS: Review + Settings validation smoke tests");
