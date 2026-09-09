import fs from "node:fs";

const migration =
  "supabase/migrations/20260909150000_bridge_legacy_actual_point_to_round.sql";

const sql = fs.readFileSync(
  migration,
  "utf8",
);

function check(name, condition) {
  if (!condition) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }

  console.log(`PASS ${name}`);
}

check(
  "C2A-01 legacy RPC identity and integer contract preserved",
  /create or replace function\s+public\.replace_settlement_summary_group_actual_special_codes\s*\(\s*p_session_id uuid,\s*p_summary_group_id text,\s*p_codes jsonb\s*\)[\s\S]*?returns integer/i.test(
    sql,
  ),
);

check(
  "C2A-02 authoritative target is latest non-archived Round",
  /from public\.settlement_summary_group_rounds r[\s\S]*?r\.settlement_session_id\s*=\s*p_session_id[\s\S]*?r\.summary_group_id\s*=\s*v_summary[\s\S]*?settlement_summary_group_round_snapshots[\s\S]*?order by r\.round_no desc[\s\S]*?limit 1/i.test(
    sql,
  ),
);

check(
  "C2A-03 missing Round fails closed",
  /raise exception 'ROUND_NOT_FOUND'/i.test(
    sql,
  ),
);

check(
  "C2A-04 Round RPC is authoritative mutation path",
  /public\.replace_settlement_round_actual_special_codes\s*\([\s\S]*?p_round_id\s*=>\s*v_round_id[\s\S]*?p_codes\s*=>\s*p_codes[\s\S]*?p_changed_by\s*=>\s*'LEGACY_COMPAT'/i.test(
    sql,
  ),
);

const roundCall =
  sql.indexOf(
    "public.replace_settlement_round_actual_special_codes",
  );

const legacyDelete =
  sql.indexOf(
    "delete from\n    public.settlement_summary_group_actual_special_point_codes",
  );

check(
  "C2A-05 Round mutation occurs before legacy mirror",
  roundCall >= 0
    && legacyDelete > roundCall,
);

check(
  "C2A-06 legacy mirror consumes normalized Round result",
  /jsonb_array_elements\s*\(\s*coalesce\s*\(\s*v_round_result->'codes'/i.test(
    sql,
  ),
);

check(
  "C2A-07 compatibility mirror replaces legacy Summary Group rows",
  /delete from\s+public\.settlement_summary_group_actual_special_point_codes[\s\S]*?insert into\s+public\.settlement_summary_group_actual_special_point_codes/i.test(
    sql,
  ),
);

check(
  "C2A-08 legacy input validation boundaries remain",
  /SETTLEMENT_NOT_FOUND/i.test(sql)
    && /SUMMARY_GROUP_REQUIRED/i.test(sql)
    && /SUMMARY_GROUP_NOT_IN_SETTLEMENT/i.test(
      sql,
    ),
);

check(
  "C2A-09 bridge does not restore parent OPEN-only restriction",
  !/status\s*(?:<>|!=)\s*'OPEN'/i.test(
    sql,
  )
    && !/status\s*=\s*'OPEN'/i.test(sql),
);

check(
  "C2A-10 no direct Round table mutation bypasses audited RPC",
  !/delete from\s+public\.settlement_round_actual_special_point_codes/i.test(
    sql,
  )
    && !/insert into\s+public\.settlement_round_actual_special_point_codes/i.test(
      sql,
    ),
);

check(
  "C2A-11 production Risk views remain untouched",
  !/create or replace view\s+public\.session_(?:line_group_code|code|category)_risk_state/i.test(
    sql,
  ),
);

check(
  "C2A-12 Promotion configuration remains untouched",
  !/settlement_(?:round_)?point_promotions/i.test(
    sql,
  ),
);

check(
  "C2A-13 migration is transactional",
  /^\s*begin;/i.test(sql)
    && /commit;\s*$/i.test(sql),
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  "PASS: Round Actual Point legacy compatibility bridge v1",
);
