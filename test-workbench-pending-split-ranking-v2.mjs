import fs from "node:fs";
import assert from "node:assert/strict";

const path =
  "supabase/migrations/20260928130000_split_staff_pending_verification_ranking.sql";

const sql = fs.readFileSync(path, "utf8");

const position = (pattern, label) => {
  const match = sql.match(pattern);

  assert.ok(
    match,
    `missing ${label}`,
  );

  return match.index;
};

const candidate = position(
  /\bcandidate_messages\s+as\s+materialized\s*\(/i,
  "candidate_messages",
);

const priorityTotals = position(
  /\bpriority_totals\s+as\s+materialized\s*\(/i,
  "priority_totals",
);

const priorityPage = position(
  /\bpriority_page\s+as\s+materialized\s*\(/i,
  "priority_page",
);

const highKeys = position(
  /\bhigh_candidate_messages\s+as\s+materialized\s*\(/i,
  "high_candidate_messages",
);

const highMessageStats = position(
  /\bhigh_message_stats\s+as\s+materialized\s*\(/i,
  "high_message_stats",
);

const highFallback = position(
  /\bhigh_anomaly_code_totals\s+as\s+materialized\s*\(/i,
  "high_anomaly_code_totals",
);

const highStats = position(
  /\bhigh_stats\s+as\s+materialized\s*\(/i,
  "high_stats",
);

const highPage = position(
  /\bhigh_total_page\s+as\s+materialized\s*\(/i,
  "high_total_page",
);

const recentPage = position(
  /\brecent_page\s+as\s+materialized\s*\(/i,
  "recent_page",
);

const selectedPage = position(
  /\bselected_page\s+as\s+materialized\s*\(/i,
  "selected_page",
);

const enriched = position(
  /\benriched\s+as\s*\(/i,
  "enriched",
);

assert.ok(candidate < priorityTotals);
assert.ok(priorityTotals < priorityPage);
assert.ok(priorityPage < selectedPage);

assert.ok(candidate < highKeys);
assert.ok(highKeys < highMessageStats);
assert.ok(highMessageStats < highFallback);
assert.ok(highFallback < highStats);
assert.ok(highStats < highPage);
assert.ok(highPage < selectedPage);

assert.ok(candidate < recentPage);
assert.ok(recentPage < selectedPage);

assert.ok(selectedPage < enriched);

const priorityBlock =
  sql.slice(
    priorityTotals,
    priorityPage,
  );

assert.match(
  priorityBlock,
  /count\(\*\)::bigint[\s\S]*sum\(oi\.quantity\)::bigint/i,
);

assert.doesNotMatch(
  priorityBlock,
  /\bcategory\b|\bcode\b|max_code_total|jsonb_agg|jsonb_array_elements/i,
);

const highFastBlock =
  sql.slice(
    highMessageStats,
    highFallback,
  );

assert.match(
  highFastBlock,
  /max\(oi\.quantity\)::bigint\s+as\s+fast_max_code_total/i,
);

assert.match(
  highFastBlock,
  /bool_or\s*\(/i,
);

assert.match(
  highFastBlock,
  /oi\.category[\s\S]*upper\([\s\S]*trim\(oi\.category\)/i,
);

assert.match(
  highFastBlock,
  /oi\.code[\s\S]*trim\(oi\.code\)/i,
);

assert.doesNotMatch(
  highFastBlock,
  /group\s+by[\s\S]*category/i,
);

assert.doesNotMatch(
  highFastBlock,
  /group\s+by[\s\S]*code/i,
);

const fallbackBlock =
  sql.slice(
    highFallback,
    highStats,
  );

assert.match(
  fallbackBlock,
  /upper\(\s*trim\(oi\.category\)\s*\)/i,
);

assert.match(
  fallbackBlock,
  /trim\(oi\.code\)/i,
);

assert.match(
  fallbackBlock,
  /sum\(oi\.quantity\)::bigint\s+as\s+code_total/i,
);

assert.match(
  fallbackBlock,
  /stats\.needs_normalized_fallback/i,
);

assert.match(
  sql,
  /when\s+stats\.needs_normalized_fallback[\s\S]*anomaly\.max_code_total[\s\S]*else\s+stats\.fast_max_code_total/i,
);

assert.match(
  sql,
  /high_candidate_messages[\s\S]*candidate\.parse_status\s*=\s*'PARSED'/i,
);

assert.doesNotMatch(
  sql,
  /\bhigh_code_totals\s+as\s+materialized\b/i,
);

assert.equal(
  (
    sql.match(
      /jsonb_array_elements\s*\(/gi,
    ) || []
  ).length,
  0,
  "V2.1 must not rank by reparsing items JSON",
);

const beforeEnrichment =
  sql.slice(
    0,
    enriched,
  );

assert.doesNotMatch(
  beforeEnrichment,
  /jsonb_agg\s*\(/i,
);

const afterEnrichment =
  sql.slice(
    enriched,
  );

assert.match(
  afterEnrichment,
  /jsonb_agg\s*\(/i,
);

assert.equal(
  (
    sql.match(
      /jsonb_agg\s*\(/gi,
    ) || []
  ).length,
  1,
  "items JSON must be built once after page selection",
);

assert.equal(
  (
    sql.match(
      /limit\s+greatest\s*\(/gi,
    ) || []
  ).length,
  3,
  "all three modes must page before enrichment",
);

assert.equal(
  (
    sql.match(
      /offset\s+greatest\s*\(/gi,
    ) || []
  ).length,
  3,
  "all three modes must offset before enrichment",
);

assert.match(
  sql,
  /stats\.max_code_total[\s\S]*>=\s*500/i,
);

assert.match(
  sql,
  /human_ignore\.resolution_type\s*=\s*'IGNORED'/i,
);

assert.match(
  sql,
  /human_ignore\.status\s+in\s*\(\s*'IGNORED',\s*'RESOLVED'\s*\)/i,
);

assert.match(
  sql,
  /m\.unsent\s*=\s*false/i,
);

assert.match(
  sql,
  /verification\.message_record_id\s+is\s+null/i,
);

assert.doesNotMatch(
  sql,
  /\b(insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/i,
);

assert.match(
  sql,
  /to service_role\s*;/i,
);

const highPageBlock =
  sql.slice(
    highPage,
    recentPage,
  );

assert.doesNotMatch(
  highPageBlock,
  /from\s+candidate_messages|join\s+candidate_messages/i,
  "HIGH_TOTAL page must not rejoin candidate_messages",
);

assert.match(
  highPageBlock,
  /from\s+high_stats\s+stats/i,
);

assert.match(
  sql,
  /high_message_stats[\s\S]*candidate\.event_timestamp[\s\S]*group\s+by/i,
);

console.log(
  "PASS: Workbench pending split-ranking V2.2 no-rejoin contract",
);
