import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(
  "public/app.js",
  "utf8",
);

const start = source.indexOf(
  "async function openSettlement()",
);

assert.ok(
  start >= 0,
  "openSettlement() must exist",
);

const end = source.indexOf(
  "async function closeSettlement()",
  start,
);

assert.ok(
  end > start,
  "closeSettlement() must follow openSettlement()",
);

const block = source.slice(start, end);

assert.ok(
  block.includes(
    'const openSession=state.settlement?.open_session;',
  ),
  "newly opened settlement must become report context",
);

assert.ok(
  block.includes(
    'const reportSelect=$("#reportSessionSelect");',
  ),
  "report session selector must be resolved",
);

assert.ok(
  block.includes(
    "reportSelect.value=openSession.id;",
  ),
  "report selector must switch to the newly opened session",
);

assert.ok(
  block.includes(
    "await loadReport({silent:true});",
  ),
  "report must refresh after opening a settlement",
);

console.log(
  "PASS: Report follows newly opened settlement v9.1",
);
