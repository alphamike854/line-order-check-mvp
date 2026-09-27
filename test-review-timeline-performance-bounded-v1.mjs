import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20260927223000_bound_staff_verification_timeline.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const functionMatch =
  sql.match(
    /create\s+or\s+replace\s+function[\s\S]*?\$\$;/i,
  );

assert.ok(
  functionMatch,
  "Timeline repair function missing",
);

const fn =
  functionMatch[0];

const pagedPos =
  fn.search(
    /paged_messages\s+as\s*\(/i,
  );

const sourcePos =
  fn.search(
    /source_rows\s+as\s*\(/i,
  );

assert.ok(
  pagedPos >= 0,
  "paged_messages CTE missing",
);

assert.ok(
  sourcePos > pagedPos,
  "page CTE must precede enrichment",
);

const pagedRegion =
  fn.slice(
    pagedPos,
    sourcePos,
  );

assert.match(
  pagedRegion,
  /from\s+public\.messages\s+m/i,
);

assert.match(
  pagedRegion,
  /join\s+latest_round\s+round_state/i,
);

assert.match(
  pagedRegion,
  /order\s+by[\s\S]*?m\.event_timestamp\s+desc\s+nulls\s+last[\s\S]*?m\.created_at\s+desc[\s\S]*?m\.id\s+desc/i,
);

assert.match(
  pagedRegion,
  /limit\s+greatest\s*\(/i,
);

assert.match(
  pagedRegion,
  /offset\s+greatest\s*\(/i,
);

const enrichRegion =
  fn.slice(
    sourcePos,
  );

assert.match(
  enrichRegion,
  /from\s+paged_messages\s+m/i,
);

assert.match(
  enrichRegion,
  /public\.message_verifications/i,
);

assert.match(
  enrichRegion,
  /public\.review_items/i,
);

assert.match(
  enrichRegion,
  /public\.order_items/i,
);

assert.match(
  enrichRegion,
  /public\.post_close_review_archive/i,
);

assert.equal(
  (
    fn.match(
      /from\s+public\.messages\s+m/gi,
    )
    || []
  ).length,
  1,
  "base messages scan must occur only in page CTE",
);

assert.equal(
  (
    fn.match(
      /from\s+paged_messages\s+m/gi,
    )
    || []
  ).length,
  1,
  "enrichment must consume page exactly once",
);

assert.equal(
  (
    fn.match(
      /\blimit\s+greatest\s*\(/gi,
    )
    || []
  ).length,
  1,
  "only page CTE may own bounded LIMIT",
);

assert.equal(
  (
    fn.match(
      /\boffset\s+greatest\s*\(/gi,
    )
    || []
  ).length,
  1,
  "only page CTE may own OFFSET",
);

assert.match(
  fn,
  /order\s+by\s+timeline\.event_timestamp\s+desc\s+nulls\s+last,\s*timeline\.message_created_at\s+desc,\s*timeline\.message_record_id\s+desc/i,
  "final RECENT ordering must remain unchanged",
);

assert.match(
  sql,
  /post_close_review_archive_source_message_recent_idx[\s\S]*?source_message_record_id[\s\S]*?archived_at\s+desc[\s\S]*?id\s+desc/i,
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)\b/i,
  "repair must remain read-only except CREATE INDEX/function DDL",
);

console.log(
  "PASS: Review Timeline page-first performance contract",
);
