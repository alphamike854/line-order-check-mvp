# Dashboard MVP v2 — Review Correction + Settings

แพตช์นี้เป็น cumulative patch สำหรับ repository หลัง commit `Add LINE image OCR pipeline` (`90a5804` ในชุดทดสอบของโครงการ)
จึงรวม Dashboard v1 + Review Correction + Settings ไว้ในชุดเดียว ไม่ต้องลง dashboard patch รุ่นก่อนแยกอีกครั้ง

## สิ่งที่เพิ่ม

- Dashboard หน้าเว็บที่ `/`
- สรุปยอด / Allocation / Confirm Transfer / Review / Unsend
- Review Correction workflow:
  - แก้หรือกรอกข้อความ
  - Preview Parser โดยยังไม่แก้ยอด
  - Apply ได้เฉพาะเมื่อ Server parse ซ้ำแล้วเป็น `PARSED`
  - PARTIAL items เดิมของ message จะถูก replace แบบ transaction
  - ปุ่ม `ไม่ใช่ออเดอร์ / ข้าม`
  - Audit ใน `review_resolution_events`
- Settings UI:
  - Summary Groups
  - LINE Group → Summary Group
  - Allocation Rules
  - Category Aliases
  - แสดง LINE Group ID ที่ webhook เคยเห็นแต่ยังไม่ได้ตั้งค่า
  - Audit ใน `settings_change_events`

## 1. แตก patch

จาก repository:

```bash
cd ~/Downloads/line-order-netlify-supabase-mvp
git status --short
unzip -o ~/Downloads/line-order-dashboard-mvp-v2-cumulative-patch.zip -d .
```

## 2. Run Supabase migrations

Run ตามลำดับใน SQL Editor:

1. `supabase/migrations/202608240003_add_dashboard_foundation.sql`
2. `supabase/migrations/202608240004_add_review_resolution_and_settings.sql`

ไฟล์ 003 ใช้ `create if not exists` / `create or replace` จึงสามารถรันซ้ำได้ถ้าเคยลง Dashboard v1 แล้ว

## 3. Netlify environment variables

ถ้ายังไม่มี ให้เพิ่ม:

```text
DASHBOARD_ACCESS_KEY=<random secret>
DASHBOARD_OPERATOR_NAME=ADMIN
```

สร้าง key ได้ด้วย:

```bash
openssl rand -hex 24
```

ไม่ต้องส่ง key นี้ในแชทหรือ commit เข้า Git

## 4. Test

```bash
npm test
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/confirm-transfer.mjs
node --check netlify/functions/reviews.mjs
node --check netlify/functions/unsends.mjs
node --check netlify/functions/review-preview.mjs
node --check netlify/functions/review-resolve.mjs
node --check netlify/functions/settings.mjs
node --check src/lib/dashboard-api.mjs
node --check src/lib/dashboard-utils.mjs
node --check src/lib/settings-validation.mjs
node --check public/app.js
git diff --check
git status --short
```

Expected tests:

```text
PASS: Parser + Allocation + OCR helper smoke tests
PASS: Dashboard helper smoke tests
PASS: Review + Settings validation smoke tests
```

## 5. Commit / deploy

```bash
git add .env.example netlify.toml package.json public src/lib/dashboard-api.mjs src/lib/dashboard-utils.mjs src/lib/settings-validation.mjs \
  netlify/functions/dashboard.mjs netlify/functions/confirm-transfer.mjs netlify/functions/reviews.mjs netlify/functions/unsends.mjs \
  netlify/functions/review-preview.mjs netlify/functions/review-resolve.mjs netlify/functions/settings.mjs \
  supabase/migrations/202608240003_add_dashboard_foundation.sql \
  supabase/migrations/202608240004_add_review_resolution_and_settings.sql \
  test-dashboard.mjs test-review-settings.mjs DASHBOARD_SETUP.md DASHBOARD_V2_SETUP.md

git commit -m "Add review workflow and dashboard settings"
git push
```

รอ Netlify deploy เป็น `Published` แล้วเปิด URL หลักของ site

## Review test ที่แนะนำ

ใช้ Review เดิม `123=20x4`:

1. เปิด tab Review
2. แก้เป็น `123=20x6`
3. กด `ตรวจผล Parser`
4. ต้องเห็น 6 items และสถานะ `PARSED`
5. กด `ยืนยันใช้ผลนี้`
6. Review ต้องหายจาก OPEN queue
7. `order_items` ต้องมี permutations 6 รายการจาก message เดิม
8. `review_resolution_events` ต้องมี action `CORRECTED`

สำหรับ IMAGE ที่ Gemini ยังติด billing สามารถใช้ manual fallback ได้:
- รูปจะเข้า Review
- เปิด LINE ดูรูปจริง
- กรอกข้อความที่อ่านได้ใน textarea
- Preview → Apply
- ไม่ต้องรอ OCR provider จึงทดสอบระบบส่วนอื่นต่อได้

## Settings test ที่แนะนำ

- เปิด tab ตั้งค่า
- ตรวจว่ามี `NORTH` / `SOUTH`
- แก้ชื่อกลุ่ม LINE ผ่าน UI แล้วบันทึก
- เพิ่ม/แก้ `NORTH / A / threshold 100`
- เพิ่ม alias เช่น `น → A`
- ตรวจ `settings_change_events` ว่ามี audit row

## Safety behavior

- Preview Review ไม่แก้ฐานข้อมูล
- Apply Review parse ซ้ำที่ Server; browser ไม่สามารถส่ง canonical items มาบังคับได้
- Apply Review ใช้ PostgreSQL RPC เพื่อ replace PARTIAL items + close review ใน transaction เดียว
- Settings เขียนผ่าน protected Netlify Function เท่านั้น
- `SUPABASE_SECRET_KEY` ไม่ถูกส่งให้ browser
