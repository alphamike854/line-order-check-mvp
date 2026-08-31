-- R3A: private temporary image evidence for human Review.

alter table public.messages
  add column if not exists image_storage_path text,
  add column if not exists image_stored_at timestamptz,
  add column if not exists image_deleted_at timestamptz;

comment on column public.messages.image_storage_path is
  'Private Supabase Storage object path for temporary image Review evidence.';

comment on column public.messages.image_stored_at is
  'Timestamp when the original LINE image was stored as temporary Review evidence.';

comment on column public.messages.image_deleted_at is
  'Timestamp when temporary image Review evidence was deleted by retention or unsend cleanup.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'review-images',
  'review-images',
  false,
  15728640
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Intentionally no anon/authenticated Storage policies.
-- Access will be only through server-side functions using the
-- Supabase secret/service credential and short-lived signed URLs.
