# Dashboard v6.8 — Quiet Refresh + Concise UI

v6.8 ปรับเฉพาะพฤติกรรมการรีเฟรชและข้อความบนหน้าจอ ไม่เปลี่ยนสูตร Point, Risk, การตัดยอด หรือฐานข้อมูล

## การเปลี่ยนแปลง

- Auto refresh จาก 5 วินาทีเป็น 20 วินาที
- Auto refresh ทำงานแบบเงียบ: ไม่เปลี่ยนข้อความบนปุ่ม และไม่แสดง toast เมื่อโหลดพื้นหลังไม่สำเร็จชั่วคราว
- เมื่อแท็บ browser ไม่ได้ใช้งาน จะไม่ poll จนกลับมาเปิดแท็บอีกครั้ง
- หลัง action สำคัญยัง refresh ทันทีตามเดิม
- Toast ใช้เฉพาะผลการทำรายการ/ข้อผิดพลาดที่ผู้ใช้ต้องรับรู้
- ลดข้อความเชิงเทคนิคบน Summary, Allocation, Point, Report และ Settings
- รายละเอียด Risk ถูกซ่อนไว้หลัง “ดูรายละเอียด”
- ปุ่มและข้อความงานใช้คำสั้น เช่น “ควรตัด”, “Point สำรอง”, “ระดับที่รับได้”, “ตัดยอดที่เลือก”

## ติดตั้ง

ไม่มี Supabase migration ในรุ่นนี้

```bash
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v6.8-quiet-refresh-concise-ui-patch.zip" -d .
npm test
node --check public/app.js
git diff --check
```

ผล test ต้องมี:

```text
PASS: Quiet 20s refresh + concise UI copy v6.8 smoke tests
```
