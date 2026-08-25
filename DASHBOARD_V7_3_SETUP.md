# Parser v7.3 — Correct repeated-quantity permutation grammar

v7.3 corrects one business grammar from v7.2. It does not change Point, Risk, settlements, aliases, or warehouse distribution.

## Correct rule

These inputs are equivalent for code `998`:

```text
998=100x100x100
998=100 ทุกกลับ
998=100 3ปต
998=100 3ประตู
```

`998` has three unique permutations: `998 989 899`.
The parser stores E998/E989/E899 at 100 each, total `300`.

For a six-way code:

```text
093=100x100x100x100x100x100
```

is equivalent to `093=100 ทุกกลับ` / `093=100 6ปต`, total `600`.

## Existing two-value E/F pair stays unchanged

```text
998=100x100
```

=> `E998=100`, `F998=100`.

```text
920,202,707,101=500x500
```

=> E/F for all four codes, total `4,000`.

Compact count syntax also remains valid:

```text
998=100x3
093=100x6
```

## Incorrect v7.2 form retired

```text
998=100x100x*100
```

was based on incorrect source information. v7.3 sends this line to REVIEW instead of guessing.

## Validation

For a repeated chain of 3–6 quantities, every quantity must be the same and the count must equal the actual number of unique permutations. Otherwise the line goes to REVIEW.

There is **no new Supabase migration** in v7.3. Migration 016 from v7.2 remains valid.
