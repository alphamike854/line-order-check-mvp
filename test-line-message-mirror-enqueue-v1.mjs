"use strict";

import fs from "node:fs";
import assert from "node:assert/strict";

const webhookPath =
  "netlify/functions/line-webhook.mjs";

const migrationPath =
  "supabase/migrations/20260914013000_add_line_message_mirror_foundation.sql";

const source =
  fs.readFileSync(
    webhookPath,
    "utf8",
  );

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

function must(
  text,
  pattern,
  label,
) {
  assert.match(
    text,
    pattern,
    `missing contract: ${label}`,
  );
}

function mustNot(
  text,
  pattern,
  label,
) {
  assert.doesNotMatch(
    text,
    pattern,
    `forbidden contract: ${label}`,
  );
}


must(
  source,
  /async function enqueueLineMessageMirrorBestEffort\(message\)/,
  "admitted-message mirror helper",
);

must(
  source,
  /\.rpc\(\s*"enqueue_line_message_mirror"[\s\S]*p_message_record_id:\s*message\.id/,
  "RPC receives authoritative message-record id only",
);

must(
  source,
  /!message\?\.id[\s\S]*!message\?\.summary_group_round_id/,
  "helper requires Round-owned admitted message",
);

must(
  sql,
  /create or replace function public\.enqueue_line_message_mirror\(\s*p_message_record_id uuid\s*\)/i,
  "DB RPC accepts message-record identity",
);

must(
  sql,
  /from public\.messages m[\s\S]*where m\.id = p_message_record_id/i,
  "RPC re-reads authoritative messages row",
);

must(
  sql,
  /if v_message\.summary_group_round_id is null then[\s\S]*NOT_ADMITTED_TO_WORKING_ROUND/i,
  "Round ownership gates mirror eligibility",
);

must(
  sql,
  /summary_group_round_id uuid not null[\s\S]*references public\.settlement_summary_group_rounds\(id\)/i,
  "queue persists authoritative Round ownership",
);

must(
  sql,
  /source_message_record_id uuid not null/i,
  "queue preserves source message-record identity",
);

must(
  sql,
  /unique\s*\(\s*route_id,\s*webhook_event_id\s*\)/i,
  "redelivery-safe queue uniqueness",
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
  "mirror helper boundary must be detectable",
);

const helper =
  source.slice(
    helperStart,
    helperEnd,
  );

mustNot(
  helper,
  /\bthrow\b/,
  "mirror enqueue must not throw into intake",
);

mustNot(
  helper,
  /parseOrder|transcribeOrderImage|persistParsedResult|saveReview/,
  "mirror helper remains independent of parser/OCR/review",
);


const textStart =
  source.indexOf(
    "async function handleTextMessage",
  );

const imageStart =
  source.indexOf(
    "async function handleImageMessage",
  );

const unsendStart =
  source.indexOf(
    "async function handleUnsend",
  );

assert.ok(
  textStart >= 0
    && imageStart > textStart
    && unsendStart > imageStart,
  "handler boundaries must be detectable",
);

const textHandler =
  source.slice(
    textStart,
    imageStart,
  );

const imageHandler =
  source.slice(
    imageStart,
    unsendStart,
  );

for (
  const [name, handler]
  of [
    ["text", textHandler],
    ["image", imageHandler],
  ]
) {
  const createIndex =
    handler.indexOf(
      "await createMessage",
    );

  const ignoredIndex =
    handler.indexOf(
      "if (message?.ignored)",
    );

  const enqueueIndex =
    handler.indexOf(
      "await enqueueLineMessageMirrorBestEffort",
    );

  assert.ok(
    createIndex >= 0,
    `${name}: createMessage must exist`,
  );

  assert.ok(
    ignoredIndex > createIndex,
    `${name}: ignored admission must follow createMessage`,
  );

  assert.ok(
    enqueueIndex > ignoredIndex,
    `${name}: mirror enqueue must occur only after admission rejection check`,
  );
}

const textParserIndex =
  textHandler.indexOf(
    "parseOrder(",
  );

const textEnqueueIndex =
  textHandler.indexOf(
    "await enqueueLineMessageMirrorBestEffort",
  );

assert.ok(
  textParserIndex > textEnqueueIndex,
  "text mirror enqueue must precede Parser",
);


const imageDownloadIndex =
  imageHandler.indexOf(
    "downloadLineImage(",
  );

const imageEnqueueIndex =
  imageHandler.indexOf(
    "await enqueueLineMessageMirrorBestEffort",
  );

assert.ok(
  imageDownloadIndex > imageEnqueueIndex,
  "image mirror enqueue must precede OCR image download",
);


const processStart =
  source.indexOf(
    "export async function processEvent",
  );

const defaultStart =
  source.indexOf(
    "export default async",
    processStart,
  );

const processEvent =
  source.slice(
    processStart,
    defaultStart,
  );

mustNot(
  processEvent,
  /await enqueueLineMessageMirrorBestEffort/,
  "processEvent must not enqueue before Round admission",
);


mustNot(
  source,
  /api\.line\.me\/v2\/bot\/message\/push/,
  "MIR2B-R1 still contains no LINE Push transport",
);

console.log(
  "PASS MIR2B-R1-01: Mirror consumes admitted messages, not raw events",
);

console.log(
  "PASS MIR2B-R1-02: summary_group_round_id is mandatory",
);

console.log(
  "PASS MIR2B-R1-03: DB re-reads authoritative source message",
);

console.log(
  "PASS MIR2B-R1-04: CLOSED/NOT_STARTED rejection cannot enqueue Mirror",
);

console.log(
  "PASS MIR2B-R1-05: admitted text enqueues before Parser",
);

console.log(
  "PASS MIR2B-R1-06: admitted image enqueues before OCR",
);

console.log(
  "PASS MIR2B-R1-07: Mirror failure remains isolated from intake",
);

console.log(
  "PASS MIR2B-R1-08: queue carries immutable Round ownership",
);

console.log(
  "PASS MIR2B-R1-09: no pre-admission processEvent enqueue remains",
);

console.log(
  "PASS MIR2B-R1-10: no LINE Push transport exists yet",
);

console.log(
  "PASS: LINE Message Mirror Round-owned admission v1",
);
