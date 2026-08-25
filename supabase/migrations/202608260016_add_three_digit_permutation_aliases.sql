-- v7.2: aliases for 3-digit "ทุกกลับ / ประตู" permutation command.
-- PERMUTE_ALL is a parser command target, not a stored order category.

alter table public.category_aliases
  drop constraint if exists category_aliases_canonical_category_check;

alter table public.category_aliases
  add constraint category_aliases_canonical_category_check
  check (canonical_category in ('A','B','AB','C','ABC','D','E','F','G','DOUBLE','PERMUTE_ALL'));

insert into public.category_aliases (alias, canonical_category, enabled)
values
  ('ทุกกลับ', 'PERMUTE_ALL', true),
  ('3ปต', 'PERMUTE_ALL', true),
  ('3 ปต', 'PERMUTE_ALL', true),
  ('3ประตู', 'PERMUTE_ALL', true),
  ('3 ประตู', 'PERMUTE_ALL', true),
  ('6ปต', 'PERMUTE_ALL', true),
  ('6 ปต', 'PERMUTE_ALL', true),
  ('6ประตู', 'PERMUTE_ALL', true),
  ('6 ประตู', 'PERMUTE_ALL', true)
on conflict (alias) do nothing;
