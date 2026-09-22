import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
    + "20260922093000_guard_export_delivery_round_lifecycle.sql",
    "utf8",
  );

const packageJson =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

console.log(
  "===== Export Preparation Round Delivery Lifecycle Guard v1 =====",
);

function compact(value) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

const normalized =
  compact(migration);

const unresolved =
  [
    "SENDING",
    "RETRYABLE",
    "AMBIGUOUS",
  ];

assert.ok(
  migration.includes(
    "export_preparation_round_has_unresolved_delivery",
  ),
);

for (const status of unresolved) {
  assert.ok(
    migration.includes(`'${status}'`),
    status,
  );
}

console.log(
  "PASS EXP2F2B1-01: canonical unresolved-delivery predicate exists",
);

assert.ok(
  migration.includes(
    "guard_export_delivery_on_round_close",
  ),
);

assert.ok(
  migration.includes(
    "settlement_export_delivery_round_close_guard_trg",
  ),
);

assert.ok(
  normalized.includes(
    "before update of status on "
    + "public.settlement_summary_group_rounds",
  ),
);

assert.ok(
  normalized.includes(
    "old.status = 'OPEN' "
    + "and new.status = 'CLOSED'",
  ),
);

assert.ok(
  migration.includes(
    "EXPORT_DELIVERY_UNRESOLVED_BLOCKS_ROUND_CLOSE",
  ),
);

console.log(
  "PASS EXP2F2B1-02: OPEN -> CLOSED fails closed on unresolved delivery",
);

assert.ok(
  migration.includes(
    "guard_export_delivery_on_new_round",
  ),
);

assert.ok(
  migration.includes(
    "settlement_export_delivery_new_round_guard_trg",
  ),
);

assert.ok(
  normalized.includes(
    "before insert on "
    + "public.settlement_summary_group_rounds",
  ),
);

assert.ok(
  normalized.includes(
    "new.status = 'OPEN'",
  ),
);

assert.ok(
  migration.includes(
    "EXPORT_DELIVERY_UNRESOLVED_BLOCKS_NEW_ROUND",
  ),
);

console.log(
  "PASS EXP2F2B1-03: new OPEN Round fails closed on older unresolved delivery",
);

const newRoundStart =
  migration.indexOf(
    "create or replace function\n"
    + "  public.guard_export_delivery_on_new_round()",
  );

const purgeStart =
  migration.indexOf(
    "create or replace function\n"
    + "  public.purge_export_preparation_on_new_round()",
  );

assert.ok(newRoundStart >= 0);
assert.ok(purgeStart > newRoundStart);

const newRoundBlock =
  migration.slice(
    newRoundStart,
    purgeStart,
  );

assert.ok(
  newRoundBlock.includes(
    "r.summary_group_id =",
  ),
);

assert.ok(
  newRoundBlock.includes(
    "new.summary_group_id",
  ),
);

console.log(
  "PASS EXP2F2B1-04: new-Round guard follows Summary Group purge scope",
);

const purgeBlock =
  migration.slice(
    purgeStart,
  );

assert.ok(
  purgeBlock.includes(
    "settlement_export_deliveries",
  ),
);

assert.ok(
  purgeBlock.includes(
    "EXPORT_DELIVERY_UNRESOLVED_BLOCKS_PURGE",
  ),
);

const purgeGuardPosition =
  purgeBlock.indexOf(
    "EXPORT_DELIVERY_UNRESOLVED_BLOCKS_PURGE",
  );

const purgeDeletePosition =
  purgeBlock.indexOf(
    "delete from",
  );

assert.ok(
  purgeGuardPosition >= 0,
);

assert.ok(
  purgeDeletePosition > purgeGuardPosition,
);

console.log(
  "PASS EXP2F2B1-05: purge checks unresolved delivery before destructive delete",
);

assert.ok(
  purgeBlock.includes(
    "public.settlement_export_cycles",
  ),
);

assert.equal(
  purgeBlock.includes(
    "delete from\n"
    + "    public.settlement_export_deliveries",
  ),
  false,
);

console.log(
  "PASS EXP2F2B1-06: guard preserves existing cycle-owned cascade model",
);

const predicateStart =
  migration.indexOf(
    "public.export_preparation_round_has_unresolved_delivery",
  );

const closeStart =
  migration.indexOf(
    "public.guard_export_delivery_on_round_close",
  );

const predicateBlock =
  migration.slice(
    predicateStart,
    closeStart,
  );

assert.equal(
  predicateBlock.includes("'FAILED'"),
  false,
);

assert.equal(
  predicateBlock.includes("'ACKNOWLEDGED'"),
  false,
);

console.log(
  "PASS EXP2F2B1-07: FAILED and ACKNOWLEDGED are not close blockers",
);

assert.equal(
  migration.includes(
    "update public.settlement_export_deliveries"
  ),
  false,
);

assert.equal(
  migration.includes(
    "insert into public.settlement_export_deliveries"
  ),
  false,
);

console.log(
  "PASS EXP2F2B1-08: lifecycle guard never mutates delivery status",
);

assert.equal(
  /api\.line\.me/i.test(migration),
  false,
);

assert.equal(
  /LINE_CHANNEL_ACCESS_TOKEN/.test(migration),
  false,
);

assert.equal(
  /X-Line-Retry-Key/.test(migration),
  false,
);

console.log(
  "PASS EXP2F2B1-09: lifecycle hardening has no LINE transport",
);

assert.equal(
  /settlement_transfer_batches/.test(migration),
  false,
);

assert.equal(
  /confirmed_cut_total/.test(migration),
  false,
);

assert.equal(
  /allocation_plans/.test(migration),
  false,
);

console.log(
  "PASS EXP2F2B1-10: Allocation / Risk confirmed-cut storage remains isolated",
);

assert.ok(
  normalized.includes(
    "old.status is distinct from new.status "
    + "and old.status = 'OPEN' "
    + "and new.status = 'CLOSED'",
  ),
);

console.log(
  "PASS EXP2F2B1-11: close guard is limited to real OPEN -> CLOSED transitions",
);

assert.ok(
  migration.includes(
    "security definer",
  ),
);

assert.ok(
  migration.includes(
    "from public, anon, authenticated",
  ),
);

console.log(
  "PASS EXP2F2B1-12: trigger helpers retain server-side privilege boundary",
);

assert.ok(
  packageJson.includes(
    "test-export-preparation-round-delivery-lifecycle-guard-v1.mjs",
  ),
);

console.log(
  "PASS EXP2F2B1-13: lifecycle guard is registered in full regression",
);

console.log(
  "PASS: Export Preparation Round Delivery Lifecycle Guard v1",
);
