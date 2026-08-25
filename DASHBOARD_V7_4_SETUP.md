# Dashboard v7.4 — One-click Close + Point Later

## เปลี่ยนอะไร

- ปิดยอดได้ด้วยการยืนยันครั้งเดียว โดยไม่ต้องระบุรหัส Point ให้ครบก่อน
- ยังคงไม่ให้ปิดเมื่อมีรายการ Review ที่ยังไม่จบ เพื่อไม่ให้ข้อมูลที่ยังตีความไม่ได้ถูก freeze ลงรายงาน
- หลังปิดยอด รายงานจะแสดง `รอ Point` และยังไม่แสดงยอดสุทธิเทียบเป็นตัวเลขจนกว่าจะระบุ Point
- กด `ระบุ Point` จากรายงานของยอดที่ปิดแล้วได้โดยตรง
- Point ที่บันทึกภายหลังใช้ Reduction, Promotion และตัวคูณของ settlement นั้น ไม่ใช้ค่าของรอบใหม่
- รหัส Point ของยอดที่ปิดแล้วแก้ไขได้หากต้องแก้ผลจริงภายหลัง

## Migration

Run เฉพาะไฟล์ใหม่:

`supabase/migrations/202608260017_allow_close_before_actual_points.sql`

Migration นี้แก้ RPC `close_settlement_session` และ `replace_settlement_actual_special_codes` เท่านั้น ไม่แก้ Parser/Risk/Transfer logic

## ตรวจหลัง Deploy

1. เปิดยอดโดยยังไม่ใส่ Point
2. กด `ปิดยอด` → ยืนยัน
3. ต้องปิดได้ และรายงานขึ้น `รอ Point`
4. ในรายงานกด `ระบุ Point`
5. บันทึกรหัส Point
6. กลับรายงาน → Point และยอดสุทธิเทียบต้องคำนวณจากยอดของชุดที่ปิดนั้น
7. เปิดยอดใหม่แล้วแก้ตัวคูณ/Promotion ไม่ควรเปลี่ยนรายงานเก่า
