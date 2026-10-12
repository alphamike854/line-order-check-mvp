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

// Q1A/QStash widened the processEvent signature. Match its entry point
// without coupling this security guard to a fixed argument count.
const processStart =
  webhook.search(
    /export\s+async\s+function\s+processEvent\s*\(\s*destination\s*,\s*event\b/,
  );

assert.ok(
  processStart >= 0,
  "processEvent must exist",
);

const processEnd =
  webhook.indexOf(
    "\nexport default async (req)",
    processStart,
  );

assert.ok(
  processEnd > processStart,
  "processEvent must end before webhook handler",
);

const processBody =
  webhook.slice(processStart, processEnd);

const find = (regex) =>
  processBody.search(regex);

// Temporal admission is a read-only gate before the authoritative
// webhook claim. Mirror destination DENIED must happen after claim,
// but before any normal message, OCR, review, or UNSEND handler.
const temporalAdmissionPosition =
  find(/\breadLineWebhookIngressAdmission\s*\(/);
const temporalRejectPosition =
  find(/"INGRESS_NOT_OPEN_AT_EVENT_TIME"/);
const claimPosition =
  find(/await\s+claimWebhookEvent\s*\(\s*destination\s*,\s*event\s*,\s*admissionRoundId/);
const retiredPosition =
  find(/claim\?\.state\s*===\s*"RETIRED"/);
const deniedPosition =
  find(/claim\?\.state\s*===\s*"DENIED"/);
const deniedResult =
  find(/"MIRROR_DESTINATION_INGESTION_DENIED"/);
const donePosition =
  find(/claim\?\.state\s*===\s*"DONE"/);
const existingMessagePosition =
  find(/\bfindMessageByWebhookEvent\s*\(/);
const sessionPosition =
  find(/\bresolveOpenSettlementSession\s*\(/);
const textPosition =
  find(/\bhandleTextMessage\s*\(/);
const imagePosition =
  find(/\bhandleImageMessage\s*\(/);
const unsendPosition =
  find(/\bhandleUnsend\s*\(\s*destination\s*,\s*event\s*,/);

assert.ok(
  temporalAdmissionPosition >= 0
    && temporalRejectPosition > temporalAdmissionPosition
    && claimPosition > temporalRejectPosition,
  "temporal admission must gate message claim without persisting orders",
);

assert.doesNotMatch(
  processBody.slice(0, claimPosition),
  /await\s+(?:createMessage|persistParsedResult|handleTextMessage|handleImageMessage|handleUnsend)\s*\(/,
  "no order persistence or message handlers before claim",
);

assert.ok(
  retiredPosition > claimPosition
    && deniedPosition > retiredPosition,
  "RETIRED and DENIED must be handled immediately after claim",
);

assert.ok(
  deniedResult > deniedPosition
    && donePosition > deniedResult,
  "DENIED must return before DONE/other claim states",
);

assert.match(
  processBody.slice(deniedPosition, donePosition),
  /return\s*\{\s*skipped:\s*"MIRROR_DESTINATION_INGESTION_DENIED"/,
  "DENIED must return immediately instead of continuing ingestion",
);

for (const [name, position] of [
  ["existing message lookup", existingMessagePosition],
  ["settlement resolution", sessionPosition],
  ["text handler", textPosition],
  ["image handler", imagePosition],
  ["unsend handler", unsendPosition],
]) {
  assert.ok(
    position > deniedPosition,
    `${name} must occur after DENIED exit`,
  );
}

console.log(
  "PASS: temporal admission and RETIRED checks precede DENIED",
);

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
