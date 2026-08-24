# Dashboard v4 — Allocation Operational Hardening

รอบนี้เพิ่มความปลอดภัยของการยืนยันตัดยอดสำหรับการใช้งานจริงระหว่างวัน โดยไม่เปลี่ยนสูตร Allocation เดิม

## สิ่งที่เพิ่ม

1. **Signed confirmation token**
   - ปุ่มยืนยันตัดยอดใช้ token ที่ Server ออกให้จาก snapshot ที่ผู้ใช้เห็น
   - token ผูกกับ วันที่ / Summary Group / Category / Code / Order Total / Threshold / Destination / Should Transfer / Confirmed / Transfer Now
   - อายุ token 10 นาที

2. **Atomic stale check ที่ Database**
   - RPC ใหม่ `confirm_allocation_transfer_safe(...)`
   - ก่อนยืนยัน ระบบตรวจ state ล่าสุดกับ snapshot ที่ผู้ใช้เห็น
   - ถ้ามี order ใหม่, กฎเปลี่ยน, destination เปลี่ยน หรือมีอีก tab ยืนยันไปแล้ว จะตอบ `ALLOCATION_STALE`
   - ระบบไม่ขยายจำนวนที่ยืนยันให้เองจากยอดใหม่ที่ผู้ใช้ยังไม่ได้เห็น

3. **Multi-tab serialization**
   - ใช้ PostgreSQL transaction advisory lock ต่อ business-date/group/category/code
   - สอง tab ที่กดยืนยัน snapshot เดียวกันพร้อมกัน จะมีเพียงคำขอแรกที่เปลี่ยนยอด
   - คำขอที่สองจะเห็น state ใหม่และถูกปฏิเสธเป็น stale

4. **Idempotent retry**
   - ทุก token มี `request_id` UUID
   - `allocation_confirmation_events.request_id` unique
   - ถ้า request เดิมสำเร็จแต่ response หาย แล้ว retry token เดิม ระบบคืนผลเดิมและไม่บันทึก/เพิ่มยอดซ้ำ

5. **Freshness warning**
   - Dashboard ตรวจการเปลี่ยนแปลงทุก 15 วินาที
   - ถ้ามี LINE event ใหม่, allocation confirmation จากอีก tab, review resolution หรือ settings change ใหม่ จะแสดง banner ให้ Refresh
   - ปุ่มยืนยันตัดยอดถูก disable จนกว่าจะโหลด snapshot ใหม่
   - Server-side stale check ยังทำงานเสมอ แม้ผู้ใช้กดก่อน polling รอบถัดไป

6. **Allocation history**
   - หน้า “ตัดยอด” แสดงประวัติยืนยันย้อนหลัง
   - เวลา / กลุ่ม / รหัส / delta / ก่อน→หลัง / ยอดตอนยืนยัน / destination / operator

## Migration

Run ใน Supabase SQL Editor:

```text
supabase/migrations/202608240006_harden_allocation_confirmation.sql
```

Migration เพิ่ม nullable snapshot columns ให้ audit เดิมไม่เสียหาย และสร้าง RPC ใหม่ โดย RPC เดิมยังคงอยู่เพื่อไม่ rewrite history แต่ Dashboard v4 จะไม่เรียก RPC เดิมอีก

## Environment variables

ไม่มีตัวแปรใหม่ที่จำเป็น ระบบใช้ `DASHBOARD_ACCESS_KEY` เป็น signing key ด้วย

สามารถแยก signing key ภายหลังได้โดยเพิ่มตัวเลือก:

```text
ALLOCATION_CONFIRM_SIGNING_KEY
```

ถ้าไม่ตั้ง ระบบใช้ `DASHBOARD_ACCESS_KEY` อัตโนมัติ

## Tests

```bash
npm test

node --check netlify/functions/dashboard.mjs
node --check netlify/functions/confirm-transfer.mjs
node --check netlify/functions/allocation-history.mjs
node --check netlify/functions/dashboard-freshness.mjs
node --check src/lib/dashboard-api.mjs
node --check src/lib/allocation-safety.mjs
node --check public/app.js

git diff --check
```

Expected:

```text
PASS: Parser + Allocation + OCR helper smoke tests
PASS: Dashboard helper smoke tests
PASS: Review + Settings validation smoke tests
PASS: Review preview safety smoke tests
PASS: Allocation confirmation safety smoke tests
```

## Manual test A — History

เปิดหน้า `ตัดยอด` และยืนยันรายการที่มี `ตัดเพิ่ม > 0` หนึ่งครั้ง

หลังสำเร็จ ประวัติควรมีรายการใหม่ และ SQL นี้ควรมี `request_id`:

```sql
select
  request_id,
  business_date,
  summary_group_id,
  category,
  code,
  previous_confirmed,
  new_confirmed,
  delta_confirmed,
  order_total,
  threshold,
  destination,
  should_transfer,
  confirmed_by,
  confirmed_at
from public.allocation_confirmation_events
order by confirmed_at desc
limit 10;
```

## Manual test B — Two tabs

1. เปิด Dashboard สอง tab ให้ทั้งสองเห็น row เดียวกันที่ `ตัดเพิ่ม > 0`
2. Tab A ยืนยันก่อน
3. ที่ Tab B กดยืนยัน snapshot เก่า (ถ้ายังไม่ถึง polling 15 วินาที)

Expected:

- Tab A สำเร็จ
- Tab B ไม่เพิ่ม confirmation ซ้ำ และแจ้งให้ Refresh (`ALLOCATION_STALE`)
- มี event ใหม่เพียง 1 รายการสำหรับการตัดครั้งนั้น

ถ้ารอเกิน ~15 วินาที Tab B ควรเห็น banner “มีข้อมูลใหม่...” และปุ่มยืนยันถูก disable ก่อนกดอยู่แล้ว

## Manual test C — New order while page is open

1. เปิด Dashboard ทิ้งไว้
2. ส่ง order ใหม่ใน LINE group ที่อยู่ใน scope เดียวกัน
3. ภายในประมาณ 15 วินาที Dashboard ควรขึ้น banner ว่ามีข้อมูลใหม่
4. ปุ่มยืนยันตัดยอดต้องถูก disable
5. กด `อัปเดตข้อมูล` แล้ว banner หาย และปุ่มใหม่ใช้ snapshot ล่าสุด

## Commit

```bash
git add \
  package.json \
  public/app.js \
  public/index.html \
  public/styles.css \
  netlify/functions/dashboard.mjs \
  netlify/functions/confirm-transfer.mjs \
  netlify/functions/allocation-history.mjs \
  netlify/functions/dashboard-freshness.mjs \
  src/lib/dashboard-api.mjs \
  src/lib/allocation-safety.mjs \
  supabase/migrations/202608240006_harden_allocation_confirmation.sql \
  test-allocation-safety.mjs \
  DASHBOARD_V4_SETUP.md

git diff --cached --check
git commit -m "Harden allocation confirmation workflow"
git push
```
