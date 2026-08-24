alter table public.messages
  add column if not exists ocr_text text,
  add column if not exists ocr_provider text,
  add column if not exists ocr_model text,
  add column if not exists ocr_status text check (ocr_status in ('DONE','UNCERTAIN','ERROR')),
  add column if not exists ocr_error text,
  add column if not exists image_content_type text,
  add column if not exists image_size_bytes bigint check (image_size_bytes is null or image_size_bytes >= 0);

comment on column public.messages.ocr_text is
  'Temporary OCR transcription for image messages. Cleared on LINE unsend.';
comment on column public.messages.ocr_provider is
  'OCR/Vision provider used for the image message.';
comment on column public.messages.ocr_model is
  'Model identifier used for OCR/Vision.';
comment on column public.messages.ocr_status is
  'DONE, UNCERTAIN, or ERROR.';
