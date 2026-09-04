-- R2D3D-1A
-- Durable Post-close Review Resolution Foundation
--
-- Resolution grain:
--   post_close_review_archive.id
--
-- Important:
--   - Post-close resolution is independent of live Review lifecycle.
--   - Closed canonical order_items are immutable in this phase.
--   - Source review/message rows may already have been purged.
--   - source_* columns remain the immutable archive-time snapshot.
--   - Current Staff <-> LINE Group scope is supplied by the
--     authenticated server boundary.
--   - Resolution requires the exact active post-close lease.
--   - Resolution and Claim/Release serialize on the same advisory lock.
--   - Successful resolution atomically releases the claim.
--   - Resolution is one-way: CORRECTED or IGNORED.


-- ============================================================
-- 1. Durable post-close resolution result
-- ============================================================

alter table
  public.post_close_review_archive
add column if not exists
  post_close_resolution_type text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_corrected_text text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_normalized_text text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_parser_version text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_items jsonb;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_preview_fingerprint text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_previewed_at timestamptz;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_resolved_at timestamptz;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_resolved_by_staff_id uuid;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_resolved_by_staff_code text;

alter table
  public.post_close_review_archive
add column if not exists
  post_close_resolved_by_display_name text;


-- Staff identity above is deliberately an audit snapshot.
--
-- Do NOT add a FK from post_close_resolved_by_staff_id to
-- staff_accounts. Historical resolution evidence must remain
-- durable even if the Staff account is later removed.


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where
      conrelid =
        'public.post_close_review_archive'::regclass
      and conname =
        'post_close_review_archive_resolution_type_check'
  ) then
    alter table
      public.post_close_review_archive
    add constraint
      post_close_review_archive_resolution_type_check
    check (
      post_close_resolution_type is null
      or post_close_resolution_type in (
        'CORRECTED',
        'IGNORED'
      )
    );
  end if;
end;
$$;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where
      conrelid =
        'public.post_close_review_archive'::regclass
      and conname =
        'post_close_review_archive_items_array_check'
  ) then
    alter table
      public.post_close_review_archive
    add constraint
      post_close_review_archive_items_array_check
    check (
      post_close_items is null
      or jsonb_typeof(
        post_close_items
      ) = 'array'
    );
  end if;
end;
$$;


create index if not exists
  post_close_review_archive_unresolved_idx
on public.post_close_review_archive (
  archived_at desc,
  id
)
where
  post_close_resolution_type is null;


comment on column
  public.post_close_review_archive.post_close_resolution_type
is
  'Final post-close human resolution. Separate from immutable source_* archive-time Review snapshot.';

comment on column
  public.post_close_review_archive.post_close_items
is
  'Durable parsed-item snapshot accepted by post-close CORRECT. Does not mutate closed canonical order_items.';

comment on column
  public.post_close_review_archive.post_close_resolved_by_staff_id
is
  'Durable Staff UUID snapshot only. Deliberately has no FK so historical resolution evidence survives Staff deletion.';


-- ============================================================
-- 2. Atomic guarded post-close resolution
-- ============================================================

create or replace function
  public.resolve_staff_post_close_review(
    p_archive_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_expected_lease_version bigint,
    p_action text,
    p_corrected_text text default null,
    p_normalized_text text default null,
    p_parser_version text default null,
    p_items jsonb default null,
    p_preview_fingerprint text default null,
    p_previewed_at timestamptz default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz;

  v_action text;

  v_staff
    public.staff_accounts%rowtype;

  v_archive
    public.post_close_review_archive%rowtype;

  v_claim
    public.staff_post_close_review_claims%rowtype;

  v_resolution_type text;

  v_deleted_claim_count integer;
begin
  -- ----------------------------------------------------------
  -- Required identity / precondition inputs
  -- ----------------------------------------------------------

  if p_archive_id is null then
    raise exception
      'ARCHIVE_ID_REQUIRED';
  end if;

  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;

  if
    p_expected_lease_version is null
    or p_expected_lease_version <= 0
  then
    raise exception
      'LEASE_VERSION_REQUIRED';
  end if;


  v_action :=
    upper(
      trim(
        coalesce(
          p_action,
          ''
        )
      )
    );

  if
    v_action <> 'CORRECT'
    and v_action <> 'IGNORE'
  then
    raise exception
      'INVALID_POST_CLOSE_REVIEW_ACTION';
  end if;


  -- ----------------------------------------------------------
  -- Staff must still be active.
  --
  -- Keep an audit snapshot from this locked Staff row.
  -- ----------------------------------------------------------

  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id = p_staff_id
    and s.enabled = true
  for share;

  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  -- ----------------------------------------------------------
  -- Serialize with Claim / Renew / Release for this exact
  -- durable archive work item.
  -- ----------------------------------------------------------

  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-post-close-review-claim:'
      || p_archive_id::text,
      0
    )
  );


  -- ----------------------------------------------------------
  -- Resolve archive identity + current Staff LINE Group scope
  -- in one boundary.
  --
  -- Missing and out-of-scope archive IDs deliberately return
  -- the same error.
  --
  -- No current Settlement / latest Round lookup exists here.
  -- ----------------------------------------------------------

  select a.*
  into v_archive
  from
    public.post_close_review_archive a
  where
    a.id =
      p_archive_id
    and a.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  for update;

  if not found then
    raise exception
      'POST_CLOSE_REVIEW_NOT_FOUND';
  end if;


  -- ----------------------------------------------------------
  -- One-way post-close outcome.
  -- ----------------------------------------------------------

  if
    v_archive.post_close_resolution_type
      is not null
  then
    raise exception
      'POST_CLOSE_REVIEW_ALREADY_RESOLVED';
  end if;


  -- ----------------------------------------------------------
  -- Exact active ownership is mandatory.
  -- ----------------------------------------------------------

  select c.*
  into v_claim
  from
    public.staff_post_close_review_claims c
  where
    c.archive_id =
      p_archive_id
  for update;

  if not found then
    raise exception
      'CLAIM_REQUIRED';
  end if;


  -- Refresh the clock after ownership serialization.
  --
  -- Do not use a timestamp captured before waiting for the
  -- advisory / claim-row locks, otherwise a lease that expires
  -- while this transaction waits could still be accepted.
  v_now :=
    clock_timestamp();


  if
    v_claim.claim_expires_at
      <= v_now
  then
    raise exception
      'CLAIM_EXPIRED';
  end if;


  if
    v_claim.staff_id
      <> p_staff_id
  then
    raise exception
      'CLAIM_OWNED_BY_OTHER';
  end if;


  if
    v_claim.lease_version
      <> p_expected_lease_version
  then
    raise exception
      'STALE_CLAIM_VERSION';
  end if;


  -- ----------------------------------------------------------
  -- CORRECT requires a complete parser/preview snapshot.
  --
  -- Parsing and preview-token verification belong to D1B.
  -- This DB boundary accepts only the already-verified result.
  -- ----------------------------------------------------------

  if v_action = 'CORRECT' then
    if
      coalesce(
        trim(
          p_corrected_text
        ),
        ''
      ) = ''
    then
      raise exception
        'CORRECTED_TEXT_REQUIRED';
    end if;


    if
      coalesce(
        trim(
          p_normalized_text
        ),
        ''
      ) = ''
    then
      raise exception
        'NORMALIZED_TEXT_REQUIRED';
    end if;


    if
      coalesce(
        trim(
          p_parser_version
        ),
        ''
      ) = ''
    then
      raise exception
        'PARSER_VERSION_REQUIRED';
    end if;


    if
      p_items is null
      or jsonb_typeof(
        p_items
      ) <> 'array'
    then
      raise exception
        'CORRECTION_ITEMS_REQUIRED';
    end if;


    if
      jsonb_array_length(
        p_items
      ) <= 0
    then
      raise exception
        'CORRECTION_ITEMS_REQUIRED';
    end if;


    if
      coalesce(
        trim(
          p_preview_fingerprint
        ),
        ''
      ) = ''
      or p_previewed_at is null
    then
      raise exception
        'PREVIEW_REQUIRED';
    end if;


    v_resolution_type :=
      'CORRECTED';

  else
    v_resolution_type :=
      'IGNORED';
  end if;


  -- ----------------------------------------------------------
  -- Archive-only mutation.
  --
  -- Do NOT update:
  --   source_* snapshot fields
  --   messages
  --   review_items
  --   order_items
  --   closed Settlement / Round state
  -- ----------------------------------------------------------

  update
    public.post_close_review_archive
  set
    post_close_resolution_type =
      v_resolution_type,

    post_close_corrected_text =
      case
        when v_action = 'CORRECT'
          then trim(
            p_corrected_text
          )
        else null
      end,

    post_close_normalized_text =
      case
        when v_action = 'CORRECT'
          then trim(
            p_normalized_text
          )
        else null
      end,

    post_close_parser_version =
      case
        when v_action = 'CORRECT'
          then trim(
            p_parser_version
          )
        else null
      end,

    post_close_items =
      case
        when v_action = 'CORRECT'
          then p_items
        else null
      end,

    post_close_preview_fingerprint =
      case
        when v_action = 'CORRECT'
          then trim(
            p_preview_fingerprint
          )
        else null
      end,

    post_close_previewed_at =
      case
        when v_action = 'CORRECT'
          then p_previewed_at
        else null
      end,

    post_close_resolved_at =
      v_now,

    post_close_resolved_by_staff_id =
      v_staff.id,

    post_close_resolved_by_staff_code =
      v_staff.staff_code,

    post_close_resolved_by_display_name =
      v_staff.display_name,

    updated_at =
      v_now

  where
    id =
      p_archive_id
    and post_close_resolution_type
      is null;


  if not found then
    raise exception
      'POST_CLOSE_REVIEW_ALREADY_RESOLVED';
  end if;


  -- ----------------------------------------------------------
  -- Successful resolution consumes the exact observed lease.
  --
  -- Because archive + claim are locked in the same transaction,
  -- cleanup failure must roll the entire resolution back.
  -- ----------------------------------------------------------

  delete from
    public.staff_post_close_review_claims
  where
    archive_id =
      p_archive_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  get diagnostics
    v_deleted_claim_count =
      row_count;


  if
    v_deleted_claim_count <> 1
  then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      'RESOLVED',

    'archive_id',
      p_archive_id,

    'resolution_type',
      v_resolution_type,

    'resolved_at',
      v_now,

    'resolved_by_staff_id',
      v_staff.id,

    'resolved_by_staff_code',
      v_staff.staff_code,

    'resolved_by_display_name',
      v_staff.display_name,

    'lease_version',
      p_expected_lease_version,

    'items_count',
      case
        when v_resolution_type =
          'CORRECTED'
        then jsonb_array_length(
          p_items
        )
        else 0
      end
  );
end;
$$;


-- ============================================================
-- 3. Security
-- ============================================================

revoke all
on function
  public.resolve_staff_post_close_review(
    uuid,
    uuid,
    text[],
    bigint,
    text,
    text,
    text,
    text,
    jsonb,
    text,
    timestamptz
  )
from public, anon, authenticated;


grant execute
on function
  public.resolve_staff_post_close_review(
    uuid,
    uuid,
    text[],
    bigint,
    text,
    text,
    text,
    text,
    jsonb,
    text,
    timestamptz
  )
to service_role;
