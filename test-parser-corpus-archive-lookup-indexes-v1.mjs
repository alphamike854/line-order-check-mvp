import fs from "node:fs";
import assert from "node:assert/strict";

const migrationPath =
  "supabase/migrations/" +
  "20260912064000_add_parser_corpus_archive_lookup_indexes.sql";

const archivePath =
  "supabase/migrations/" +
  "20260911154500_add_parser_corpus_archive_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const archive =
  fs.readFileSync(
    archivePath,
    "utf8",
  );


/*
 * Negative semantic assertions must inspect executable SQL only.
 * Comments intentionally document forbidden approaches such as
 * changing statement_timeout, so raw-text matching would create
 * false positives.
 */
const executableSql =
  sql
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(
      /--.*$/gm,
      "",
    );


/*
 * order_items already has:
 *
 *   UNIQUE (message_record_id, category, code)
 *
 * PostgreSQL backs that constraint with a btree unique index whose
 * leftmost key is message_record_id, so a second standalone
 * order_items(message_record_id) index would be redundant.
 */
const allMigrationSql =
  fs.readdirSync(
    "supabase/migrations",
  )
    .filter(
      name => name.endsWith(".sql"),
    )
    .sort()
    .map(
      name =>
        fs.readFileSync(
          `supabase/migrations/${name}`,
          "utf8",
        ),
    )
    .join("\n");


assert.match(
  allMigrationSql,
  /unique\s*\(\s*message_record_id\s*,\s*category\s*,\s*code\s*\)/i,
  "order_items must retain its existing leading message_record_id unique index",
);


const requiredIndexes = [
  {
    table: "review_items",
    column: "message_record_id",
  },
  {
    table: "review_resolution_events",
    column: "message_record_id",
  },
  {
    table: "unsend_events",
    column: "matched_message_record_id",
  },
  {
    table: "message_verifications",
    column: "message_record_id",
  },
];


for (const {
  table,
  column,
} of requiredIndexes) {
  const pattern =
    new RegExp(
      String.raw`create\s+index\s+if\s+not\s+exists` +
      String.raw`[\s\S]*?on\s+public\.${table}\s*\(` +
      String.raw`[\s\S]*?\b${column}\b` +
      String.raw`[\s\S]*?\)`,
      "i",
    );

  assert.match(
    sql,
    pattern,
    `missing ${table}.${column} lookup index`,
  );
}


/*
 * Keep the patch narrowly performance-only.
 */
assert.doesNotMatch(
  executableSql,
  /on\s+public\.order_items\s*\(\s*message_record_id\s*\)/i,
  "do not add redundant standalone order_items(message_record_id) index",
);

assert.doesNotMatch(
  executableSql,
  /\b(?:delete|update|insert)\s+(?:into\s+)?public\./i,
  "index migration must not mutate business rows",
);

assert.doesNotMatch(
  executableSql,
  /statement_timeout/i,
  "do not solve archive lookup cost by increasing timeout",
);

assert.doesNotMatch(
  executableSql,
  /create\s+or\s+replace\s+function/i,
  "index patch must not rewrite lifecycle/archive functions",
);


/*
 * Verify that these indexes correspond to the real predicates in
 * archive_parser_corpus_message(), rather than speculative columns.
 */
for (const {
  table,
  column,
} of requiredIndexes) {
  const predicate =
    new RegExp(
      String.raw`public\.${table}[\s\S]{0,900}?` +
      String.raw`\b${column}\b\s*=`,
      "i",
    );

  assert.match(
    archive,
    predicate,
    `archive function no longer looks up ${table}.${column}`,
  );
}


console.log(
  "PASS: parser corpus archive lookup index contract",
);
