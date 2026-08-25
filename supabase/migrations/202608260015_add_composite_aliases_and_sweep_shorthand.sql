-- v7.1: composite parser aliases + Thai sweep shorthand vocabulary.
-- AB = A+B, ABC = A+B+reverse. D/DOUBLE remain generator targets.

alter table public.category_aliases
  drop constraint if exists category_aliases_canonical_category_check;

alter table public.category_aliases
  add constraint category_aliases_canonical_category_check
  check (canonical_category in ('A','B','AB','C','ABC','D','E','F','G','DOUBLE'));

-- Seed common operational shorthand without overwriting an existing operator choice.
insert into public.category_aliases (alias, canonical_category, enabled)
values
  ('บล', 'AB', true),
  ('ก', 'C', true),
  ('บลก', 'ABC', true),
  ('รูด', 'D', true),
  ('รูดเบิ้ล', 'DOUBLE', true)
on conflict (alias) do nothing;
