"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

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

const pkg =
  JSON.parse(
    fs.readFileSync(
      "package.json",
      "utf8",
    ),
  );

assert.equal(
  pkg.dependencies?.["@upstash/qstash"],
  "2.12.0",
  "QStash SDK must be exact-pinned",
);

assert.match(
  webhook,
  /LINE_WEBHOOK_QSTASH_ENABLED/,
);

assert.match(
  webhook,
  /QSTASH_TOKEN/,
);

assert.match(
  webhook,
  /publishJSON/,
);

assert.match(
  webhook,
  /deduplicationId/,
);

assert.match(
  webhook,
  /line-webhook-ingress-v1/,
);

assert.match(
  webhook,
  /parallelism:\s*2/,
);

assert.match(
  webhook,
  /rate:\s*5/,
);

assert.match(
  webhook,
  /60000 \* \(1 \+ retried\)/,
);

/*
 * Rollback path must remain present.
 */
assert.match(
  webhook,
  /line-webhook-background/,
);

assert.match(
  webhook,
  /BACKGROUND_NOT_ACCEPTED/,
);

/*
 * Consumer authentication must happen
 * before processEvent().
 */
assert.match(
  consumer,
  /Receiver/,
);

assert.match(
  consumer,
  /upstash-signature/,
);

assert.match(
  consumer,
  /receiver\.verify/,
);

assert.match(
  consumer,
  /QSTASH_CURRENT_SIGNING_KEY/,
);

assert.match(
  consumer,
  /QSTASH_NEXT_SIGNING_KEY/,
);

assert.match(
  consumer,
  /processEvent/,
);

assert.ok(
  consumer.indexOf("receiver.verify")
    < consumer.indexOf("processEvent("),
  "signature verification must precede processing",
);

assert.match(
  consumer,
  /EVENT_IN_FLIGHT_RETRY/,
);

assert.match(
  consumer,
  /region:\s*"sin"/,
);

console.log(
  "PASS: QStash ingress contract"
);
console.log(
  "PASS: QStash signature verification contract"
);
console.log(
  "PASS: flow-control/backpressure contract"
);
console.log(
  "PASS: legacy Netlify background rollback retained"
);
