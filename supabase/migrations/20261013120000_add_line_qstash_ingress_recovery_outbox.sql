-- LOC P1 Recovery v3: secure, temporary outbox for ledger-enrolled LINE TEXT/IMAGE.
-- Feature flag stays OFF; this migration does not replay or send messages.
begin;

alter table public.line_qstash_ingress_ledger
  add column if not exists destination text;
alter table public.line_qstash_ingress_ledger
  add column if not exists event_payload jsonb;

-- Only service_role may inspect still-pending payloads for operator-controlled replay.
-- No anon/authenticated/public access and no durable payload after completion.
revoke all on public.line_qstash_ingress_ledger from public, anon, authenticated;
grant select on public.line_qstash_ingress_ledger to service_role;

create or replace function public.reserve_line_qstash_ingress_event_v2(
  p_webhook_event_id text,
  p_summary_group_round_id uuid,
  p_line_group_id text,
  p_event_timestamp timestamptz,
  p_destination text,
  p_event_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.line_qstash_ingress_ledger%rowtype;
begin
  if nullif(trim(p_webhook_event_id),'') is null
    or p_summary_group_round_id is null
    or nullif(trim(p_line_group_id),'') is null
    or p_event_timestamp is null
    or nullif(trim(p_destination),'') is null
    or length(p_destination) > 256
    or p_event_payload is null
    or jsonb_typeof(p_event_payload) <> 'object'
    or octet_length(p_event_payload::text) > 262144
    or p_event_payload->>'webhookEventId' is distinct from p_webhook_event_id
    or p_event_payload->'source'->>'groupId' is distinct from p_line_group_id
    or p_event_payload->'source'->>'type' is distinct from 'group'
    or p_event_payload->>'type' is distinct from 'message'
    or coalesce(p_event_payload->'message'->>'type','') not in ('text','image')
    or (p_event_payload->>'timestamp')::numeric
      is distinct from (extract(epoch from p_event_timestamp)*1000)::numeric
  then
    raise exception 'QSTASH_INGRESS_OUTBOX_PAYLOAD_INVALID';
  end if;

  -- Same serialisation lock as Round OPEN and the original Ledger reservation.
  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE', 0)
  );

  if not exists (
    select 1
    from public.summary_group_round_runtime_state state
    join public.settlement_summary_group_rounds r
      on r.id = state.latest_round_id and r.summary_group_id = state.summary_group_id
    join public.settlement_line_group_round_config lineage
      on lineage.round_id = r.id
    where r.id = p_summary_group_round_id
      and lineage.line_group_id = p_line_group_id
      and p_event_timestamp >= r.opened_at
      and (
        (r.status = 'OPEN' and r.closed_at is null)
        or (r.status = 'CLOSED' and r.closed_at is not null
            and p_event_timestamp < r.closed_at)
      )
  ) then
    raise exception 'QSTASH_INGRESS_ROUND_NOT_CURRENT';
  end if;

  insert into public.line_qstash_ingress_ledger (
    webhook_event_id, summary_group_round_id, line_group_id, event_timestamp,
    destination, event_payload
  ) values (
    p_webhook_event_id, p_summary_group_round_id, p_line_group_id,
    p_event_timestamp, p_destination, p_event_payload
  ) on conflict (webhook_event_id) do nothing;

  select * into v_row from public.line_qstash_ingress_ledger
  where webhook_event_id = p_webhook_event_id for update;

  if not found
    or v_row.summary_group_round_id is distinct from p_summary_group_round_id
    or v_row.line_group_id is distinct from p_line_group_id
    or v_row.event_timestamp is distinct from p_event_timestamp
    or v_row.destination is distinct from p_destination
    or (v_row.completed_at is null
        and v_row.event_payload is distinct from p_event_payload)
  then
    raise exception 'QSTASH_INGRESS_OUTBOX_IDENTITY_MISMATCH';
  end if;

  return jsonb_build_object(
    'reserved', true,
    'already_completed', v_row.completed_at is not null
  );
end;
$$;

-- Erase the raw LINE event immediately when processed (metadata retained).
create or replace function public.complete_line_qstash_ingress_event(
  p_webhook_event_id text,
  p_summary_group_round_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.line_qstash_ingress_ledger
  set completed_at = coalesce(completed_at, clock_timestamp()),
      event_payload = null
  where webhook_event_id = p_webhook_event_id
    and summary_group_round_id = p_summary_group_round_id;

  if not found then
    raise exception 'QSTASH_INGRESS_RESERVATION_MISSING';
  end if;
end;
$$;

revoke all on function public.reserve_line_qstash_ingress_event_v2(
  text,uuid,text,timestamptz,text,jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_line_qstash_ingress_event_v2(
  text,uuid,text,timestamptz,text,jsonb
) to service_role;

revoke all on function public.complete_line_qstash_ingress_event(text,uuid)
  from public, anon, authenticated;
grant execute on function public.complete_line_qstash_ingress_event(text,uuid)
  to service_role;
commit;
