# Dashboard v7.0 — Parser Alias Expansion

## What changed

- Alias settings now support A, B, C, D, E, F, G and DOUBLE.
- C = reverse-code modifier.
- D = decade generator, e.g. D5 => 50–59.
- G = canonical 3-digit G category.
- DOUBLE = 2-digit doubles 00,11,…99. The built-in compact syntax `G=20 AB` still works.
- Fixed multi-code 3-digit quantity pairs such as `920,202,707,101=500x500` so all E/F rows are created.
- Parser version is now 1.1.0.

## Database

Run only the new migration after v6.9:

`supabase/migrations/202608250014_expand_parser_alias_targets.sql`

## Regression example

Input:

```text
30,03,26,62,29,92=1000x1000
920,202,707,101=500x500
15,51,66,99,20,02=1000x1000
```

Expected total: `28,000`.

The middle line creates E920/E202/E707/E101 = 500 and F920/F202/F707/F101 = 500, total 4,000.

## Alias examples

- `กลับ -> C`: `ABกลับ 15 24=20`
- `สิบ -> D`: `สิบ5 AB=20`
- `สามล่าง -> G`: `สามล่าง 001,002=20`
- `เบิ้ล -> DOUBLE`: `เบิ้ล=20 AB`

Numeric-only aliases are rejected to avoid collisions with order codes.
