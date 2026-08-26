# Dashboard v7.8 — Contextual บน/บ + ล่าง/ล Parser

## What changed

v7.8 makes `บน` and `บ` exact synonyms, and `ล่าง` and `ล` exact synonyms, while keeping their meaning contextual by code length.

They are **not** stored as global aliases to A/E/B/G because the same word has different meaning in 1-digit, 2-digit, and 3-digit grammar.

Parser version: `1.5.0`.

## Context rules

```text
บน = บ
ล่าง = ล
```

### 1 digit

The longer `วิ่ง...` phrase has priority:

```text
วิ่งบน 1=500
วิ่ง บ 1=500
=> H1 = 500

วิ่งล่าง 2=300
วิ่ง ล 2=300
=> L2 = 300
```

### 2 digits

```text
05 06=20 บน
05 06=20 บ
=> A05=20, A06=20

05 06=20 ล่าง
05 06=20 ล
=> B05=20, B06=20
```

Prefix form is also accepted:

```text
บน 05 06=20
ล 05 06=20
```

### 3 digits

TOP:

```text
503 504=20 บน
503 504=20 บ
=> E503=20, E504=20
```

BOTTOM:

```text
503 504=20 ล่าง
503 504=20 ล
=> G503=20, G504=20
```

For a TOP quantity pair, first value is E and second value is F:

```text
503 504=20*30 บน
=> E503=20, F503=30
=> E504=20, F504=30
```

This keeps the existing 3-digit `ตรง/โต๊ด` behavior.

## User regression fixed

Input:

```text
05//06//15//16
03//04//13//14
=25 บลก

503//504//513//514
603//604//613//614
=20*30 บน
```

Expected:

```text
A total = 400
B total = 400
E total = 160
F total = 240
Grand total = 1,200
48 order_items
PARSED
```

v7.7 parsed only the first block (800) and silently ignored the 3-digit block. v7.8 parses both blocks.

## No silent partial order

If one block is parsed but another block still looks like an order and is not recognized, the whole message is no longer allowed to finish as `PARSED` silently.

It becomes `PARTIAL` / Review with `UNRECOGNIZED_ORDER_SYNTAX` so the operator can see that part of the message needs attention.

## Migration

No Supabase migration is required for v7.8.

The contextual keywords are resolved in the parser, not stored as fixed category aliases.

## Install from v7.7

```bash
cd ~/Downloads/line-order-netlify-supabase-mvp
git status --short
```

The working tree should be clean.

```bash
unzip -o "$HOME/Downloads/line-order-dashboard-mvp-v7.8-contextual-top-bottom-parser-patch.zip" -d .
```

Run:

```bash
npm test
node --check src/lib/order-parser.mjs
git diff --check
```

Expected final regression line:

```text
PASS: contextual บน/บ + ล่าง/ล across 1/2/3 digits v7.8 smoke tests
```

Then:

```bash
git add .
git diff --cached --check
git status --short
git commit -m "Support contextual top bottom order keywords"
git push
```

After Netlify is Published, hard refresh the dashboard and send a new LINE message for testing.

## Recommended live test

```text
05//06//15//16
03//04//13//14
=25 บลก

503//504//513//514
603//604//613//614
=20*30 บน
```

Expected total: `1,200`.
