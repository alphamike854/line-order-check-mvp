# Dashboard v7.5 — Multiline 3-Digit + Counted Permutation

## แก้ปัญหา

รองรับข้อความที่เลข 3 หลักอยู่คนละบรรทัดกับจำนวน เช่น

```text
397 349 796 106 072
=50*6 ก
```

`ก` ในบริบทเลข 3 หลักหมายถึงกลับทุกตำแหน่ง และ `*6` ระบุว่ารหัสต้นทางแต่ละตัวต้องมี unique permutations 6 แบบ

ผลตัวอย่างข้างต้น: 5 รหัส × 6 แบบ × 50 = 1,500

รองรับ pending เลข 3 หลายบรรทัดด้วย เช่น

```text
396
394
364
964-10*10
```

เท่ากับ E/F ของทั้ง 4 รหัส รหัสละ 10

และรองรับรูปแบบเร็วของเลข 2 หลัก:

```text
39/36//94/64/34 บลก 10
96 บลก 20
```

ข้อความที่มีโครงสร้างคล้ายออเดอร์แต่ Parser ยังไม่รู้จัก จะถูกส่งเข้า Review แทนการ IGNORE เงียบ ๆ

## ติดตั้งจาก v7.4

```bash
cd ~/Downloads/line-order-netlify-supabase-mvp
git status --short
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v7.5-multiline-three-digit-parser-patch.zip" -d .
```

ไม่มี Supabase migration ใหม่

```bash
npm test
node --check src/lib/order-parser.mjs
git diff --check
```

จากนั้น stage/commit/push ตามปกติ
