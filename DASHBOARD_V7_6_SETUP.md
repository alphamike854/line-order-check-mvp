# Dashboard v7.6 — 3-Digit Chat Grammar

## What changed

Parser v1.3.2 adds production chat forms:

- `231.120.230=120*6ก` — dot-separated 3-digit seeds, each expanded to its 6 unique permutations at 120 each.
- `639 100 โต๊ด` — `โต๊ด` maps to category F, so `F639=100`.
- `731 100 โต๊ด` — `F731=100`.
- `812 หกกลับ 20` and `812 6กลับ 20` — same as 6-way permutation at 20 per code.
- `6 กลับ` and `หก กลับ` are also accepted.

Existing `500x500 => E/F` grammar remains unchanged.

## Migration

Run:

`supabase/migrations/202608260018_add_three_digit_chat_aliases.sql`

This seeds `โต๊ด -> F` and `6กลับ/หกกลับ -> PERMUTE_ALL` aliases without overwriting existing aliases.

## Verify

```bash
npm test
node --check src/lib/order-parser.mjs
git diff --check
```

Expected new regression line:

`PASS: dot-list + โต๊ด + หกกลับ 3-digit grammar v7.6 smoke tests`
