import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("netlify/functions/settlement.mjs", "utf8");
const ui = readFileSync("public/app.js", "utf8");
const readback = readFileSync("netlify/functions/round-open-status.mjs", "utf8");
const bg = readFileSync("netlify/functions/settlement-storage-cleanup-background.mjs", "utf8");

assert.match(api, /if \(acceptingOrders\) \{\s*let cleanupEnqueued = false;/);
assert.match(api, /storage_cleanup: data\?\.reset_from_round_id/);
assert.match(api, /return json\(\{\s*ok: true,\s*group_state: data,/);
assert.match(api, /async function changeSummaryGroupState\(\s*body,\s*acceptingOrders,\s*req,/);
assert.match(ui, /api\/round-open-status\?summary_group_id=/);
assert.match(ui, /verified\.round_status === "OPEN"/);
assert.match(ui, /verified\.settlement_session_id === open\.id/);
assert.match(ui, /ห้ามกดซ้ำก่อนตรวจสถานะ/);
assert.match(readback, /req\.method !== "GET"/);
assert.doesNotMatch(readback, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
assert.match(bg, /settlement_round_storage_cleanup_queue/);
assert.match(bg, /\.eq\("round_id", retiringRound\)/);
assert.match(bg, /\.eq\("summary_group_id", group\)/);
assert.match(bg, /req\.method !== "POST"/);
assert.match(bg, /requireDashboardAccess\(req\)/);
assert.doesNotMatch(bg, /set_settlement_summary_group_accepting|\.rpc\(/);

// Test the new readback GET handler in isolation with a service-layer fake.
const original = `import {\n  json,\n  requireDashboardAccess,\n  supabase,\n} from "../../src/lib/dashboard-api.mjs";`;
assert(readback.includes(original));
const statusSource = readback.replace(original,
  "const { json, requireDashboardAccess, supabase } = globalThis.__test;"
);
const cursor = { latest_round_id: "round-1" };
const dbRound = {
  id: "round-1", settlement_session_id: "session-1", status: "OPEN",
  business_date: "2026-10-13", daily_round_no: 1,
  opened_at: "2026-10-13T09:00:00Z",
};
globalThis.__test = {
  json: (body, status=200) => ({ body, status }),
  requireDashboardAccess: () => null,
  supabase: { from: table => ({
    select: () => ({
      eq: (key, value) => ({
        maybeSingle: async () => ({
          data: table === "summary_group_round_runtime_state" ? cursor : dbRound,
          error: null,
        }),
      }),
    }),
  }) },
};
const mod = await import(`data:text/javascript,${encodeURIComponent(statusSource)}`);
const result = await mod.default({method:"GET", url:"https://example.net/api/round-open-status?summary_group_id=NORTH"});
assert.equal(result.status,200);
assert.equal(result.body.round_status,"OPEN");
assert.equal(result.body.settlement_session_id,"session-1");
const denied = await mod.default({method:"GET", url:"https://example.net/api/round-open-status?summary_group_id=NORTH%20OR%201%3D1"});
assert.equal(denied.status,400);
const badMethod = await mod.default({method:"POST", url:"https://example.net/api/round-open-status?summary_group_id=NORTH"});
assert.equal(badMethod.status,405);
// Background cleanup: only retired-round pending job paths may be deleted.
const cleanupOriginal = `import {
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";`;
assert(bg.includes(cleanupOriginal));
let requestedPaths = [];
let deletedIds = [];
let scans = 0;
const fakeCleanupDb = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: ++scans === 1 ? [{ id: 4, storage_bucket: "review-images", storage_path: "old/file-4.png" }] : [], error: null }),
            }),
          }),
        }),
      }),
    }),
    delete: () => ({ in: async (column, ids) => { deletedIds.push(...ids); return {error: null}; } }),
  }),
  storage: { from: (bucket) => ({ remove: async paths => {
    requestedPaths.push(...paths); return {error:null};
  } }) },
};
globalThis.__test = { requireDashboardAccess: () => null, supabase: fakeCleanupDb };
const bgSource = bg.replace(cleanupOriginal,
  "const { requireDashboardAccess, supabase } = globalThis.__test;"
);
const bgMod = await import(`data:text/javascript,${encodeURIComponent(bgSource)}`);
await bgMod.default({method:"POST", url:"https://example.net/api/settlement-storage-cleanup-background", json:async()=>({summary_group_id:"NORTH",retiring_round_id:"00000000-0000-4000-8000-000000000001"})});
assert.deepEqual(requestedPaths,["old/file-4.png"]);
assert.deepEqual(deletedIds,[4]);
console.log("PASS: targeted OPEN 504 status reconciliation + readback + cleanup scope");
console.log("DB_ACCESS=NO; NETWORK=NO; LINE_SEND=NO");
