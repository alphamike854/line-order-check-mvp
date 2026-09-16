import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    new URL(
      "./netlify/functions/dashboard.mjs",
      import.meta.url,
    ),
    "utf8",
  );

function matching(
  text,
  start,
  left,
  right,
) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (
    let i = start;
    i < text.length;
    i += 1
  ) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === "'"
      || ch === '"'
      || ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === left) {
      depth += 1;
    } else if (ch === right) {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error(
    `unmatched delimiter ${left}`,
  );
}

const riskDeclaration =
  source.indexOf(
    "const riskSnapshotQuery=",
  );

assert.notEqual(
  riskDeclaration,
  -1,
  "Risk query declaration must remain present",
);

const riskAwaitMatch =
  source.match(
    /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+riskSnapshotQuery\s*;/,
  );

assert.ok(
  riskAwaitMatch,
  "Dashboard must await Risk before secondary fan-out",
);

const riskAwait =
  riskAwaitMatch.index;

assert.ok(
  riskAwait > riskDeclaration,
  "Risk await must occur after Risk query declaration",
);

const rpcCalls =
  source.match(
    /supabase\.rpc\(\s*"dashboard_risk_snapshot"/g,
  ) ?? [];

assert.equal(
  rpcCalls.length,
  1,
  "Dashboard Risk RPC must still execute exactly once",
);

const promiseHits = [
  ...source.matchAll(
    /Promise\.all\s*\(/g,
  ),
];

const postBarrierPromises =
  promiseHits.filter(
    (match) =>
      match.index > riskAwait,
  );

assert.ok(
  postBarrierPromises.length >= 1,
  "Secondary Promise.all must remain after Risk barrier",
);

for (
  const hit
  of postBarrierPromises
) {
  const open =
    source.indexOf(
      "(",
      hit.index,
    );

  const close =
    matching(
      source,
      open,
      "(",
      ")",
    );

  const block =
    source.slice(
      hit.index,
      close + 1,
    );

  assert.equal(
    block.includes(
      "riskSnapshotQuery",
    ),
    false,
    "Risk must not remain in secondary Promise.all",
  );
}

const secondary =
  postBarrierPromises[0];

assert.ok(
  riskAwait < secondary.index,
  "Risk barrier must precede secondary Dashboard fan-out",
);

assert.match(
  source,
  /p_settlement_session_id\s*:\s*session\.id/,
  "Risk session scope remains unchanged",
);

assert.match(
  source,
  /p_summary_group_id\s*:\s*summaryGroupId\s*\?\?\s*null/,
  "Risk selected-group/ALL scope remains unchanged",
);

console.log(
  "PASS: Dashboard Risk-first barrier",
);

console.log(
  "PASS: Risk RPC remains exactly once",
);

console.log(
  "PASS: Risk scope semantics unchanged",
);

console.log(
  "PASS: secondary fan-out starts after Risk completion",
);
