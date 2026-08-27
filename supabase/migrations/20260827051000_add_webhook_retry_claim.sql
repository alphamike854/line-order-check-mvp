-- v8.8
-- Make webhook processing resumable without creating duplicate messages.

alter table public.webhook_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_events_attempt_count_check'
      and conrelid = 'public.webhook_events'::regclass
  ) then
    alter table public.webhook_events
      add constraint webhook_events_attempt_count_check
      check (attempt_count >= 0);
  end if;
end $$;


create or replace function public.claim_webhook_event(
  p_webhook_event_id text,
  p_destination text,
  p_event_type text,
  p_line_group_id text,
  p_user_id text,
  p_is_redelivery boolean,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.webhook_events%rowtype;
begin
  if coalesce(trim(p_webhook_event_id), '') = '' then
    raise exception 'WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  insert into public.webhook_events (
    webhook_event_id,
    destination,
    event_type,
    line_group_id,
    user_id,
    is_redelivery,
    payload
  )
  values (
    p_webhook_event_id,
    p_destination,
    p_event_type,
    p_line_group_id,
    p_user_id,
    coalesce(p_is_redelivery, false),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (webhook_event_id) do nothing;

  select *
    into v_event
  from public.webhook_events
  where webhook_event_id = p_webhook_event_id
  for update;

  if not found then
    raise exception 'WEBHOOK_EVENT_NOT_FOUND';
  end if;

  -- A webhookEventId must never be reused for another destination/event.
  if v_event.destination is distinct from p_destination
     or v_event.event_type is distinct from p_event_type then
    raise exception 'WEBHOOK_EVENT_IDENTITY_MISMATCH';
  end if;

  if v_event.processed_at is not null then
    return jsonb_build_object(
      'state', 'DONE',
      'attempt_count', v_event.attempt_count
    );
  end if;

  -- Prevent two concurrent invocations from processing the same event.
  -- A failed invocation explicitly releases this claim. The timeout is
  -- a fallback for a process that dies before it can release the claim.
  if v_event.processing_started_at is not null
     and v_event.processing_started_at > now() - interval '2 minutes' then
    return jsonb_build_object(
      'state', 'IN_FLIGHT',
      'attempt_count', v_event.attempt_count
    );
  end if;

  update public.webhook_events
  set
    processing_started_at = now(),
    attempt_count = attempt_count + 1,
    is_redelivery =
      v_event.is_redelivery or coalesce(p_is_redelivery, false),
    payload = coalesce(p_payload, v_event.payload),
    last_error = null
  where webhook_event_id = p_webhook_event_id;

  return jsonb_build_object(
    'state', 'CLAIMED',
    'attempt_count', v_event.attempt_count + 1
  );
end;
$$;


revoke all on function public.claim_webhook_event(
  text,text,text,text,text,boolean,jsonb
) from public, anon, authenticated;

grant execute on function public.claim_webhook_event(
  text,text,text,text,text,boolean,jsonb
) to service_role;
