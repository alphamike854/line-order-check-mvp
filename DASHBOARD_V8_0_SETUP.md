# Dashboard v8.0 — Daily Report First Code + CSV Export

## เปลี่ยนอะไร

- รายงานประจำวันเพิ่มคอลัมน์ `รหัสแรก` ถัดจาก `เวลา`
- ใช้รหัสแรกที่ปรากฏจริงในข้อความ เช่น `01`, `123`; H/L แสดง `H1`, `L2`
- กรณี Parser สร้าง/เรียงรหัสใหม่ เช่น ABC หรือทุกกลับ ระบบย้อนดูตำแหน่งรหัสในข้อความต้นฉบับเพื่อไม่ให้เลือกรหัสที่ถูก sort ขึ้นมาก่อน
- เก็บ `messages.first_order_code` เป็นข้อมูล derived ขนาดเล็ก เพื่อให้รายงานยังมีรหัสอ้างอิงได้หลัง LINE Unsend ล้างข้อความต้นฉบับ
- เพิ่มปุ่ม `Export CSV` ในรายงานประจำวัน
- CSV ใช้ตัวกรองชุดยอด / Summary Group / LINE Group เดียวกับหน้าจอ
- CSV มี UTF-8 BOM สำหรับภาษาไทย และรักษาเลขศูนย์นำหน้า เช่น `01`, `001`

## Migration

Run:

`supabase/migrations/202608260020_add_message_first_order_code.sql`

Migration เพิ่ม `messages.first_order_code` สำหรับข้อความใหม่และข้อความที่แก้ Review ส่วนข้อมูลเก่ารายงานจะหารหัสแรกจากข้อความเดิมโดยอัตโนมัติ และ fallback จาก order item หากข้อความเดิมไม่มีแล้ว

## CSV columns

วันที่, สถานะ, กลุ่มสรุป, LINE Group, ลำดับ, เวลา, รหัสแรก, จำนวน, ลด %, ยอดหลังลด, Point รวม, ยอดสุทธิเทียบ, รายละเอียด Point

แต่ละ LINE message เป็นหนึ่งแถว และมีแถว `รวม` ปิดท้ายแต่ละ LINE Group

## Verify

```bash
npm test
node --check src/lib/report-ledger.mjs
node --check netlify/functions/accounting-report.mjs
node --check netlify/functions/line-webhook.mjs
node --check netlify/functions/review-resolve.mjs
node --check public/app.js
git diff --check
```
