"use strict";

import fs from "node:fs";
import assert from "node:assert/strict";

const migrationPath =
  "supabase/migrations/20260914013000_add_line_message_mirror_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

function must(pattern, label) {
  assert.match(
    sql,
    pattern,
    `missing contract: ${label}`,
  );
}

function mustNot(pattern, label) {
  assert.doesNotMatch(
    sql,
    pattern,
    `forbidden contract: ${label}`,
  );
}

must(
  /create table public\.line_message_mirror_routes/i,
  "routes table",
);

must(
  /create table public\.line_message_mirror_queue/i,
  "queue table",
);

must(
  /create table public\.line_message_mirror_batches/i,
  "batches table",
);

must(
  /create table public\.line_message_mirror_route_leases/i,
  "route lease table",
);

must(
  /enabled boolean not null default false/i,
  "feature disabled by default",
);

must(
  /max_batch_size smallint not null default 5/i,
  "default max batch size = 5",
);

must(
  /max_batch_size between 1 and 5/i,
  "LINE five-message hard limit",
);

must(
  /flush_after_seconds integer not null default 30/i,
  "30-second batching target",
);

must(
  /message_type in\s*\(\s*'text',\s*'image'\s*\)/i,
  "v1 text/image scope",
);

must(
  /unique\s*\(\s*route_id,\s*webhook_event_id\s*\)/i,
  "redelivery-safe queue uniqueness",
);

must(
  /source_line_group_id\s*<>\s*destination_line_group_id/i,
  "no self-mirror route",
);

must(
  /source_message_record_id uuid not null/i,
  "source message-record identity",
);

must(
  /summary_group_round_id uuid not null/i,
  "Round ownership persisted",
);

must(
  /references public\.settlement_summary_group_rounds\(id\)/i,
  "Round ownership FK",
);

must(
  /create or replace function public\.enqueue_line_message_mirror\(\s*p_message_record_id uuid\s*\)/i,
  "message-record enqueue RPC",
);

must(
  /security definer/i,
  "server-only enqueue RPC",
);

must(
  /from public\.messages m[\s\S]*where m\.id = p_message_record_id/i,
  "enqueue re-reads authoritative source message",
);

must(
  /if v_message\.summary_group_round_id is null then[\s\S]*NOT_ADMITTED_TO_WORKING_ROUND/i,
  "non-Round messages are not eligible",
);

must(
  /where route\.enabled = true/i,
  "only enabled routes enqueue",
);

must(
  /grant execute[\s\S]*enqueue_line_message_mirror\(uuid\)[\s\S]*to service_role/i,
  "service-role-only enqueue RPC",
);

mustNot(
  /alter table public\.messages/i,
  "must not alter messages",
);

mustNot(
  /alter table public\.order_items/i,
  "must not alter order_items",
);

mustNot(
  /alter table public\.review_items/i,
  "must not alter review_items",
);

mustNot(
  /create trigger[\s\S]*on public\.messages/i,
  "must not attach trigger to messages",
);

console.log(
  "PASS MIR2A-R1-01: routes/queue/batches/lease foundation exists",
);

console.log(
  "PASS MIR2A-R1-02: feature disabled by default",
);

console.log(
  "PASS MIR2A-R1-03: text + image only",
);

console.log(
  "PASS MIR2A-R1-04: max batch size <= 5",
);

console.log(
  "PASS MIR2A-R1-05: default flush window = 30 seconds",
);

console.log(
  "PASS MIR2A-R1-06: queue preserves message-record identity",
);

console.log(
  "PASS MIR2A-R1-07: queue preserves immutable Round ownership",
);

console.log(
  "PASS MIR2A-R1-08: enqueue re-reads authoritative messages row",
);

console.log(
  "PASS MIR2A-R1-09: non-Round messages cannot enter Mirror queue",
);

console.log(
  "PASS MIR2A-R1-10: no existing operational tables/triggers mutated",
);

console.log(
  "PASS: LINE Message Mirror Round-owned foundation v1",
);
