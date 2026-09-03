-- R2D3A-1
-- Durable Post-close Review Archive Foundation
--
-- Purpose:
--   Preserve Review evidence that still requires human verification
--   before previous-round operational messages are purged.
--
-- This phase deliberately does NOT:
--   - change review_items top-level status
--   - add another Review top-level status
--   - introduce POST_CLOSE mutation APIs
--   - change Staff claim/lease semantics
--   - change OPEN_GROUP / CLOSE_GROUP behavior
--   - mutate canonical order_items
--
-- Archive candidates:
--   1. Review still OPEN when a closed Summary Group round is reset.
--   2. Review previously converted to RESOLVED / DEFERRED.
--
-- The source message/review identifiers are intentionally NOT foreign
-- keys because those operational rows are deleted during OPEN_GROUP.
--
-- Private image evidence referenced by a durable archive must not be
-- queued for round Storage cleanup.


-- ============================================================
-- 1. Durable archive
-- ============================================================

create table if not exists
  public.post_close_review_archive (
    id uuid primary key
      default gen_random_uuid(),

    round_id uuid not null
      references
        public.settlement_summary_group_rounds(id)
      on delete cascade,

    settlement_session_id uuid not null
      references
        public.settlement_sessions(id)
      on delete cascade,

    summary_group_id text not null
      references public.summary_groups(id),

    round_no integer not null
      check (round_no > 0),

    -- Source identities are snapshots only.
    -- Do NOT add FKs to review_items/messages.
    source_review_id bigint not null,
    source_message_record_id uuid not null,

    source_message_id text,
    destination text,

    business_date date not null,
    event_timestamp timestamptz,

    line_group_id text not null,
    user_id text,
    message_type text not null,

    raw_text text,
    normalized_text text,
    ocr_text text,

    parse_status text not null,
    parser_version text,

    reason_codes jsonb not null
      default '[]'::jsonb,

    warnings jsonb not null
      default '[]'::jsonb,

    source_review_status text not null,
    source_resolution_type text,
    source_corrected_text text,
    source_review_created_at timestamptz,
    source_resolved_at timestamptz,
    source_resolved_by text,

    image_storage_path text,
    image_stored_at timestamptz,
    image_deleted_at timestamptz,

    archive_reason text not null
      check (
        archive_reason in (
          'PENDING_AT_ROUND_RESET',
          'DEFERRED_AT_SETTLEMENT_CLOSE'
        )
      ),

    archived_at timestamptz not null
      default now(),

    updated_at timestamptz not null
      default now(),

    unique (
      round_id,
      source_review_id
    )
  );


create index if not exists
  post_close_review_archive_round_idx
on public.post_close_review_archive (
  settlement_session_id,
  summary_group_id,
  round_no desc,
  archived_at desc
);


create index if not exists
  post_close_review_archive_image_idx
on public.post_close_review_archive (
  round_id,
  image_storage_path
)
where image_storage_path is not null;


alter table
  public.post_close_review_archive
enable row level security;


revoke all
on public.post_close_review_archive
from public, anon, authenticated;


grant
  select,
  insert,
  update
on public.post_close_review_archive
to service_role;


-- Supabase may grant broader table privileges to service_role
-- through platform/default privileges. The durable archive is
-- intentionally not directly deletable in this foundation.
revoke delete
on public.post_close_review_archive
from service_role;


comment on table
  public.post_close_review_archive
is
  'Durable snapshot of closed-round Review evidence that must survive operational message purge.';


comment on column
  public.post_close_review_archive.source_review_id
is
  'Snapshot identity only. Deliberately has no FK to review_items because operational Review rows are purged with messages.';


comment on column
  public.post_close_review_archive.source_message_record_id
is
  'Snapshot identity only. Deliberately has no FK to messages because previous-round messages are purged.';


-- ============================================================
-- 2. Archive one Review/message into a durable closed Round
-- ============================================================

create or replace function
  public.archive_post_close_review_message(
    p_message_record_id uuid,
    p_round_id uuid
  )
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;
begin
  if p_message_record_id is null
     or p_round_id is null then
    return;
  end if;


  select *
    into v_round
  from
    public.settlement_summary_group_rounds
  where id = p_round_id;


  if not found
     or v_round.status <> 'CLOSED' then
    return;
  end if;


  insert into
    public.post_close_review_archive (
      round_id,
      settlement_session_id,
      summary_group_id,
      round_no,

      source_review_id,
      source_message_record_id,

      source_message_id,
      destination,

      business_date,
      event_timestamp,

      line_group_id,
      user_id,
      message_type,

      raw_text,
      normalized_text,
      ocr_text,

      parse_status,
      parser_version,

      reason_codes,
      warnings,

      source_review_status,
      source_resolution_type,
      source_corrected_text,
      source_review_created_at,
      source_resolved_at,
      source_resolved_by,

      image_storage_path,
      image_stored_at,
      image_deleted_at,

      archive_reason,

      archived_at,
      updated_at
    )
  select
    v_round.id,
    v_round.settlement_session_id,
    v_round.summary_group_id,
    v_round.round_no,

    review.id,
    message.id,

    message.message_id,
    message.destination,

    message.business_date,
    message.event_timestamp,

    message.line_group_id,
    message.user_id,
    message.message_type,

    message.raw_text,
    message.normalized_text,
    message.ocr_text,

    message.parse_status,
    message.parser_version,

    coalesce(
      review.reason_codes,
      '[]'::jsonb
    ),

    coalesce(
      review.warnings,
      '[]'::jsonb
    ),

    review.status,
    review.resolution_type,
    review.corrected_text,
    review.created_at,
    review.resolved_at,
    review.resolved_by,

    message.image_storage_path,
    message.image_stored_at,
    message.image_deleted_at,

    case
      when review.resolution_type = 'DEFERRED'
        then 'DEFERRED_AT_SETTLEMENT_CLOSE'
      else 'PENDING_AT_ROUND_RESET'
    end,

    now(),
    now()

  from public.messages message

  join public.review_items review
    on review.message_record_id =
       message.id

  where
    message.id =
      p_message_record_id

    and message.settlement_session_id =
        v_round.settlement_session_id

    and message.summary_group_id =
        v_round.summary_group_id

    and (
      message.summary_group_round_id =
        v_round.id

      -- Closed-group/post-close messages may deliberately have
      -- no Round ownership because there is no OPEN Round.
      or message.summary_group_round_id
         is null
    )

    and (
      review.status = 'OPEN'
      or review.resolution_type =
         'DEFERRED'
    )

  on conflict (
    round_id,
    source_review_id
  )
  do update set
    source_message_id =
      excluded.source_message_id,

    destination =
      excluded.destination,

    business_date =
      excluded.business_date,

    event_timestamp =
      excluded.event_timestamp,

    line_group_id =
      excluded.line_group_id,

    user_id =
      excluded.user_id,

    message_type =
      excluded.message_type,

    raw_text =
      excluded.raw_text,

    normalized_text =
      excluded.normalized_text,

    ocr_text =
      excluded.ocr_text,

    parse_status =
      excluded.parse_status,

    parser_version =
      excluded.parser_version,

    reason_codes =
      excluded.reason_codes,

    warnings =
      excluded.warnings,

    source_review_status =
      excluded.source_review_status,

    source_resolution_type =
      excluded.source_resolution_type,

    source_corrected_text =
      excluded.source_corrected_text,

    source_review_created_at =
      excluded.source_review_created_at,

    source_resolved_at =
      excluded.source_resolved_at,

    source_resolved_by =
      excluded.source_resolved_by,

    image_storage_path =
      excluded.image_storage_path,

    image_stored_at =
      excluded.image_stored_at,

    image_deleted_at =
      excluded.image_deleted_at,

    archive_reason =
      excluded.archive_reason,

    updated_at =
      now();
end;
$$;


revoke all
on function
  public.archive_post_close_review_message(
    uuid,
    uuid
  )
from public, anon, authenticated;


grant execute
on function
  public.archive_post_close_review_message(
    uuid,
    uuid
  )
to service_role;


-- ============================================================
-- 3. Archive immediately when a Round becomes CLOSED
--
-- This is the primary durable capture point.
--
-- CLOSE_GROUP:
--   OPEN Review remains actionable for future POST_CLOSE work.
--
-- Full settlement close:
--   close_settlement_session() first converts unresolved Review
--   to RESOLVED / DEFERRED, then parent lifecycle closes its
--   OPEN Summary Group Rounds.
--
-- In both cases the Round CLOSED transition snapshots the Review
-- evidence immediately instead of waiting for a future reset.
-- ============================================================

create or replace function
  public.archive_post_close_reviews_on_round_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_record_id uuid;
begin
  if new.status <> 'CLOSED'
     or old.status is not distinct from new.status then
    return new;
  end if;


  for v_message_record_id in

    select
      message.id

    from public.messages message

    join public.review_items review
      on review.message_record_id =
         message.id

    where
      message.settlement_session_id =
        new.settlement_session_id

      and message.summary_group_id =
        new.summary_group_id

      and message.summary_group_round_id =
        new.id

      and (
        review.status = 'OPEN'
        or review.resolution_type =
           'DEFERRED'
      )

  loop

    perform
      public.archive_post_close_review_message(
        v_message_record_id,
        new.id
      );

  end loop;


  return new;
end;
$$;


drop trigger if exists
  settlement_round_post_close_review_archive_trg
on public.settlement_summary_group_rounds;


create trigger
  settlement_round_post_close_review_archive_trg
after update of status
on public.settlement_summary_group_rounds
for each row
when (
  old.status is distinct from new.status
  and new.status = 'CLOSED'
)
execute function
  public.archive_post_close_reviews_on_round_close();


revoke all
on function
  public.archive_post_close_reviews_on_round_close()
from public, anon, authenticated;


-- ============================================================
-- 4. Safety archive immediately before message purge
--
-- OPEN_GROUP ultimately deletes previous-round messages.
-- This trigger executes before that DELETE and snapshots any
-- Review evidence that still requires post-close verification.
-- ============================================================

create or replace function
  public.archive_post_close_review_before_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_round_id uuid;
begin
  if old.settlement_session_id is null
     or old.summary_group_id is null then
    return old;
  end if;


  v_target_round_id :=
    old.summary_group_round_id;


  -- A message received after CLOSE_GROUP has no OPEN Round and
  -- can therefore have NULL round ownership. Associate it with
  -- the latest CLOSED Round of this exact session/group.
  if v_target_round_id is null then

    -- Do not reinterpret a legacy NULL-round message while this
    -- Summary Group currently has an OPEN Round.
    if exists (
      select 1
      from
        public.settlement_summary_group_rounds r
      where
        r.settlement_session_id =
          old.settlement_session_id
        and r.summary_group_id =
          old.summary_group_id
        and r.status = 'OPEN'
    ) then
      return old;
    end if;


    select r.id
      into v_target_round_id
    from
      public.settlement_summary_group_rounds r
    where
      r.settlement_session_id =
        old.settlement_session_id
      and r.summary_group_id =
        old.summary_group_id
      and r.status = 'CLOSED'
    order by
      r.round_no desc
    limit 1;

  end if;


  if v_target_round_id is not null then
    perform
      public.archive_post_close_review_message(
        old.id,
        v_target_round_id
      );
  end if;


  return old;
end;
$$;


drop trigger if exists
  messages_post_close_review_archive_before_delete_trg
on public.messages;


create trigger
  messages_post_close_review_archive_before_delete_trg
before delete
on public.messages
for each row
execute function
  public.archive_post_close_review_before_message_delete();


revoke all
on function
  public.archive_post_close_review_before_message_delete()
from public, anon, authenticated;


-- ============================================================
-- 5. Protect private image evidence from Round cleanup
--
-- The lifecycle inserts image paths into
-- settlement_round_storage_cleanup_queue before messages are
-- deleted. For a pending/deferred Review:
--
--   1. archive the Review first
--   2. return NULL from this BEFORE INSERT trigger
--   3. no cleanup row is created
--   4. settlement.mjs therefore receives no path to delete
--
-- This preserves the private object for the future POST_CLOSE
-- verification phase.
-- ============================================================

create or replace function
  public.protect_post_close_review_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_message_id uuid;

  v_preserve boolean := false;
begin
  if new.round_id is null
     or coalesce(
       trim(new.storage_path),
       ''
     ) = '' then
    return new;
  end if;


  select *
    into v_round
  from
    public.settlement_summary_group_rounds
  where id = new.round_id;


  if not found
     or v_round.status <> 'CLOSED' then
    return new;
  end if;


  -- Existing durable archive always wins over cleanup.
  if exists (
    select 1
    from public.post_close_review_archive archive
    where
      archive.round_id =
        new.round_id
      and archive.image_storage_path =
        new.storage_path
  ) then
    return null;
  end if;


  -- Queue insertion occurs before message purge, so the source
  -- message/review is still available here.
  for v_message_id in

    select distinct
      message.id

    from public.messages message

    join public.review_items review
      on review.message_record_id =
         message.id

    where
      message.settlement_session_id =
        v_round.settlement_session_id

      and message.summary_group_id =
        v_round.summary_group_id

      and (
        message.summary_group_round_id =
          v_round.id
        or message.summary_group_round_id
           is null
      )

      and message.image_storage_path =
        new.storage_path

      and (
        review.status = 'OPEN'
        or review.resolution_type =
           'DEFERRED'
      )

  loop

    perform
      public.archive_post_close_review_message(
        v_message_id,
        new.round_id
      );

    v_preserve := true;

  end loop;


  if v_preserve then
    return null;
  end if;


  return new;
end;
$$;


drop trigger if exists
  settlement_round_cleanup_preserve_post_close_review_trg
on public.settlement_round_storage_cleanup_queue;


create trigger
  settlement_round_cleanup_preserve_post_close_review_trg
before insert
on public.settlement_round_storage_cleanup_queue
for each row
execute function
  public.protect_post_close_review_storage_cleanup();


revoke all
on function
  public.protect_post_close_review_storage_cleanup()
from public, anon, authenticated;


-- ============================================================
-- 6. Backfill Review evidence that is already in a CLOSED Round
--
-- This protects a group that was closed before this migration
-- but has not yet been reopened/purged.
-- ============================================================

do $$
declare
  candidate record;
begin
  for candidate in

    select
      message.id
        as message_record_id,

      coalesce(
        message.summary_group_round_id,

        case
          -- NULL-round messages are interpreted as post-close
          -- only while this Summary Group has no OPEN Round.
          when not exists (
            select 1
            from
              public.settlement_summary_group_rounds open_round
            where
              open_round.settlement_session_id =
                message.settlement_session_id
              and open_round.summary_group_id =
                message.summary_group_id
              and open_round.status =
                'OPEN'
          )
          then (
            select closed_round.id
            from
              public.settlement_summary_group_rounds
                closed_round
            where
              closed_round.settlement_session_id =
                message.settlement_session_id
              and closed_round.summary_group_id =
                message.summary_group_id
              and closed_round.status =
                'CLOSED'
            order by
              closed_round.round_no desc
            limit 1
          )
          else null
        end
      ) as target_round_id

    from public.messages message

    join public.review_items review
      on review.message_record_id =
         message.id

    where
      message.settlement_session_id
        is not null

      and message.summary_group_id
        is not null

      and (
        review.status = 'OPEN'
        or review.resolution_type =
           'DEFERRED'
      )

  loop

    if candidate.target_round_id
       is not null then

      perform
        public.archive_post_close_review_message(
          candidate.message_record_id,
          candidate.target_round_id
        );

    end if;

  end loop;
end
$$;


-- ============================================================
-- 7. Remove only still-pending cleanup rows that are now
-- protected by a durable archive.
--
-- DELETED/FAILED audit rows are deliberately not rewritten.
-- ============================================================

delete from
  public.settlement_round_storage_cleanup_queue queue
where
  queue.status = 'PENDING'
  and exists (
    select 1
    from
      public.post_close_review_archive archive
    where
      archive.round_id =
        queue.round_id
      and archive.image_storage_path =
        queue.storage_path
  );
