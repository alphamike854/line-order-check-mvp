# Dashboard v7.9 — Code Column Inner Gutters

UI-only patch ต่อจาก v7.8

## เปลี่ยนอะไร
- เพิ่มระยะซ้าย/ขวาของรหัสในคอลัมน์ A/B/E/F เป็น 16px บน desktop
- Header ของแต่ละหมวดใช้ gutter เดียวกัน เพื่อให้แนวตั้งตรงกัน
- G และ H/L เพิ่ม inner padding ให้สอดคล้องกัน
- หน้าตัดยอดและหลังตัดยอดใช้ระยะเดียวกับหน้าสรุป
- Mobile ลดเหลือ 14px เพื่อรักษาพื้นที่อ่าน
- ไม่เปลี่ยน parser, risk, point, settlement หรือฐานข้อมูล

## ติดตั้ง
```bash
cd ~/Downloads/line-order-netlify-supabase-mvp
git status --short
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v7.9-code-column-gutters-patch.zip" -d .
npm test
git diff --check
git add .
git diff --cached --check
git commit -m "Add comfortable code column gutters"
git push
```

ไม่มี Supabase migration
