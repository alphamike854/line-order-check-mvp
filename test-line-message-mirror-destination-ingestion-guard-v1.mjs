import assert from "node:assert/strict";
import fs from "node:fs";

const migrationFile =
  "supabase/migrations/20260914021500_add_line_mirror_destination_ingestion_deny.sql";

const webhookFile =
  "netlify/functions/line-webhook.mjs";

const migration =
  fs.readFileSync(
    migrationFile,
    "utf8",
  );

const webhook =
  fs.readFileSync(
    webhookFile,
    "utf8",
  );

assert.match(
  migration,
  /create or replace function public\.claim_webhook_event\(/i,
  "claim RPC must be replaced atomically",
);

assert.match(
  migration,
  /line_message_mirror_routes[\s\S]*destination_line_group_id/i,
  "claim RPC must recognize mirror destinations",
);

assert.doesNotMatch(
  migration,
  /destination_line_group_id[\s\S]{0,160}\benabled\s*=\s*true/i,
  "disabled routes must still deny destination ingestion",
);

assert.match(
  migration,
  /v_stored_user_id\s*:=\s*null/i,
  "destination sender user ID must not be retained",
);

assert.match(
  migration,
  /v_stored_payload\s*:=\s*'\{\}'::jsonb/i,
  "destination payload must be redacted before INSERT",
);

assert.match(
  migration,
  /user_id\s*=\s*null[\s\S]*payload\s*=\s*'\{\}'::jsonb/i,
  "existing/retried destination event must also be redacted",
);

assert.match(
  migration,
  /processed_at\s*=\s*coalesce\([\s\S]*processed_at,[\s\S]*now\(\)/i,
  "denied destination event must become terminally processed",
);

assert.match(
  migration,
  /processing_started_at\s*=\s*null/i,
  "denied destination must not retain an in-flight claim",
);

assert.match(
  migration,
  /'state',[\s\S]*'DENIED'/i,
  "claim RPC must return explicit DENIED state",
);

assert.match(
  migration,
  /'reason',[\s\S]*'MIRROR_DESTINATION'/i,
  "DENIED state must identify mirror destination reason",
);

assert.match(
  migration,
  /line_message_mirror_routes_destination_idx/i,
  "destination lookup must have a dedicated index",
);

assert.match(
  migration,
  /grant execute[\s\S]*to service_role/i,
  "claim RPC must remain service-role only",
);

assert.doesNotMatch(
  webhook,
  /isLineMessageMirrorDestination/,
  "application-level destination lookup must not exist",
);

const processStart =
  webhook.indexOf(
    "export async function processEvent(destination, event)",
  );

assert.ok(
  processStart >= 0,
  "processEvent must exist",
);

const processTail =
  webhook.slice(
    processStart,
  );

const claimPosition =
  processTail.indexOf(
    "claimWebhookEvent(destination, event)",
  );

const deniedPosition =
  processTail.indexOf(
    'claim?.state === "DENIED"',
  );

const deniedResult =
  processTail.indexOf(
    "MIRROR_DESTINATION_INGESTION_DENIED",
  );

const existingMessagePosition =
  processTail.indexOf(
    "findMessageByWebhookEvent(",
  );

const sessionPosition =
  processTail.indexOf(
    "resolveOpenSettlementSession()",
  );

const textPosition =
  processTail.indexOf(
    "handleTextMessage(",
  );

const imagePosition =
  processTail.indexOf(
    "handleImageMessage(",
  );

const unsendPosition =
  processTail.indexOf(
    "handleUnsend(destination, event)",
  );

assert.ok(
  claimPosition >= 0,
  "claim must remain first persistence boundary",
);

assert.ok(
  deniedPosition > claimPosition,
  "DENIED must be handled immediately after claim",
);

assert.ok(
  deniedResult > deniedPosition,
  "explicit denied result must be returned",
);

for (const [name, position] of [
  [
    "existing message lookup",
    existingMessagePosition,
  ],
  [
    "settlement resolution",
    sessionPosition,
  ],
  [
    "text handler",
    textPosition,
  ],
  [
    "image handler",
    imagePosition,
  ],
  [
    "unsend handler",
    unsendPosition,
  ],
]) {
  assert.ok(
    position > deniedPosition,
    `${name} must occur after DENIED exit`,
  );
}

console.log(
  "PASS: destination detection moved into claim RPC",
);

console.log(
  "PASS: disabled route remains an ingestion deny",
);

console.log(
  "PASS: destination payload is redacted before persistence",
);

console.log(
  "PASS: destination sender user ID is not retained",
);

console.log(
  "PASS: destination event is atomically marked processed",
);

console.log(
  "PASS: webhook exits before message/parser/OCR/review/unsend/mirror pipeline",
);

console.log(
  "PASS: no extra application Supabase lookup added to normal group traffic",
);
