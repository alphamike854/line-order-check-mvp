alter table public.review_resolution_events
  add column if not exists preview_fingerprint text,
  add column if not exists previewed_at timestamptz;

create or replace function public.resolve_review_with_preview(
  p_review_id bigint,
  p_corrected_text text,
  p_parser_version text,
  p_items jsonb,
  p_resolved_by text,
  p_preview_fingerprint text,
  p_previewed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_event_id uuid;
begin
  if coalesce(trim(p_preview_fingerprint), '') = '' then
    raise exception 'PREVIEW_FINGERPRINT_REQUIRED';
  end if;

  if p_previewed_at is null then
    raise exception 'PREVIEW_TIMESTAMP_REQUIRED';
  end if;

  v_result := public.resolve_review_with_items(
    p_review_id,
    p_corrected_text,
    p_parser_version,
    p_items,
    p_resolved_by
  );

  select e.id
    into v_event_id
  from public.review_resolution_events e
  where e.review_id = p_review_id
    and e.action = 'CORRECTED'
  order by e.resolved_at desc
  limit 1
  for update;

  if v_event_id is null then
    raise exception 'REVIEW_RESOLUTION_EVENT_NOT_FOUND';
  end if;

  update public.review_resolution_events
  set
    preview_fingerprint = p_preview_fingerprint,
    previewed_at = p_previewed_at
  where id = v_event_id;

  return v_result || jsonb_build_object(
    'preview_fingerprint', p_preview_fingerprint,
    'previewed_at', p_previewed_at
  );
end;
$$;

revoke all on function public.resolve_review_with_preview(bigint,text,text,jsonb,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_review_with_preview(bigint,text,text,jsonb,text,text,timestamptz)
  to service_role;
