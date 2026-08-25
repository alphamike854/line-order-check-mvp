-- v7.0: allow parser aliases for modifiers/generators in addition to stored categories.
-- C = reverse modifier, D = decade generator, DOUBLE = double-number generator.

alter table public.category_aliases
  drop constraint if exists category_aliases_canonical_category_check;

alter table public.category_aliases
  add constraint category_aliases_canonical_category_check
  check (canonical_category in ('A','B','C','D','E','F','G','DOUBLE'));
