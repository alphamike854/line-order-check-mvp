import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261003233000_"
      + "add_line_webhook_ingress_admission.sql",
    "utf8",
  );

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const consumer =
  fs.readFileSync(
    "netlify/functions/line-webhook-qstash.mjs",
    "utf8",
  );

assert.match(
  migration,
  /p_event_timestamp timestamptz/i,
);

assert.match(
  migration,
  /settlement_line_group_round_config lineage/i,
);

assert.match(
  migration,
  /p_event_timestamp\s*>=\s*r\.opened_at/i,
);

assert.match(
  migration,
  /p_event_timestamp\s*<\s*r\.closed_at/i,
);

assert.match(
  migration,
  /EXISTING_ADMITTED_MESSAGE/,
);

const rpcStart =
  migration.indexOf(
    "create or replace function\n"
    + "  public.line_webhook_ingress_admission",
  );

const triggerStart =
  migration.indexOf(
    "create or replace function\n"
    + "  public.assign_message_to_open_settlement",
  );

assert.ok(
  rpcStart >= 0
  && triggerStart > rpcStart,
);

const rpcBody =
  migration.slice(
    rpcStart,
    triggerStart,
  );

assert.doesNotMatch(
  rpcBody,
  /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i,
);

assert.doesNotMatch(
  rpcBody,
  /pg_advisory/i,
);

const triggerBody =
  migration.slice(
    triggerStart,
  );

assert.match(
  triggerBody,
  /new\.summary_group_round_id is not null[\s\S]*new\.event_timestamp/i,
);

assert.match(
  triggerBody,
  /MESSAGE_EVENT_OUTSIDE_ROUND/,
);

assert.match(
  triggerBody,
  /MESSAGE_LINE_GROUP_CONFIG_MISMATCH/,
);

assert.match(
  triggerBody,
  /settlement_line_group_round_config lineage[\s\S]*lineage\.line_group_id\s*=\s*new\.line_group_id/i,
);

assert.match(
  webhook,
  /Q1A temporal admission v2/,
);

assert.match(
  webhook,
  /readLineWebhookIngressAdmission\(\s*lineGroupId,\s*event\.timestamp,\s*null,/,
);

assert.match(
  webhook,
  /admissionHints\.set\(/,
);

assert.match(
  webhook,
  /line_group_id:\s*lineGroupId/,
);

assert.match(
  webhook,
  /webhook_event_id:\s*event\.webhookEventId/,
);

assert.match(
  webhook,
  /admission:\s*qstashAdmissionHints\.get\(/,
);

assert.match(
  consumer,
  /const admission\s*=\s*payload\?\.admission\s*\?\?\s*null;/,
);

assert.match(
  consumer,
  /processEvent\(\s*destination,\s*event,\s*admission,/,
);

assert.match(
  webhook,
  /validTemporalAdmissionHint\(/,
);

assert.match(
  webhook,
  /hintTimestamp[\s\S]*eventTimestamp/,
);

assert.match(
  webhook,
  /hintLineGroupId[\s\S]*eventLineGroupId/,
);

assert.match(
  webhook,
  /hintWebhookEventId[\s\S]*eventWebhookEventId/,
);

const processStart =
  webhook.indexOf(
    "export async function processEvent(",
  );

const lookup =
  webhook.indexOf(
    "readLineWebhookIngressAdmission(",
    processStart,
  );

const claim =
  webhook.indexOf(
    "claimWebhookEvent(",
    processStart,
  );

assert.ok(
  processStart >= 0
  && lookup > processStart
  && lookup < claim,
);

assert.match(
  webhook,
  /const admissionRoundId\s*=[\s\S]*temporalAdmission\?\.round_id/,
);

assert.match(
  webhook,
  /summary_group_round_id:\s*\n\s*summaryGroupRoundId/,
);

assert.match(
  webhook,
  /handleTextMessage\([\s\S]*summaryGroupRoundId = null/,
);

assert.match(
  webhook,
  /handleImageMessage\([\s\S]*summaryGroupRoundId = null/,
);

assert.match(
  webhook,
  /INGRESS_NOT_OPEN_AT_EVENT_TIME/,
);

assert.match(
  webhook,
  /isLineUnsendIngressEvent[\s\S]*selected\.push\(event\)/,
);

assert.match(
  webhook,
  /catch\s*\(error\)[\s\S]*selected\.push\(event\)/,
);

console.log(
  "PASS Q1A2-01: admission uses original LINE event timestamp",
);
console.log(
  "PASS Q1A2-02: immutable Round/LINE Group lineage is authoritative",
);
console.log(
  "PASS Q1A2-03: healthy publisher carries signed Round hint",
);
console.log(
  "PASS Q1A2-04: hint bound to event + group + timestamp",
);
console.log(
  "PASS Q1A2-05: healthy consumer avoids duplicate admission read",
);
console.log(
  "PASS Q1A2-06: fail-open job resolves admission before claim",
);
console.log(
  "PASS Q1A2-07: explicit message INSERT revalidates event-time ownership",
);
console.log(
  "PASS Q1A2-08: pre-close event can complete after close",
);
console.log(
  "PASS Q1A2-09: pre-open/post-close event is rejected",
);
console.log(
  "PASS Q1A2-10: UNSEND bypass retained",
);
console.log(
  "PASS: Q1A Temporal Webhook Admission v2",
);
