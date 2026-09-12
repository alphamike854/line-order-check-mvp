"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/" +
      "20260912173000_extend_summary_group_round_control_timeout.sql",
    "utf8",
  );

// Strip line comments before checking executable SQL.
// This prevents documentation text such as
// "authenticator statement_timeout=8s"
// from being mistaken for a role mutation.
const executableSql =
  migration.replace(
    /--.*$/gm,
    "",
  );

console.log(
  "===== OPEN GROUP RPC TIMEOUT v1 =====",
);

assert.match(
  executableSql,
  /alter\s+function[\s\S]*public\.set_settlement_summary_group_accepting\s*\(\s*uuid\s*,\s*text\s*,\s*boolean\s*,\s*text\s*\)[\s\S]*set\s+statement_timeout\s*=\s*'30s'/i,
);

console.log(
  "PASS OT-01 lifecycle RPC gets bounded 30s timeout",
);

assert.doesNotMatch(
  executableSql,
  /alter\s+role/i,
);

console.log(
  "PASS OT-02 no role-wide timeout mutation",
);

assert.doesNotMatch(
  executableSql,
  /alter\s+database/i,
);

console.log(
  "PASS OT-03 no database-wide timeout mutation",
);

const timeoutAssignments =
  executableSql.match(
    /\bset\s+statement_timeout\b/gi,
  ) ?? [];

assert.equal(
  timeoutAssignments.length,
  1,
);

console.log(
  "PASS OT-04 exactly one executable statement_timeout assignment",
);

assert.doesNotMatch(
  executableSql,
  /disable\s+trigger|drop\s+trigger/i,
);

console.log(
  "PASS OT-05 no trigger is disabled or removed",
);

assert.doesNotMatch(
  executableSql,
  /delete\s+from|truncate\s+/i,
);

console.log(
  "PASS OT-06 migration performs no operational purge",
);

assert.doesNotMatch(
  executableSql,
  /create\s+or\s+replace\s+function/i,
);

console.log(
  "PASS OT-07 RPC business logic is unchanged",
);

console.log(
  "PASS: OPEN GROUP RPC TIMEOUT v1",
);
