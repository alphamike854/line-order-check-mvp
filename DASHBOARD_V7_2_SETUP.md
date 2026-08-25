# Dashboard / Parser v7.2 — ทุกกลับ / ประตู

v7.2 extends the deterministic 3-digit parser. It does not change dashboard risk, Point, settlement, or warehouse-distribution formulas.

## New 3-digit permutation command

These inputs are equivalent commands:

- `ทุกกลับ`
- `3ปต`, `3 ปต`
- `3ประตู`, `3 ประตู`
- `6ปต`, `6 ปต`
- `6ประตู`, `6 ประตู`
- `*` when used as a 3-digit permutation marker

The parser derives the number of **unique permutations from the digits** rather than trusting 3/6 in the wording:

- `093` => 6: `093 039 903 930 309 390`
- `998` => 3: `998 989 899`
- `111` => 1: `111`

Examples:

```text
093 998 = 100 * ทุกกลับ
```

=> 9 unique E codes x 100 = 900.

```text
998=100 3ปต
```

=> E998/E989/E899, 100 each = 300.

Existing compact count syntax remains supported:

```text
123=20x6
122=20x3
```

and continues to validate the stated permutation count.

## Composite shorthand

```text
998=100x100x*100
```

is interpreted as:

1. original E998 = 100
2. original F998 = 100
3. all unique straight permutations in E = 100 each

Therefore the stored aggregate becomes:

- E998 = 200 (100 original + 100 from the permutation set)
- E989 = 100
- E899 = 100
- F998 = 100
- total = 500

The existing multi-code E/F pair remains unchanged:

```text
920,202,707,101=500x500
```

=> E/F for all 4 codes, total 4,000.

## Alias Settings

A new target is available:

`PERMUTE — สลับเลข 3 หลัก`

Migration 016 seeds the common phrases listed above with `ON CONFLICT DO NOTHING`.

## Install from v7.1

1. Ensure repository status is clean.
2. Unzip the v7.2 patch over the repository.
3. Run migration:

`supabase/migrations/202608260016_add_three_digit_permutation_aliases.sql`

4. Run:

```bash
npm test
node --check src/lib/order-parser.mjs
node --check src/lib/settings-validation.mjs
node --check netlify/functions/line-webhook.mjs
node --check netlify/functions/settings.mjs
node --check public/app.js
git diff --check
```

5. Stage, commit and push.
