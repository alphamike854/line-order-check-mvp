"use strict";

import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260914020000_add_line_mirror_image_retry_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

function requireMatch(
  pattern,
  label,
) {
  if (!pattern.test(sql)) {
    throw new Error(
      `FAIL ${label}`,
    );
  }

  console.log(
    `PASS ${label}`,
  );
}

function requireAbsent(
  pattern,
  label,
) {
  if (pattern.test(sql)) {
    throw new Error(
      `FAIL ${label}`,
    );
  }

  console.log(
    `PASS ${label}`,
  );
}

requireMatch(
  /'mirror-images'[\s\S]*false[\s\S]*10485760/i,
  "MIR2C-D-B1-01: private mirror-images bucket capped at 10 MiB",
);

requireMatch(
  /allowed_mime_types[\s\S]*image\/jpeg[\s\S]*image\/png/i,
  "MIR2C-D-B1-02: bucket permits JPEG and PNG only",
);

requireMatch(
  /create table if not exists\s+public\.line_message_mirror_image_assets/i,
  "MIR2C-D-B1-03: durable image asset table exists",
);

requireMatch(
  /queue_id bigint not null[\s\S]*unique[\s\S]*line_message_mirror_queue\(id\)/i,
  "MIR2C-D-B1-04: one image asset identity per Mirror queue item",
);

requireMatch(
  /preview_size_bytes[\s\S]*1048576/i,
  "MIR2C-D-B1-05: preview is hard-capped at 1 MiB",
);

requireMatch(
  /original_size_bytes[\s\S]*10485760/i,
  "MIR2C-D-B1-06: original is hard-capped at 10 MiB",
);

requireMatch(
  /serve_token_sha256/i,
  "MIR2C-D-B1-07: stable capability-token hash is persisted",
);

requireMatch(
  /serve_expires_at[\s\S]*26 hours/i,
  "MIR2C-D-B1-08: prepared image URL horizon exceeds 24-hour retry window",
);

requireMatch(
  /prepared_request_body text/i,
  "MIR2C-D-B1-09: exact request body is persisted on batch",
);

requireMatch(
  /prepared_request_sha256 text/i,
  "MIR2C-D-B1-10: exact request-body hash is persisted",
);

requireMatch(
  /MIRROR_PREPARED_REQUEST_IMMUTABLE/i,
  "MIR2C-D-B1-11: prepared request becomes immutable",
);

requireMatch(
  /MIRROR_IMAGE_ASSET_IMMUTABLE/i,
  "MIR2C-D-B1-12: READY image metadata is immutable",
);

requireMatch(
  /ensure_line_message_mirror_image_asset/i,
  "MIR2C-D-B1-13: image asset creation is lease-scoped",
);

requireMatch(
  /mark_line_message_mirror_image_asset_ready/i,
  "MIR2C-D-B1-14: image READY transition has dedicated RPC",
);

requireMatch(
  /prepare_line_message_mirror_batch_request/i,
  "MIR2C-D-B1-15: request preparation has dedicated RPC",
);

requireMatch(
  /PREPARED_REQUEST_MISMATCH/i,
  "MIR2C-D-B1-16: retry payload mismatch fails closed",
);

requireMatch(
  /IMAGE_ASSET_NOT_READY/i,
  "MIR2C-D-B1-17: batch cannot persist image request before assets are READY",
);

requireMatch(
  /get_line_message_mirror_prepared_request/i,
  "MIR2C-D-B1-18: retry worker can recover exact persisted body",
);

requireMatch(
  /grant execute[\s\S]*ensure_line_message_mirror_image_asset[\s\S]*to service_role/i,
  "MIR2C-D-B1-19: image preparation RPCs remain service-role only",
);

requireMatch(
  /enable row level security/i,
  "MIR2C-D-B1-20: image asset table has RLS enabled",
);

requireAbsent(
  /create policy/i,
  "MIR2C-D-B1-21: no anon/authenticated Storage policy introduced",
);

requireAbsent(
  /alter table\s+public\.messages/i,
  "MIR2C-D-B1-22: operational messages schema remains untouched",
);

requireAbsent(
  /review-images/i,
  "MIR2C-D-B1-23: Mirror assets remain separate from Review Storage",
);

requireAbsent(
  /insert\s+into\s+public\.line_message_mirror_routes/i,
  "MIR2C-D-B1-24: migration creates no live Mirror route",
);

requireAbsent(
  /LINE_MESSAGE_MIRROR_ENABLED/i,
  "MIR2C-D-B1-25: migration cannot activate global Mirror",
);

console.log(
  "PASS: LINE Mirror retry-stable image DB/Storage foundation v1",
);

requireMatch(
  /extensions\.digest[\s\S]*sha256[\s\S]*MIRROR_PREPARED_REQUEST_SHA256_MISMATCH/i,
  "MIR2C-D-B1-R1-01: DB verifies exact request-body SHA-256",
);

requireMatch(
  /MIRROR_PREPARED_REQUEST_DESTINATION_MISMATCH/i,
  "MIR2C-D-B1-R1-02: frozen payload is bound to batch destination",
);

requireMatch(
  /MIRROR_PREPARED_REQUEST_ITEM_COUNT_MISMATCH/i,
  "MIR2C-D-B1-R1-03: frozen payload message count must equal batch item count",
);

requireMatch(
  /BATCH_ITEM_STATE_MISMATCH/i,
  "MIR2C-D-B1-R1-04: preparation requires exact CLAIMED queue cardinality",
);

requireMatch(
  /MIRROR_IMAGE_ASSET_IDENTITY_IMMUTABLE/i,
  "MIR2C-D-B1-R1-05: queue and Storage paths are immutable from creation",
);

requireMatch(
  /v_request_prepared[\s\S]*prepared_request_body[\s\S]*MIRROR_IMAGE_ASSET_IMMUTABLE/i,
  "MIR2C-D-B1-R1-06: media metadata freezes with persisted request body",
);

requireMatch(
  /v_asset\.status = 'READY'[\s\S]*v_batch\.prepared_request_body[\s\S]*is not null[\s\S]*MIRROR_IMAGE_ASSET_READY_IMMUTABLE/i,
  "MIR2C-D-B1-R1-07: READY asset refresh is allowed only before request freeze",
);

console.log(
  "PASS: LINE Mirror image foundation R1 payload/freeze hardening",
);
