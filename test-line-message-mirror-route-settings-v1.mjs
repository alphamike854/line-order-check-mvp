import assert from "node:assert/strict";
import fs from "node:fs";

import {
  validateMirrorRoute,
} from "./src/lib/settings-validation.mjs";

const settingsApi =
  fs.readFileSync(
    "netlify/functions/settings.mjs",
    "utf8",
  );

const dashboardApi =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const good =
  validateMirrorRoute({
    source_line_group_id:
      "C123456789",

    destination_line_group_id:
      "C987654321",

    max_batch_size:
      5,

    flush_after_seconds:
      30,

    enabled:
      false,
  });

assert.equal(
  good.enabled,
  false,
  "MR1-01 route defaults fail closed",
);

assert.throws(
  () =>
    validateMirrorRoute({
      source_line_group_id:
        "C123456789",

      destination_line_group_id:
        "C123456789",
    }),
  /INVALID_MIRROR_ROUTE_SELF/,
  "MR1-02 self route rejected",
);

assert.throws(
  () =>
    validateMirrorRoute({
      source_line_group_id:
        "C123456789",

      destination_line_group_id:
        "C987654321",

      max_batch_size:
        6,
    }),
  /INVALID_MIRROR_MAX_BATCH_SIZE/,
  "MR1-03 batch bounded 1..5",
);

assert.throws(
  () =>
    validateMirrorRoute({
      source_line_group_id:
        "C123456789",

      destination_line_group_id:
        "C987654321",

      flush_after_seconds:
        301,
    }),
  /INVALID_MIRROR_FLUSH_SECONDS/,
  "MR1-04 flush bounded 5..300",
);

assert.match(
  settingsApi,
  /entity\s*===\s*"MIRROR_ROUTE"/,
  "MR1-05 Settings API accepts MIRROR_ROUTE",
);

assert.match(
  settingsApi,
  /assertMirrorSourceExists/,
  "MR1-06 source must exist in configured LINE Group registry",
);

assert.match(
  settingsApi,
  /\.from\("webhook_events"\)/,
  "MR1-07 observed LINE rooms may be Mirror destinations",
);

assert.match(
  settingsApi,
  /MIRROR_DESTINATION_NOT_FOUND/,
  "MR1-08 unknown destination fails closed",
);

assert.match(
  settingsApi,
  /MIRROR_DESTINATION_ACTIVE_ORDER_GROUP/,
  "MR1-09 active order destination cannot enable",
);

assert.match(
  settingsApi,
  /MIRROR_GLOBAL_DISABLED/,
  "MR1-10 global kill switch gates route enable",
);

assert.match(
  settingsApi,
  /MIRROR_ROUTE_DISABLE_BEFORE_REMAP/,
  "MR1-11 enabled route requires disable before remap",
);

assert.match(
  settingsApi,
  /MIRROR_ROUTE_DUPLICATE/,
  "MR1-12 duplicate route explicitly conflicts",
);

assert.match(
  settingsApi,
  /supabase\.rpc\(\s*"save_mirror_route_settings"/,
  "MR1-13 route save delegates to transactional audited RPC",
);

assert.match(
  dashboardApi,
  /mirror_routes:\s*mirrorRouteResult\.data/,
  "MR1-14 Settings GET exposes Mirror routes",
);

assert.match(
  dashboardApi,
  /mirror_transport_enabled/,
  "MR1-15 Settings GET exposes boolean transport state",
);

assert.match(
  html,
  /id="mirrorRouteForm"/,
  "MR1-16 Mirror form exists",
);

assert.match(
  html,
  /name="source_line_group_id"/,
  "MR1-17 source picker exists",
);

assert.match(
  html,
  /name="destination_line_group_id"/,
  "MR1-18 destination picker exists",
);

assert.match(
  app,
  /unconfigured_line_groups/,
  "MR1-19 observed unconfigured rooms feed destination picker",
);

assert.match(
  app,
  /mirrorDestinationIsActiveOrderGroup/,
  "MR1-20 browser recognizes active order destination",
);

assert.match(
  app,
  /mirror_transport_enabled/,
  "MR1-21 browser recognizes global transport state",
);

assert.match(
  app,
  /source\s*===\s*destination/,
  "MR1-22 browser rejects self route",
);

assert.match(
  app,
  /saveSetting\(\s*"MIRROR_ROUTE"/,
  "MR1-23 browser uses authenticated Settings API",
);

assert.doesNotMatch(
  app,
  /supabase\s*\.\s*from\(\s*["']line_message_mirror_routes["']/,
  "MR1-24 browser never writes Mirror table directly",
);

assert.doesNotMatch(
  settingsApi,
  /process\.env\.LINE_MESSAGE_MIRROR_ENABLED\s*=/,
  "MR1-25 Settings API cannot mutate global Mirror env",
);

console.log(
  "PASS MR1-01..MR1-25: safe configurable Mirror Route Settings contract",
);
