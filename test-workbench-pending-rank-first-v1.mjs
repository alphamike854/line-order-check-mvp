import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260928113000_rank_staff_pending_verification_feeds.sql";

const sql =
  fs.readFileSync(
    path,
    "utf8",
  );

const pos = (pattern) => {
  const match =
    sql.search(pattern);

  assert.notEqual(
    match,
    -1,
    `missing ${pattern}`,
  );

  return match;
};

assert.match(
  sql,
  /create\s+or\s+replace\s+function[\s\S]*staff_workbench_pending_verifications/i,
);

assert.match(
  sql,
  /candidate_messages\s+as\s+materialized/i,
);

assert.match(
  sql,
  /order_rows\s+as\s+materialized/i,
);

assert.match(
  sql,
  /ranked_page\s+as\s+materialized/i,
);

assert.match(
  sql,
  /code_totals[\s\S]*group\s+by[\s\S]*category[\s\S]*code/i,
);

assert.match(
  sql,
  /max_code_total\s*>=\s*500/i,
);

assert.match(
  sql,
  /PRIORITY[\s\S]*needs_interpretation[\s\S]*message_order_total/i,
);

assert.match(
  sql,
  /HIGH_TOTAL[\s\S]*max_code_total/i,
);

// HIGH_TOTAL no longer builds JSON just to calculate ranking.
assert.doesNotMatch(
  sql,
  /jsonb_array_elements/i,
);

// Rank/page must happen before Review + item JSON enrichment.
const rankedPage =
  pos(/ranked_page\s+as\s+materialized/i);

function posAfter(
  anchor,
  pattern,
  label,
) {
  const relative =
    sql
      .slice(anchor)
      .search(pattern);

  assert.notEqual(
    relative,
    -1,
    `missing ${label}`,
  );

  return (
    anchor
    + relative
  );
}

const pageLimit =
  posAfter(
    rankedPage,
    /\blimit\s+greatest/i,
    "ranked-page LIMIT",
  );

const enrichment =
  pos(/\benriched\s+as\s*\(/i);

const openReview =
  posAfter(
    enrichment,
    /from\s+public\.review_items\s+r/i,
    "page-scoped Review enrichment",
  );

const jsonItems =
  posAfter(
    enrichment,
    /jsonb_agg\s*\(/i,
    "page-scoped item JSON enrichment",
  );

assert.ok(
  rankedPage < pageLimit,
);

assert.ok(
  pageLimit < enrichment,
);

assert.ok(
  enrichment < openReview,
);

assert.ok(
  enrichment < jsonItems,
);

// Preserve pending lifecycle boundaries.
assert.match(
  sql,
  /m\.unsent\s*=\s*false/i,
);

assert.match(
  sql,
  /message_verifications[\s\S]*verification\.message_record_id[\s\S]*is\s+null/i,
);

assert.match(
  sql,
  /resolution_type\s*=\s*'IGNORED'[\s\S]*'IGNORED'[\s\S]*'RESOLVED'/i,
);

assert.match(
  sql,
  /'PENDING'::text[\s\S]*verification_status/i,
);

assert.match(
  sql,
  /security\s+definer/i,
);

assert.match(
  sql,
  /grant\s+execute[\s\S]*to\s+service_role/i,
);

// Read model only.
assert.doesNotMatch(
  sql,
  /\binsert\s+into\b/i,
);

assert.doesNotMatch(
  sql,
  /\bupdate\s+public\./i,
);

assert.doesNotMatch(
  sql,
  /\bdelete\s+from\b/i,
);

assert.doesNotMatch(
  sql,
  /\balter\s+table\b/i,
);

console.log(
  "PASS: Workbench pending feeds rank-first v1",
);
