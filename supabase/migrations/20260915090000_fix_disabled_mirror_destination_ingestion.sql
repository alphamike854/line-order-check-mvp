-- Mirror P0
--
-- A disabled Mirror route must not turn its destination into an
-- ingestion-denied room.
--
-- Only ENABLED Mirror routes establish the MIRROR_DESTINATION
-- ingestion boundary.
--
-- This migration changes no route rows and enables no Mirror traffic.

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
set search_path to 'public'
as $function$
declare
  v_event public.webhook_events%rowtype;
  v_is_mirror_destination boolean := false;
  v_stored_user_id text;
  v_stored_payload jsonb;
begin
  if coalesce(
    trim(p_webhook_event_id),
    ''
  ) = '' then
    raise exception
      'WEBHOOK_EVENT_ID_REQUIRED';
  end if;

  if coalesce(
    trim(p_line_group_id),
    ''
  ) <> '' then
    select exists (
      select 1
      from public.line_message_mirror_routes r
      where r.destination_line_group_id =
            p_line_group_id
        and r.enabled = true
    )
      into v_is_mirror_destination;
  end if;

  if v_is_mirror_destination then
    v_stored_user_id := null;
    v_stored_payload := '{}'::jsonb;
  else
    v_stored_user_id := p_user_id;
    v_stored_payload :=
      coalesce(
        p_payload,
        '{}'::jsonb
      );
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
    v_stored_user_id,
    coalesce(
      p_is_redelivery,
      false
    ),
    v_stored_payload
  )
  on conflict (
    webhook_event_id
  ) do nothing;

  select *
    into v_event
  from public.webhook_events
  where webhook_event_id =
        p_webhook_event_id
  for update;

  if not found then
    raise exception
      'WEBHOOK_EVENT_NOT_FOUND';
  end if;

  if v_event.destination
       is distinct from
       p_destination
     or v_event.event_type
       is distinct from
       p_event_type then
    raise exception
      'WEBHOOK_EVENT_IDENTITY_MISMATCH';
  end if;

  if v_is_mirror_destination then
    update public.webhook_events
    set
      user_id = null,
      payload = '{}'::jsonb,
      processed_at =
        coalesce(
          processed_at,
          now()
        ),
      processing_started_at = null,
      attempt_count =
        attempt_count + 1,
      is_redelivery =
        is_redelivery
        or coalesce(
          p_is_redelivery,
          false
        ),
      last_error = null
    where webhook_event_id =
          p_webhook_event_id
    returning *
      into v_event;

    return jsonb_build_object(
      'state',
        'DENIED',
      'reason',
        'MIRROR_DESTINATION',
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  if v_event.processed_at
       is not null then
    return jsonb_build_object(
      'state',
        'DONE',
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  if v_event.processing_started_at
       is not null
     and v_event.processing_started_at >
         now() - interval '2 minutes' then
    return jsonb_build_object(
      'state',
        'IN_FLIGHT',
      'attempt_count',
        v_event.attempt_count
    );
  end if;

  update public.webhook_events
  set
    processing_started_at = now(),
    attempt_count =
      attempt_count + 1,
    is_redelivery =
      v_event.is_redelivery
      or coalesce(
        p_is_redelivery,
        false
      ),
    user_id = p_user_id,
    payload =
      coalesce(
        p_payload,
        v_event.payload
      ),
    last_error = null
  where webhook_event_id =
        p_webhook_event_id;

  return jsonb_build_object(
    'state',
      'CLAIMED',
    'attempt_count',
      v_event.attempt_count + 1
  );
end;
$function$;
