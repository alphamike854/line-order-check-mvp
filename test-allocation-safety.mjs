import assert from "node:assert/strict";
import {
  createAllocationConfirmationToken,
  verifyAllocationConfirmationToken,
} from "./src/lib/allocation-safety.mjs";

const key = "test-allocation-confirm-signing-key";
const nowMs = Date.parse("2026-08-24T15:00:00.000Z");
const allocation = {
  settlement_session_id: "22222222-2222-4222-8222-222222222222",
  business_date: "2026-08-24",
  summary_group_id: "NORTH",
  category: "A",
  code: "01",
  order_total: 310,
  threshold: 100,
  destination: "CUT-A",
  should_transfer: 200,
  confirmed_transfer: 100,
  transfer_now: 100,
};

const signed = createAllocationConfirmationToken({
  allocation,
  requestId: "11111111-1111-4111-8111-111111111111",
  nowMs,
  ttlSeconds: 600,
  key,
});

const verified = verifyAllocationConfirmationToken({ token: signed.token, nowMs: nowMs + 60_000, key });
assert.equal(verified.ok, true);
assert.equal(verified.request_id, "11111111-1111-4111-8111-111111111111");
assert.deepEqual(verified.snapshot, allocation);

assert.equal(
  verifyAllocationConfirmationToken({ token: signed.token, nowMs: nowMs + 601_000, key }).error,
  "CONFIRMATION_EXPIRED",
);

const tampered = signed.token.slice(0, -1) + (signed.token.endsWith("a") ? "b" : "a");
assert.equal(
  verifyAllocationConfirmationToken({ token: tampered, nowMs: nowMs + 60_000, key }).error,
  "CONFIRMATION_TOKEN_INVALID",
);

assert.equal(
  verifyAllocationConfirmationToken({ token: "", nowMs, key }).error,
  "CONFIRMATION_REQUIRED",
);

assert.throws(
  () => createAllocationConfirmationToken({ allocation: { ...allocation, transfer_now: 200 }, nowMs, key }),
  /INVALID_ALLOCATION_SNAPSHOT/,
);

const other = createAllocationConfirmationToken({ allocation, nowMs, key });
assert.notEqual(other.request_id, signed.request_id);

console.log("PASS: Allocation confirmation safety smoke tests");
