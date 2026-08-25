# Dashboard v6.3 — Friendly Already-Open Settlement UX

v6.3 does not change Risk, Point Reserve, Safe Capacity, settlement schema, or database formulas.

It improves the OPEN-settlement workflow:

- The browser refuses a duplicate OPEN request when it already knows a settlement is open.
- The API preflights the current settlement and still keeps the database RPC as the final concurrency guard.
- If another/stale tab races and receives `SETTLEMENT_ALREADY_OPEN`, the UI reloads the active settlement and dashboard automatically.
- The operator sees a Thai message instead of the technical error code.
- The active settlement panel is scrolled into view and briefly highlighted.

No Supabase migration is required for v6.3.

## Test

```bash
npm test
node --check netlify/functions/settlement.mjs
node --check public/app.js
git diff --check
```

The final test line should be:

```text
PASS: Friendly already-open settlement UX v6.3 smoke tests
```
