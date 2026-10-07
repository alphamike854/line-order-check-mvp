-- Retention R3 — Current-Round Hard Reset Cutover
--
-- Current Round Only per Summary Group.
-- OPEN NEXT ROUND is the irreversible retention boundary.
-- No migration-time operational purge occurs here; purge runs only
-- inside the OPEN lifecycle transaction.

begin;

-- ============================================================
-- 1. Storage cleanup jobs survive retiring-Round deletion
-- ============================================================

alter table public.settlement_round_storage_cleanup_queue
  add column if not exists summary_group_id text;

update public.settlement_round_storage_cleanup_queue q
set summary_group_id = r.summary_group_id
from public.settlement_summary_group_rounds r
where q.summary_group_id is null
  and r.id = q.round_id;

alter table public.settlement_round_storage_cleanup_queue
  alter column summary_group_id set not null;

alter table public.settlement_round_storage_cleanup_queue
  drop constraint if exists settlement_round_storage_cleanup_queue_round_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'settlement_round_storage_cleanup_queue_summary_group_fk'
      and conrelid = 'public.settlement_round_storage_cleanup_queue'::regclass
  ) then
    alter table public.settlement_round_storage_cleanup_queue
      add constraint settlement_round_storage_cleanup_queue_summary_group_fk
      foreign key (summary_group_id)
      references public.summary_groups(id);
  end if;
end
$$;

create index if not exists settlement_round_storage_cleanup_group_pending_idx
on public.settlement_round_storage_cleanup_queue (
  summary_group_id,
  status,
  queued_at,
  id
);

-- ============================================================
-- 2. Stop durable parser corpus capture at destructive boundaries
-- ============================================================

drop trigger if exists review_resolution_parser_corpus_before_delete_trg
  on public.review_resolution_events;

drop trigger if exists unsend_parser_corpus_before_delete_trg
  on public.unsend_events;

drop trigger if exists messages_parser_corpus_before_delete_trg
  on public.messages;

revoke execute on function public.archive_parser_corpus_message(uuid)
  from service_role;

revoke insert on public.parser_corpus_archive
  from service_role;

-- ============================================================
-- 3. Post-close Review survives CLOSE only until successor OPEN
-- ============================================================

drop trigger if exists messages_post_close_review_archive_before_delete_trg
  on public.messages;

drop trigger if exists settlement_round_cleanup_preserve_post_close_review_trg
  on public.settlement_round_storage_cleanup_queue;

-- ============================================================
-- 4. Safety predicates
-- ============================================================

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
      select 1
      from public.webhook_events w
      where w.summary_group_round_id = p_round_id
        and w.processed_at is null
    )
    or
    exists (
      select 1
      from public.messages m
      where m.summary_group_round_id = p_round_id
        and m.parse_status = 'PENDING'
    );
$$;

create or replace function public.retention_round_has_unresolved_mirror(
  p_round_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.line_message_mirror_queue q
    left join public.line_message_mirror_batches b
      on b.id = q.batch_id
    where q.summary_group_round_id = p_round_id
      and (
        q.status not in ('SENT','CANCELLED')
        or (
          q.batch_id is not null
          and coalesce(b.status,'') not in ('SENT','CANCELLED')
        )
      )
  );
$$;

revoke all on function public.retention_round_has_inflight_work(uuid)
  from public, anon, authenticated;
revoke all on function public.retention_round_has_unresolved_mirror(uuid)
  from public, anon, authenticated;

grant execute on function public.retention_round_has_inflight_work(uuid)
  to service_role;
grant execute on function public.retention_round_has_unresolved_mirror(uuid)
  to service_role;

-- ============================================================
-- 5. Guard every OPEN Round, including bypass INSERTs
-- ============================================================

create or replace function public.guard_retention_cutover_on_new_round()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_round_id uuid;
  v_previous_status text;
begin
  if new.status <> 'OPEN' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0)
  );

  select state.latest_round_id, r.status
  into v_previous_round_id, v_previous_status
  from public.summary_group_round_runtime_state state
  join public.settlement_summary_group_rounds r
    on r.id = state.latest_round_id
  where state.summary_group_id = new.summary_group_id
  for update of r;

  if v_previous_round_id is null then
    return new;
  end if;

  if v_previous_status = 'OPEN' then
    raise exception 'SUMMARY_GROUP_ALREADY_OPEN';
  end if;

  if public.retention_round_has_inflight_work(v_previous_round_id) then
    raise exception 'RETENTION_ROUND_IN_FLIGHT_BLOCKS_NEW_ROUND';
  end if;

  if public.retention_round_has_unresolved_mirror(v_previous_round_id) then
    raise exception 'MIRROR_DELIVERY_UNRESOLVED_BLOCKS_NEW_ROUND';
  end if;

  return new;
end;
$$;

drop trigger if exists settlement_retention_cutover_new_round_guard_trg
  on public.settlement_summary_group_rounds;

create trigger settlement_retention_cutover_new_round_guard_trg
before insert on public.settlement_summary_group_rounds
for each row
when (new.status = 'OPEN')
execute function public.guard_retention_cutover_on_new_round();

revoke all on function public.guard_retention_cutover_on_new_round()
  from public, anon, authenticated;

-- ============================================================
-- 6. Mirror SENDING transition revalidates runtime-current Round
-- ============================================================

create or replace function public.guard_line_message_mirror_sending_current_round()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'SENDING' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0)
  );

  if exists (
    select 1
    from public.line_message_mirror_queue q
    left join public.summary_group_round_runtime_state state
      on state.latest_round_id = q.summary_group_round_id
    where q.batch_id = new.id
      and (
        state.latest_round_id is null
        or state.latest_round_id <> q.summary_group_round_id
      )
  ) then
    raise exception 'MIRROR_ROUND_RETIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists line_message_mirror_batch_current_round_send_trg
  on public.line_message_mirror_batches;

create trigger line_message_mirror_batch_current_round_send_trg
before update of status on public.line_message_mirror_batches
for each row
when (new.status = 'SENDING')
execute function public.guard_line_message_mirror_sending_current_round();

revoke all on function public.guard_line_message_mirror_sending_current_round()
  from public, anon, authenticated;

-- ============================================================
-- 7. Retiring-Round purge helper
-- ============================================================

create or replace function public.purge_retired_summary_group_round(
  p_retiring_round_id uuid,
  p_successor_round_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retiring_round public.settlement_summary_group_rounds%rowtype;
  v_successor_round public.settlement_summary_group_rounds%rowtype;
  v_webhook_ids text[] := array[]::text[];
  v_mirror_batch_ids uuid[] := array[]::uuid[];
  v_purged_messages bigint := 0;
begin
  if p_retiring_round_id is null or p_successor_round_id is null then
    raise exception 'RETENTION_ROUND_ID_REQUIRED';
  end if;

  if p_retiring_round_id = p_successor_round_id then
    raise exception 'RETENTION_SUCCESSOR_MUST_DIFFER';
  end if;

  select * into v_retiring_round
  from public.settlement_summary_group_rounds
  where id = p_retiring_round_id
  for update;

  if not found then
    raise exception 'RETENTION_RETIRING_ROUND_NOT_FOUND';
  end if;

  select * into v_successor_round
  from public.settlement_summary_group_rounds
  where id = p_successor_round_id
  for update;

  if not found then
    raise exception 'RETENTION_SUCCESSOR_ROUND_NOT_FOUND';
  end if;

  if v_retiring_round.summary_group_id <> v_successor_round.summary_group_id
     or v_successor_round.status <> 'OPEN' then
    raise exception 'RETENTION_SUCCESSOR_SCOPE_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.summary_group_round_runtime_state state
    where state.summary_group_id = v_successor_round.summary_group_id
      and state.latest_round_id = v_successor_round.id
  ) then
    raise exception 'RETENTION_CURSOR_NOT_ON_SUCCESSOR';
  end if;

  if public.retention_round_has_inflight_work(v_retiring_round.id) then
    raise exception 'RETENTION_ROUND_IN_FLIGHT_BLOCKS_PURGE';
  end if;

  if public.retention_round_has_unresolved_mirror(v_retiring_round.id) then
    raise exception 'MIRROR_DELIVERY_UNRESOLVED_BLOCKS_PURGE';
  end if;

  -- Queue review/parser/post-close image evidence.
  insert into public.settlement_round_storage_cleanup_queue (
    round_id,
    summary_group_id,
    storage_bucket,
    storage_path,
    status,
    queued_at
  )
  select distinct
    v_retiring_round.id,
    v_retiring_round.summary_group_id,
    'review-images',
    source.storage_path,
    'PENDING',
    clock_timestamp()
  from (
    select m.image_storage_path as storage_path
    from public.messages m
    where m.summary_group_round_id = v_retiring_round.id
       or (
         m.summary_group_round_id is null
         and m.settlement_session_id = v_retiring_round.settlement_session_id
         and m.summary_group_id = v_retiring_round.summary_group_id
       )

    union

    select archive.image_storage_path
    from public.post_close_review_archive archive
    where archive.round_id = v_retiring_round.id

    union

    select corpus.image_storage_path
    from public.parser_corpus_archive corpus
    where corpus.archive_round_id = v_retiring_round.id
       or corpus.source_summary_group_round_id = v_retiring_round.id
  ) source
  where coalesce(trim(source.storage_path),'') <> ''
  on conflict (round_id,storage_bucket,storage_path)
  do update set
    summary_group_id = excluded.summary_group_id,
    status = 'PENDING',
    queued_at = excluded.queued_at,
    attempted_at = null,
    deleted_at = null,
    last_error = null;

  -- Queue Mirror image objects before queue rows cascade their asset rows.
  insert into public.settlement_round_storage_cleanup_queue (
    round_id,
    summary_group_id,
    storage_bucket,
    storage_path,
    status,
    queued_at
  )
  select distinct
    v_retiring_round.id,
    v_retiring_round.summary_group_id,
    'mirror-images',
    paths.storage_path,
    'PENDING',
    clock_timestamp()
  from public.line_message_mirror_queue q
  join public.line_message_mirror_image_assets asset
    on asset.queue_id = q.id
  cross join lateral (
    values
      (asset.original_storage_path),
      (asset.preview_storage_path)
  ) paths(storage_path)
  where q.summary_group_round_id = v_retiring_round.id
    and asset.status <> 'DELETED'
    and coalesce(trim(paths.storage_path),'') <> ''
  on conflict (round_id,storage_bucket,storage_path)
  do update set
    summary_group_id = excluded.summary_group_id,
    status = 'PENDING',
    queued_at = excluded.queued_at,
    attempted_at = null,
    deleted_at = null,
    last_error = null;

  -- Mirror payload is operational content. Only terminal rows reach here.
  select coalesce(
    array_agg(distinct q.batch_id) filter (where q.batch_id is not null),
    array[]::uuid[]
  )
  into v_mirror_batch_ids
  from public.line_message_mirror_queue q
  where q.summary_group_round_id = v_retiring_round.id;

  delete from public.line_message_mirror_queue q
  where q.summary_group_round_id = v_retiring_round.id
    and q.status in ('SENT','CANCELLED');

  if cardinality(v_mirror_batch_ids) > 0 then
    delete from public.line_message_mirror_batches b
    where b.id = any(v_mirror_batch_ids)
      and b.status in ('SENT','CANCELLED');
  end if;

  -- Collect message webhook identities before deleting messages.
  select coalesce(
    array_agg(distinct m.webhook_event_id),
    array[]::text[]
  )
  into v_webhook_ids
  from public.messages m
  where m.summary_group_round_id = v_retiring_round.id
     or (
       m.summary_group_round_id is null
       and m.settlement_session_id = v_retiring_round.settlement_session_id
       and m.summary_group_id = v_retiring_round.summary_group_id
     );

  -- Explicit no-FK / archive purge.
  delete from public.message_verification_revision_events revision
  where revision.summary_group_round_id = v_retiring_round.id;

  delete from public.parser_corpus_archive corpus
  where corpus.archive_round_id = v_retiring_round.id
     or corpus.source_summary_group_round_id = v_retiring_round.id
     or (
       corpus.archive_round_id is null
       and corpus.source_summary_group_round_id is null
       and corpus.settlement_session_id = v_retiring_round.settlement_session_id
       and corpus.summary_group_id = v_retiring_round.summary_group_id
     );

  delete from public.post_close_review_archive archive
  where archive.round_id = v_retiring_round.id;

  -- FK-safe Review / UNSEND / message purge.
  delete from public.review_resolution_events event
  where exists (
    select 1
    from public.messages m
    where m.id = event.message_record_id
      and (
        m.summary_group_round_id = v_retiring_round.id
        or (
          m.summary_group_round_id is null
          and m.settlement_session_id = v_retiring_round.settlement_session_id
          and m.summary_group_id = v_retiring_round.summary_group_id
        )
      )
  );

  delete from public.unsend_events unsend
  where (
    unsend.matched_message_record_id is not null
    and exists (
      select 1
      from public.messages m
      where m.id = unsend.matched_message_record_id
        and (
          m.summary_group_round_id = v_retiring_round.id
          or (
            m.summary_group_round_id is null
            and m.settlement_session_id = v_retiring_round.settlement_session_id
            and m.summary_group_id = v_retiring_round.summary_group_id
          )
        )
    )
  )
  or unsend.webhook_event_id in (
    select w.webhook_event_id
    from public.webhook_events w
    where w.summary_group_round_id = v_retiring_round.id
  );

  delete from public.messages m
  where m.summary_group_round_id = v_retiring_round.id
     or (
       m.summary_group_round_id is null
       and m.settlement_session_id = v_retiring_round.settlement_session_id
       and m.summary_group_id = v_retiring_round.summary_group_id
     );

  get diagnostics v_purged_messages = row_count;

  delete from public.webhook_events w
  where w.summary_group_round_id = v_retiring_round.id
     or (
       cardinality(v_webhook_ids) > 0
       and w.webhook_event_id = any(v_webhook_ids)
     );

  -- Session + Summary Group operational state only. Master/config is kept.
  delete from public.settlement_transfer_batches
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.settlement_distribution_runs
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.settlement_allocation_confirmations
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.allocation_confirmation_events
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.settlement_summary_group_actual_special_point_codes
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.allocation_confirmations
  where business_date = v_retiring_round.business_date
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.settlement_summary_group_controls
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  delete from public.settlement_summary_group_control_events
  where settlement_session_id = v_retiring_round.settlement_session_id
    and summary_group_id = v_retiring_round.summary_group_id;

  -- Round row is LAST. R1 cursor must already point at successor.
  delete from public.settlement_summary_group_rounds
  where id = v_retiring_round.id;

  if not found then
    raise exception 'RETENTION_RETIRING_ROUND_DELETE_FAILED';
  end if;

  return v_purged_messages;
end;
$$;

revoke all on function public.purge_retired_summary_group_round(uuid,uuid)
  from public, anon, authenticated, service_role;

-- ============================================================
-- 8. Cut OPEN lifecycle over; preserve proven CLOSE implementation
-- ============================================================

alter function public.set_settlement_summary_group_accepting(
  uuid,
  text,
  boolean,
  text
)
rename to set_settlement_summary_group_accepting_pre_retention_v1;

revoke all on function public.set_settlement_summary_group_accepting_pre_retention_v1(
  uuid,
  text,
  boolean,
  text
)
from public, anon, authenticated, service_role;

create or replace function public.set_settlement_summary_group_accepting(
  p_settlement_session_id uuid,
  p_summary_group_id text,
  p_accepting_orders boolean,
  p_changed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.settlement_sessions%rowtype;
  v_latest_round public.settlement_summary_group_rounds%rowtype;
  v_new_round public.settlement_summary_group_rounds%rowtype;
  v_next_round_no integer;
  v_changed_at timestamptz := clock_timestamp();
  v_purged_messages bigint := 0;
  v_cleanup_jobs jsonb := '[]'::jsonb;
  v_review_paths jsonb := '[]'::jsonb;
begin
  if p_accepting_orders is false then
    return public.set_settlement_summary_group_accepting_pre_retention_v1(
      p_settlement_session_id,
      p_summary_group_id,
      false,
      p_changed_by
    );
  end if;

  if p_accepting_orders is null then
    raise exception 'SUMMARY_GROUP_STATE_REQUIRED';
  end if;

  if p_settlement_session_id is null then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if coalesce(trim(p_summary_group_id),'') = '' then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('LINE_ORDER_SETTLEMENT_OPEN_CLOSE',0)
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        p_settlement_session_id::text,
        p_summary_group_id
      ),
      0
    )
  );

  select * into v_session
  from public.settlement_sessions
  where id = p_settlement_session_id
  for update;

  if not found then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_session.status <> 'OPEN' then
    raise exception 'SETTLEMENT_NOT_OPEN';
  end if;

  if not exists (
    select 1
    from public.settlement_line_group_config cfg
    where cfg.settlement_session_id = p_settlement_session_id
      and cfg.summary_group_id = p_summary_group_id
      and cfg.enabled = true
  ) then
    raise exception 'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;

  select r.* into v_latest_round
  from public.summary_group_round_runtime_state state
  join public.settlement_summary_group_rounds r
    on r.id = state.latest_round_id
  where state.summary_group_id = p_summary_group_id
  for update of r;

  if found and v_latest_round.status = 'OPEN' then
    if v_latest_round.settlement_session_id <> p_settlement_session_id then
      raise exception 'SUMMARY_GROUP_ALREADY_OPEN';
    end if;

    return jsonb_build_object(
      'settlement_session_id', v_latest_round.settlement_session_id,
      'summary_group_id', v_latest_round.summary_group_id,
      'accepting_orders', true,
      'changed', false,
      'round_id', v_latest_round.id,
      'round_no', v_latest_round.round_no,
      'business_date', v_latest_round.business_date,
      'daily_round_no', v_latest_round.daily_round_no
    );
  end if;

  if v_latest_round.id is not null then
    if public.retention_round_has_inflight_work(v_latest_round.id) then
      raise exception 'RETENTION_ROUND_IN_FLIGHT_BLOCKS_NEW_ROUND';
    end if;

    if public.retention_round_has_unresolved_mirror(v_latest_round.id) then
      raise exception 'MIRROR_DELIVERY_UNRESOLVED_BLOCKS_NEW_ROUND';
    end if;
  end if;

  -- Internal round_no remains per compatibility session.
  select coalesce(max(r.round_no),0) + 1
  into v_next_round_no
  from public.settlement_summary_group_rounds r
  where r.settlement_session_id = p_settlement_session_id
    and r.summary_group_id = p_summary_group_id;

  -- Successor FIRST. Existing BEFORE/AFTER INSERT triggers keep daily
  -- numbering, Export guards/purge, lineage and R1 runtime cursor atomic.
  insert into public.settlement_summary_group_rounds (
    settlement_session_id,
    summary_group_id,
    round_no,
    status,
    opened_at,
    opened_by
  )
  values (
    p_settlement_session_id,
    p_summary_group_id,
    v_next_round_no,
    'OPEN',
    v_changed_at,
    p_changed_by
  )
  returning * into v_new_round;

  if v_latest_round.id is not null then
    v_purged_messages := public.purge_retired_summary_group_round(
      v_latest_round.id,
      v_new_round.id
    );
  end if;

  delete from public.settlement_summary_group_controls
  where settlement_session_id = p_settlement_session_id
    and summary_group_id = p_summary_group_id;

  insert into public.settlement_summary_group_control_events (
    settlement_session_id,
    summary_group_id,
    previous_accepting_orders,
    new_accepting_orders,
    changed_at,
    changed_by
  )
  values (
    p_settlement_session_id,
    p_summary_group_id,
    false,
    true,
    v_changed_at,
    p_changed_by
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'round_id', q.round_id,
        'storage_bucket', q.storage_bucket,
        'storage_path', q.storage_path,
        'status', q.status
      )
      order by q.queued_at,q.id
    ),
    '[]'::jsonb
  )
  into v_cleanup_jobs
  from public.settlement_round_storage_cleanup_queue q
  where q.summary_group_id = p_summary_group_id
    and q.status in ('PENDING','FAILED');

  if v_latest_round.id is not null then
    select coalesce(
      jsonb_agg(q.storage_path order by q.storage_path),
      '[]'::jsonb
    )
    into v_review_paths
    from public.settlement_round_storage_cleanup_queue q
    where q.round_id = v_latest_round.id
      and q.storage_bucket = 'review-images'
      and q.status in ('PENDING','FAILED');
  end if;

  return jsonb_build_object(
    'settlement_session_id', p_settlement_session_id,
    'summary_group_id', p_summary_group_id,
    'accepting_orders', true,
    'changed', true,
    'round_id', v_new_round.id,
    'round_no', v_new_round.round_no,
    'business_date', v_new_round.business_date,
    'daily_round_no', v_new_round.daily_round_no,
    'opened_at', v_new_round.opened_at,
    'reset_from_round_id', v_latest_round.id,
    'reset_from_round_no', v_latest_round.round_no,
    'purged_message_count', v_purged_messages,
    'image_storage_bucket', 'review-images',
    'image_storage_paths', v_review_paths,
    'storage_cleanup_jobs', v_cleanup_jobs
  );
end;
$$;

revoke all on function public.set_settlement_summary_group_accepting(
  uuid,
  text,
  boolean,
  text
)
from public, anon, authenticated;

grant execute on function public.set_settlement_summary_group_accepting(
  uuid,
  text,
  boolean,
  text
)
to service_role;

comment on function public.set_settlement_summary_group_accepting(
  uuid,
  text,
  boolean,
  text
)
is 'Retention R3 current-Round-only lifecycle. CLOSE delegates to the proven pre-R3 implementation; OPEN inserts successor first, advances runtime cursor, then permanently purges the retiring Round for this Summary Group.';

commit;
