# Dashboard v6.4 — Simplified Allocation UX

v6.4 simplifies the operator-facing cut/transfer workflow without changing the v6 Risk Engine, Safe Capacity formulas, database schema, or confirmation safety.

## What changes

The Allocation tab is reduced to three operator steps:

1. **ดูยอดที่ตัดได้** — the primary number is `ตัดเพิ่มได้อีก`.
2. **เลือกรหัส + จำนวน** — A/B are shown first because they are the main order volume; E/F/G are under a secondary expandable section.
3. **ตรวจสอบ + ยืนยัน** — choose destination, preview the compact transfer lines, see the remaining capacity after this batch, then confirm once.

Technical values such as Adjusted Received, Point Reserve/Actual Point, Risk %, Net Safe Capacity, and Confirmed Cut remain available under **ดูที่มาของยอดที่ตัดได้**, but they are not required for normal operation.

The server-side safety remains unchanged:

- preview uses `/api/risk-transfer-preview`
- confirmation uses `/api/risk-transfer-confirm`
- stale snapshots are rejected
- cut total cannot exceed Remaining Safe Capacity
- per-code quantity cannot exceed available quantity

## Database

No Supabase migration is required for v6.4.

## Test

```bash
npm test
node --check public/app.js
git diff --check
```

The final test should include:

```text
PASS: Simplified three-step allocation UX v6.4 smoke tests
```
