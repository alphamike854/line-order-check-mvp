-- LOC P1: reserve LINE ingress *before* QStash publish, guarded across Round cutover.
-- Migration intentionally makes no changes to historical operational rows.
-- Source activation is opt-in: LINE_QSTASH_INGRESS_LEDGER_ENABLED=true.
begin;

create table if not exists public.line_qstash_ingress_ledger (
  webhook_event_id text primary key,
  summary_group_round_id uuid not null
    references public.settlement_summary_group_rounds(id) on delete cascade,
  line_group_id text not null,
  event_timestamp timestamptz not null,
  registered_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index if not exists line_qstash_ingress_ledger_pending_round_idx
  on public.line_qstash_ingress_ledger (summary_group_round_id, registered_at)
  where completed_at is null;

alter table public.line_qstash_ingress_ledger enable row level security;
revoke all on table public.line_qstash_ingress_ledger
  from public, anon, authenticated;

-- A reservation and an OPEN-new-Round transaction acquire the same lock.
-- This is the critical atomicity guarantee; a stand-alone waitlist GET is not.
create or replace function public.reserve_line_qstash_ingress_event(
  p_webhook_event_id text,
  p_summary_group_round_id uuid,
  p_line_group_id text,
  p_event_timestamp timestamptz
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
     or p_event_timestamp is null then
    raise exception 'QSTASH_INGRESS_RESERVATION_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE', 0)
  );

  if not exists (
    select 1
    from public.summary_group_round_runtime_state state
    join public.settlement_summary_group_rounds r
      on r.id = state.latest_round_id
     and r.summary_group_id = state.summary_group_id
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
    webhook_event_id, summary_group_round_id, line_group_id, event_timestamp
  ) values (
    p_webhook_event_id, p_summary_group_round_id, p_line_group_id, p_event_timestamp
  ) on conflict (webhook_event_id) do nothing;

  select * into v_row
  from public.line_qstash_ingress_ledger
  where webhook_event_id = p_webhook_event_id
  for update;

  if not found
     or v_row.summary_group_round_id is distinct from p_summary_group_round_id
     or v_row.line_group_id is distinct from p_line_group_id
     or v_row.event_timestamp is distinct from p_event_timestamp then
    raise exception 'QSTASH_INGRESS_RESERVATION_IDENTITY_MISMATCH';
  end if;

  return jsonb_build_object(
    'reserved', true,
    'already_completed', v_row.completed_at is not null
  );
end;
$$;

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
  set completed_at = coalesce(completed_at, clock_timestamp())
  where webhook_event_id = p_webhook_event_id
    and summary_group_round_id = p_summary_group_round_id;

  if not found then
    raise exception 'QSTASH_INGRESS_RESERVATION_MISSING';
  end if;
end;
$$;

revoke all on function public.reserve_line_qstash_ingress_event(text,uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_line_qstash_ingress_event(text,uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_line_qstash_ingress_event(text,uuid,text,timestamptz)
  to service_role;
grant execute on function public.complete_line_qstash_ingress_event(text,uuid)
  to service_role;

-- The existing OPEN guard already calls this predicate under the same
-- advisory transaction lock. Include unseen-by-DB QStash ingress reservations.
create or replace function public.retention_round_has_inflight_work(
  p_round_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.webhook_events w
      where w.summary_group_round_id = p_round_id
        and w.processed_at is null
    )
    or exists (
      select 1 from public.messages m
      where m.summary_group_round_id = p_round_id
        and m.parse_status = 'PENDING'
    )
    or exists (
      select 1 from public.line_qstash_ingress_ledger ledger
      where ledger.summary_group_round_id = p_round_id
        and ledger.completed_at is null
    );
$$;

revoke all on function public.retention_round_has_inflight_work(uuid)
  from public, anon, authenticated;
grant execute on function public.retention_round_has_inflight_work(uuid)
  to service_role;

commit;
