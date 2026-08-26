-- v7.6: natural 3-digit chat vocabulary observed in production.
-- โต๊ด is a direct F-category alias.
-- 6กลับ / หกกลับ are 3-digit permutation commands.

insert into public.category_aliases (alias, canonical_category, enabled)
values
  ('โต๊ด', 'F', true),
  ('6กลับ', 'PERMUTE_ALL', true),
  ('6 กลับ', 'PERMUTE_ALL', true),
  ('หกกลับ', 'PERMUTE_ALL', true),
  ('หก กลับ', 'PERMUTE_ALL', true)
on conflict (alias) do nothing;
