"use strict";

import fs from "node:fs";
import assert from "node:assert/strict";

const source =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const helperStart =
  source.indexOf(
    "async function enqueueLineMessageMirrorBestEffort",
  );

const helperEnd =
  source.indexOf(
    "async function findMessageByWebhookEvent",
    helperStart,
  );

assert.ok(
  helperStart >= 0
    && helperEnd > helperStart,
  "Mirror helper boundary must exist",
);

const helper =
  source.slice(
    helperStart,
    helperEnd,
  );

assert.match(
  helper,
  /process\.env\.LINE_MESSAGE_MIRROR_ENABLED/,
  "global Mirror env gate must exist",
);

assert.match(
  helper,
  /\.toLowerCase\(\)\s*===\s*"true"/,
  "Mirror must require explicit true",
);

assert.match(
  helper,
  /if\s*\(!mirrorEnabled\)[\s\S]*skipped:\s*"MIRROR_DISABLED"/,
  "missing/false env must stop Mirror",
);

const gateIndex =
  helper.indexOf(
    "if (!mirrorEnabled)",
  );

const roundIndex =
  helper.indexOf(
    "!message?.summary_group_round_id",
  );

const rpcIndex =
  helper.indexOf(
    '"enqueue_line_message_mirror"',
  );

assert.ok(
  gateIndex >= 0,
  "global gate must be detectable",
);

assert.ok(
  roundIndex > gateIndex,
  "global gate must run before Round/message inspection",
);

assert.ok(
  rpcIndex > gateIndex,
  "global gate must run before any Mirror RPC",
);

assert.doesNotMatch(
  helper,
  /LINE_MESSAGE_MIRROR_ENABLED\s*\?\?\s*"true"/,
  "Mirror must never default to enabled",
);

assert.doesNotMatch(
  helper,
  /LINE_MESSAGE_MIRROR_ENABLED\s*\|\|\s*"true"/,
  "Mirror must never fallback to enabled",
);

console.log(
  "PASS MIR2B-R2-01: global Mirror kill switch exists",
);

console.log(
  "PASS MIR2B-R2-02: missing env means Mirror disabled",
);

console.log(
  "PASS MIR2B-R2-03: only explicit true enables Mirror path",
);

console.log(
  "PASS MIR2B-R2-04: disabled path returns before Mirror RPC",
);

console.log(
  "PASS MIR2B-R2-05: production can deploy with zero Mirror DB traffic",
);

console.log(
  "PASS: LINE Message Mirror global default-off gate v1",
);
