# Dashboard v6.9 — Aligned Three-Board Layout

## เป้าหมาย
- สรุปยอด / ตัดยอด / หลังตัดยอด ใช้ A | B | E | F เหมือนกัน และ G ด้านล่าง
- หลังตัดยอดแสดง รับ / ตัด / คง และรายละเอียดแต่ละรอบต่อรหัส
- ลดช่องว่างระหว่างรหัสกับจำนวน และเพิ่ม padding ภายในตัวเลข
- ขยายพื้นที่ desktop เล็กน้อยเพื่อใช้จอให้คุ้มขึ้น

## ฐานข้อมูล
ไม่มี migration ใหม่

## ติดตั้ง
```bash
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v6.9-aligned-three-board-layout-patch.zip" -d .
npm test
node --check public/app.js
node --check netlify/functions/allocation-history.mjs
git diff --check
```

## หลัง Deploy
Hard refresh แล้วตรวจ 3 แท็บตามลำดับ: สรุปยอด → ตัดยอด → หลังตัดยอด
