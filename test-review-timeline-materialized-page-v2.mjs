import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260927224500_materialize_staff_verification_timeline_page.sql";

const sql =
  fs.readFileSync(
    path,
    "utf8",
  );

assert.match(
  sql,
  /paged_messages\s+as\s+materialized\s*\(/i,
  "RECENT page CTE must be MATERIALIZED",
);

const pagePos =
  sql.search(
    /paged_messages\s+as\s+materialized\s*\(/i,
  );

const sourcePos =
  sql.search(
    /source_rows\s+as\s*\(/i,
  );

assert.ok(
  pagePos >= 0
  && sourcePos > pagePos,
  "materialized page must precede enrichment",
);

const pageRegion =
  sql.slice(
    pagePos,
    sourcePos,
  );

assert.match(
  pageRegion,
  /from\s+public\.messages\s+m/i,
);

assert.match(
  pageRegion,
  /join\s+latest_round\s+round_state/i,
);

assert.match(
  pageRegion,
  /order\s+by[\s\S]*m\.event_timestamp\s+desc\s+nulls\s+last[\s\S]*m\.created_at\s+desc[\s\S]*m\.id\s+desc/i,
);

assert.match(
  pageRegion,
  /limit\s+greatest\s*\(/i,
);

assert.match(
  pageRegion,
  /offset\s+greatest\s*\(/i,
);

const enrichment =
  sql.slice(
    sourcePos,
  );

assert.match(
  enrichment,
  /from\s+paged_messages\s+m/i,
);

for (const table of [
  "message_verifications",
  "review_items",
  "order_items",
  "post_close_review_archive",
]) {
  assert.match(
    enrichment,
    new RegExp(
      `public\\.${table}`,
      "i",
    ),
    `${table} enrichment missing`,
  );
}

const fn =
  sql.match(
    /create\s+or\s+replace\s+function[\s\S]*?\$\$;/i,
  )?.[0];

assert.ok(
  fn,
  "Timeline function missing",
);

assert.equal(
  (
    fn.match(
      /\blimit\s+greatest\s*\(/gi,
    )
    || []
  ).length,
  1,
  "only materialized page may own LIMIT",
);

assert.equal(
  (
    fn.match(
      /\boffset\s+greatest\s*\(/gi,
    )
    || []
  ).length,
  1,
  "only materialized page may own OFFSET",
);

assert.match(
  fn,
  /order\s+by\s+timeline\.event_timestamp\s+desc\s+nulls\s+last,\s*timeline\.message_created_at\s+desc,\s*timeline\.message_record_id\s+desc/i,
  "final deterministic ordering must remain",
);

assert.doesNotMatch(
  sql,
  /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)\b/i,
  "materialization repair must remain read-only",
);

console.log(
  "PASS: Review Timeline MATERIALIZED page v2",
);
