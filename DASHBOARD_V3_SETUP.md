# Dashboard v3 — Review Safety Hardening

รอบนี้ทำให้ Review Correction ยืนยันได้เฉพาะผลที่ผู้ใช้ Preview จริงเท่านั้น

## สิ่งที่เพิ่ม

- Preview ที่ parse สำเร็จจะได้รับ signed preview token อายุ 15 นาที
- token ผูกกับ review, message, ข้อความที่แก้แบบ exact text, normalized text, parser version, parsed items, parser aliases/defaults และ Summary Group ปัจจุบัน
- ถ้าแก้ textarea หลัง Preview แม้เพียงตัวเดียว หน้าเว็บจะยกเลิกปุ่มยืนยันทันที
- ตอน Confirm ฝั่ง server parse ซ้ำและคำนวณ fingerprint ใหม่
- ถ้าข้อความ, parser config, Summary Group หรือผล parse เปลี่ยน จะตอบ `PREVIEW_STALE` และบังคับ Preview ใหม่
- token หมดอายุจะตอบ `PREVIEW_EXPIRED`
- Audit `review_resolution_events` เก็บ `preview_fingerprint` และ `previewed_at`

## Environment

ไม่ต้องเพิ่ม Environment Variable ใหม่ หากมี `DASHBOARD_ACCESS_KEY` อยู่แล้ว ระบบใช้ค่านี้ลงนาม token โดยอัตโนมัติ

ถ้าต้องการแยก signing key ในอนาคต สามารถเพิ่ม:

```text
REVIEW_PREVIEW_SIGNING_KEY=<random secret>
```

ถ้าตั้งค่านี้ ระบบจะใช้ค่านี้แทน `DASHBOARD_ACCESS_KEY`

## Migration

Run ใน Supabase SQL Editor:

```text
supabase/migrations/202608240005_add_review_preview_audit.sql
```

## Tests

```bash
npm test
node --check netlify/functions/review-preview.mjs
node --check netlify/functions/review-resolve.mjs
node --check src/lib/review-safety.mjs
node --check src/lib/dashboard-api.mjs
node --check public/app.js
git diff --check
```

Expected:

```text
PASS: Parser + Allocation + OCR helper smoke tests
PASS: Dashboard helper smoke tests
PASS: Review + Settings validation smoke tests
PASS: Review preview safety smoke tests
```

## Manual test

1. ส่งข้อความที่เข้า Review เช่น `125=20x4`
2. ใน Dashboard แก้เป็น `125=20x6`
3. กด `ตรวจผล Parser` และตรวจว่ามี 6 permutations
4. หลัง Preview ให้แก้ textarea เช่นเพิ่มช่องว่าง 1 ตัว
5. ปุ่มยืนยันต้องหาย และแสดงให้ Preview ใหม่
6. Preview ใหม่ แล้วกด `ยืนยันใช้ผลนี้`
7. ตรวจว่า message เป็น PARSED และ `order_items` มี 6 รายการ
8. ตรวจ audit:

```sql
select
  review_id,
  message_record_id,
  action,
  corrected_text,
  preview_fingerprint,
  previewed_at,
  resolved_by,
  resolved_at
from public.review_resolution_events
order by resolved_at desc
limit 10;
```
