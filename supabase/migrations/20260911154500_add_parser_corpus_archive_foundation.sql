-- DR1C-A
-- Parser Corpus Archive Foundation
--
-- Development-retention contract:
--
-- 1. Operational Round reset remains unchanged.
-- 2. Before an operational message is removed, preserve a durable
--    parser/OCR/Human-Truth corpus snapshot.
-- 3. Corpus rows are NOT operational rows and are never consumed by
--    allocation/risk/accounting calculations.
-- 4. Source message/review/order identifiers are snapshot identities.
--    There is deliberately no FK back to operational messages.
-- 5. Private review image evidence referenced by parser corpus must
--    survive Round reset Storage cleanup.
-- 6. Human Verification remains its existing durable source of truth;
--    the corpus stores only a snapshot for parser-development use.
-- 7. This migration does NOT change OPEN_GROUP/CLOSE_GROUP RPC behavior.
--
-- There is intentionally no migration-time historical backfill.
-- Existing operational messages are captured lazily and atomically
-- immediately before their first destructive reset.


begin;


-- ============================================================
-- 1. Durable parser-development corpus
-- ============================================================

create table if not exists
  public.parser_corpus_archive (
    id uuid primary key
      default gen_random_uuid(),

    source_message_record_id uuid not null,

    -- Lifecycle identity is snapshotted only.
    -- No FK to operational message/session/Round tables.
    settlement_session_id uuid,
    summary_group_id text,

    source_summary_group_round_id uuid,
    archive_round_id uuid,

    internal_round_no integer,
    round_business_date date,
    daily_round_no integer,

    source_message_id text,

    business_date date not null,
    event_timestamp timestamptz,

    line_group_id text not null,
    user_id text,
    message_type text not null,

    parse_status text not null,
    parser_version text,

    raw_text text,
    normalized_text text,
    ocr_text text,

    image_storage_path text,

    -- Full snapshots make this archive resilient to additions to the
    -- operational schemas during parser refinement.
    message_snapshot jsonb not null,

    order_items_snapshot jsonb not null
      default '[]'::jsonb,

    review_snapshot jsonb,

    review_resolution_events_snapshot jsonb not null
      default '[]'::jsonb,

    unsend_events_snapshot jsonb not null
      default '[]'::jsonb,

    verification_snapshot jsonb,

    archive_reason text not null
      default 'ROUND_RESET_PARSER_CORPUS'
      check (
        archive_reason in (
          'ROUND_RESET_PARSER_CORPUS'
        )
      ),

    archived_at timestamptz not null
      default clock_timestamp(),

    unique (
      source_message_record_id
    )
  );


create index if not exists
  parser_corpus_archive_round_idx
on public.parser_corpus_archive (
  archive_round_id,
  event_timestamp,
  source_message_record_id
);


create index if not exists
  parser_corpus_archive_business_group_idx
on public.parser_corpus_archive (
  business_date,
  summary_group_id,
  line_group_id,
  event_timestamp
);


create index if not exists
  parser_corpus_archive_parse_status_idx
on public.parser_corpus_archive (
  parse_status,
  parser_version,
  archived_at
);


create index if not exists
  parser_corpus_archive_image_idx
on public.parser_corpus_archive (
  archive_round_id,
  image_storage_path
)
where image_storage_path is not null;


alter table
  public.parser_corpus_archive
enable row level security;


revoke all
on public.parser_corpus_archive
from public, anon, authenticated;


grant
  select,
  insert
on public.parser_corpus_archive
to service_role;


revoke
  update,
  delete
on public.parser_corpus_archive
from service_role;


comment on table
  public.parser_corpus_archive
is
  'Durable development corpus of real parser/OCR inputs, parser output, Review evidence, UNSEND context and Human Verification truth captured before operational Round reset.';


comment on column
  public.parser_corpus_archive.source_message_record_id
is
  'Historical source message UUID only. Deliberately has no FK to operational messages.';


comment on column
  public.parser_corpus_archive.message_snapshot
is
  'Full to_jsonb(messages) snapshot captured before operational deletion.';


comment on column
  public.parser_corpus_archive.order_items_snapshot
is
  'Canonical parser/output order_items visible immediately before operational deletion.';


comment on column
  public.parser_corpus_archive.verification_snapshot
is
  'Read-only snapshot of existing durable message_verifications Human Truth, when present.';


-- ============================================================
-- 2. Archive exactly one operational message
-- ============================================================

create or replace function
  public.archive_parser_corpus_message(
    p_message_record_id uuid
  )
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message
    public.messages%rowtype;

  v_archive_round
    public.settlement_summary_group_rounds%rowtype;

  v_archive_round_id uuid;

begin
  if p_message_record_id is null then
    return;
  end if;


  select
    message.*
  into
    v_message
  from
    public.messages message
  where
    message.id =
      p_message_record_id;


  if not found then
    return;
  end if;


  -- Prefer the immutable ownership carried by the accepted message.
  v_archive_round_id :=
    v_message.summary_group_round_id;


  -- Legacy/post-close messages may have NULL Round ownership.
  -- Resolve them to the latest Round of this exact parent/group,
  -- matching the reset boundary that will purge them.
  if
    v_archive_round_id is null
    and v_message.settlement_session_id is not null
    and v_message.summary_group_id is not null
  then
    select
      round.id
    into
      v_archive_round_id
    from
      public.settlement_summary_group_rounds round
    where
      round.settlement_session_id =
        v_message.settlement_session_id
      and round.summary_group_id =
        v_message.summary_group_id
    order by
      round.round_no desc
    limit 1;
  end if;


  if v_archive_round_id is not null then
    select
      round.*
    into
      v_archive_round
    from
      public.settlement_summary_group_rounds round
    where
      round.id =
        v_archive_round_id;
  end if;


  insert into
    public.parser_corpus_archive (
      source_message_record_id,

      settlement_session_id,
      summary_group_id,

      source_summary_group_round_id,
      archive_round_id,

      internal_round_no,
      round_business_date,
      daily_round_no,

      source_message_id,

      business_date,
      event_timestamp,

      line_group_id,
      user_id,
      message_type,

      parse_status,
      parser_version,

      raw_text,
      normalized_text,
      ocr_text,

      image_storage_path,

      message_snapshot,
      order_items_snapshot,
      review_snapshot,
      review_resolution_events_snapshot,
      unsend_events_snapshot,
      verification_snapshot,

      archive_reason,
      archived_at
    )

  values (
    v_message.id,

    v_message.settlement_session_id,
    v_message.summary_group_id,

    v_message.summary_group_round_id,
    v_archive_round_id,

    v_archive_round.round_no,
    v_archive_round.business_date,
    v_archive_round.daily_round_no,

    v_message.message_id,

    v_message.business_date,
    v_message.event_timestamp,

    v_message.line_group_id,
    v_message.user_id,
    v_message.message_type,

    v_message.parse_status,
    v_message.parser_version,

    v_message.raw_text,
    v_message.normalized_text,
    v_message.ocr_text,

    v_message.image_storage_path,

    to_jsonb(
      v_message
    ),

    coalesce(
      (
        select
          jsonb_agg(
            to_jsonb(item)
            order by item.id
          )
        from
          public.order_items item
        where
          item.message_record_id =
            v_message.id
      ),
      '[]'::jsonb
    ),

    (
      select
        to_jsonb(review)
      from
        public.review_items review
      where
        review.message_record_id =
          v_message.id
      limit 1
    ),

    coalesce(
      (
        select
          jsonb_agg(
            to_jsonb(event)
          )
        from
          public.review_resolution_events event
        where
          event.message_record_id =
            v_message.id
      ),
      '[]'::jsonb
    ),

    coalesce(
      (
        select
          jsonb_agg(
            to_jsonb(unsend)
          )
        from
          public.unsend_events unsend
        where
          unsend.matched_message_record_id =
            v_message.id
      ),
      '[]'::jsonb
    ),

    (
      select
        to_jsonb(verification)
      from
        public.message_verifications verification
      where
        verification.message_record_id =
          v_message.id
      limit 1
    ),

    'ROUND_RESET_PARSER_CORPUS',
    clock_timestamp()
  )

  on conflict (
    source_message_record_id
  )
  do nothing;


  -- OPEN_GROUP queues review-images before its destructive deletes.
  -- Once this message is in parser corpus, its image is intentionally
  -- retained for OCR/parser regression and must not reach Storage
  -- cleanup.
  if coalesce(
    v_message.image_storage_path,
    ''
  ) <> '' then

    delete from
      public.settlement_round_storage_cleanup_queue cleanup

    where
      cleanup.status =
        'PENDING'

      and cleanup.storage_bucket =
        'review-images'

      and cleanup.storage_path =
        v_message.image_storage_path

      and (
        v_archive_round_id is null
        or cleanup.round_id =
          v_archive_round_id
      );

  end if;

end;
$$;


revoke all
on function
  public.archive_parser_corpus_message(uuid)
from public, anon, authenticated;


grant execute
on function
  public.archive_parser_corpus_message(uuid)
to service_role;


-- ============================================================
-- 3. Capture before Review-resolution rows are explicitly deleted
--
-- OPEN_GROUP deletes review_resolution_events BEFORE messages.
-- The first BEFORE DELETE call therefore snapshots the complete
-- message + canonical items + Review + resolution + UNSEND +
-- verification state before any of it disappears.
-- ============================================================

create or replace function
  public.archive_parser_corpus_before_review_resolution_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform
    public.archive_parser_corpus_message(
      old.message_record_id
    );

  return old;
end;
$$;


drop trigger if exists
  review_resolution_parser_corpus_before_delete_trg
on public.review_resolution_events;


create trigger
  review_resolution_parser_corpus_before_delete_trg
before delete
on public.review_resolution_events
for each row
execute function
  public.archive_parser_corpus_before_review_resolution_delete();


revoke all
on function
  public.archive_parser_corpus_before_review_resolution_delete()
from public, anon, authenticated;


-- ============================================================
-- 4. Capture before UNSEND rows are explicitly deleted
-- ============================================================

create or replace function
  public.archive_parser_corpus_before_unsend_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.matched_message_record_id is not null then
    perform
      public.archive_parser_corpus_message(
        old.matched_message_record_id
      );
  end if;

  return old;
end;
$$;


drop trigger if exists
  unsend_parser_corpus_before_delete_trg
on public.unsend_events;


create trigger
  unsend_parser_corpus_before_delete_trg
before delete
on public.unsend_events
for each row
execute function
  public.archive_parser_corpus_before_unsend_delete();


revoke all
on function
  public.archive_parser_corpus_before_unsend_delete()
from public, anon, authenticated;


-- ============================================================
-- 5. Final safety net before operational message deletion
--
-- This covers PARSED/IGNORE/etc messages that have neither a
-- review-resolution event nor an UNSEND event.
-- ============================================================

create or replace function
  public.archive_parser_corpus_before_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform
    public.archive_parser_corpus_message(
      old.id
    );

  return old;
end;
$$;


drop trigger if exists
  messages_parser_corpus_before_delete_trg
on public.messages;


create trigger
  messages_parser_corpus_before_delete_trg
before delete
on public.messages
for each row
execute function
  public.archive_parser_corpus_before_message_delete();


revoke all
on function
  public.archive_parser_corpus_before_message_delete()
from public, anon, authenticated;


commit;
