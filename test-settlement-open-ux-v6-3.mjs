import fs from "node:fs";

const settlement = fs.readFileSync("netlify/functions/settlement.mjs", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(settlement.includes('user_message: "มียอดที่กำลังเปิดใช้งานอยู่ กรุณาปิดยอดปัจจุบันก่อนเปิดยอดใหม่"'), "API must return a friendly already-open message");
assert(settlement.includes("current_open_session"), "API must return the current open session on conflict");
assert(settlement.includes("const beforeOpen = await getPayload()"), "OPEN should recover stale browser state before RPC");
assert(app.includes("async function recoverAlreadyOpenSettlement"), "frontend must recover from SETTLEMENT_ALREADY_OPEN");
assert(app.includes('if (state.settlement?.open_session)'), "frontend must prevent duplicate OPEN when state is current");
assert(app.includes('if(error.message==="SETTLEMENT_ALREADY_OPEN")await recoverAlreadyOpenSettlement(error)'), "frontend must translate stale-tab conflict");
assert(app.includes("focusCurrentSettlement"), "frontend must focus the active settlement");
assert(styles.includes(".settlement-attention"), "active settlement should be visually highlighted after recovery");

console.log("PASS: Friendly already-open settlement UX v6.3 smoke tests");
