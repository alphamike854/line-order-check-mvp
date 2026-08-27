import assert from "node:assert/strict";
import fs from "node:fs";

import {
  parseOrder,
  PARSER_VERSION,
} from "./src/lib/order-parser.mjs";

const webhook = fs.readFileSync(
  "netlify/functions/line-webhook.mjs",
  "utf8",
);

const migration = fs.readFileSync(
  "supabase/migrations/20260827050000_atomic_parsed_persistence.sql",
  "utf8",
);

// ------------------------------------------------------------
// Production regression specimen:
// parser must produce all six canonical items.
// ------------------------------------------------------------

{
  const result = parseOrder(`640=50*50
624=20*30

77=800*800`);

  assert.equal(result.status, "PARSED");

  const map = Object.fromEntries(
    result.items.map(item => [
      `${item.category}${item.code}`,
      item.quantity,
    ]),
  );

  assert.deepEqual(map, {
    A77: 800,
    B77: 800,
    E624: 20,
    E640: 50,
    F624: 30,
    F640: 50,
  });
}

// ------------------------------------------------------------
// Webhook must use atomic RPC for PARSED.
// ------------------------------------------------------------

assert.match(
  webhook,
  /result\.status === "PARSED"[\s\S]*persist_parsed_message_atomic/,
);

assert.match(
  webhook,
  /PARSED_WITHOUT_ITEMS/,
);

const persistStart = webhook.indexOf(
  "async function persistParsedResult",
);
const persistEnd = webhook.indexOf(
  "async function handleTextMessage",
  persistStart,
);

assert.ok(persistStart >= 0);
assert.ok(persistEnd > persistStart);

const persistBody = webhook.slice(
  persistStart,
  persistEnd,
);

// Canonical order_items must no longer be inserted directly
// from the webhook persistence function.
assert.doesNotMatch(
  persistBody,
  /\.from\(["']order_items["']\)\.insert/,
);

// ------------------------------------------------------------
// Database transaction safety contract.
// ------------------------------------------------------------

assert.match(
  migration,
  /jsonb_array_length\(p_items\)\s*=\s*0/,
);

assert.match(
  migration,
  /raise exception 'PARSED_ITEMS_REQUIRED'/,
);

assert.match(
  migration,
  /from public\.messages[\s\S]*for update/,
);

assert.match(
  migration,
  /from public\.settlement_sessions[\s\S]*for update/,
);

assert.match(
  migration,
  /v_session_status <> 'OPEN'/,
);

assert.match(
  migration,
  /raise exception 'MESSAGE_ALREADY_HAS_ITEMS'/,
);

assert.match(
  migration,
  /update public\.messages[\s\S]*parse_status = 'PARSED'/,
);

assert.match(
  migration,
  /insert into public\.order_items/,
);

assert.match(
  migration,
  /grant execute on function public\.persist_parsed_message_atomic[\s\S]*to service_role/,
);

console.log(
  `PASS: atomic PARSED persistence + no-zero-item invariant v8.8 (${PARSER_VERSION})`,
);
