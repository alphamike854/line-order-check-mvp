-- V14B2B
-- Review / Human Verification immutable Round-lineage cutover.
--
-- Accepted message routing is owned by summary_group_round_id.
-- Current routing remains admission-only and may change after
-- a Round boundary.
--
-- This migration replaces only seven session-scoped CORE RPCs.
-- Compatibility overload wrappers are preserved unchanged.

begin;

do $v14b2b_guard$
begin
  if exists (
    select 1
    from public.messages m
    where
      m.summary_group_round_id is not null
      and not exists (
        select 1
        from public.settlement_line_group_round_config lineage
        where
          lineage.round_id =
            m.summary_group_round_id
          and lineage.line_group_id =
            m.line_group_id
      )
  ) then
    raise exception
      'V14B2B_MESSAGE_LINEAGE_REQUIRED';
  end if;

  if exists (
    select 1
    from public.order_items oi
    where
      oi.summary_group_round_id is not null
      and not exists (
        select 1
        from public.settlement_line_group_round_config lineage
        where
          lineage.round_id =
            oi.summary_group_round_id
          and lineage.line_group_id =
            oi.line_group_id
      )
  ) then
    raise exception
      'V14B2B_ORDER_ITEM_LINEAGE_REQUIRED';
  end if;
end
$v14b2b_guard$;


-- ------------------------------------------------------------
-- CORE: assert_staff_review_resolution_claim(p_review_id bigint, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint)
-- ------------------------------------------------------------

create or replace function
  public.assert_staff_review_resolution_claim(
    p_review_id bigint,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint
  )
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;

  v_lock_settlement_session_id uuid;

  v_lock_summary_group_id text;

  v_review
    public.review_items%rowtype;

  v_message
    public.messages%rowtype;

  v_staff
    public.staff_accounts%rowtype;

  v_latest_round_id uuid;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_now timestamptz;
begin
  if p_review_id is null
     or p_review_id <= 0
  then
    raise exception
      'INVALID_REVIEW_ID';
  end if;


  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  if p_expected_lease_version is null
     or p_expected_lease_version <= 0
  then
    raise exception
      'LEASE_VERSION_REQUIRED';
  end if;


  -- Resolve only the identities required to acquire the same
  -- lifecycle boundaries used by OPEN_GROUP / CLOSE_GROUP.
  --
  -- This preliminary read does NOT authorize the operation.
  -- Review + Message are re-read under row locks below.
  select
    r.message_record_id,
    m.settlement_session_id,
    m.summary_group_id
  into
    v_message_id,
    v_lock_settlement_session_id,
    v_lock_summary_group_id
  from public.review_items r
  join public.messages m
    on m.id =
      r.message_record_id
  where
    r.id = p_review_id;


  if not found then
    raise exception
      'REVIEW_NOT_FOUND';
  end if;


  if v_lock_settlement_session_id
       is distinct from
       p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if coalesce(
       trim(
         v_lock_summary_group_id
       ),
       ''
     ) = ''
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Lock order MUST match Summary Group lifecycle:
  --
  --   global settlement
  --     -> Summary Group
  --     -> message Staff claim
  --
  -- Once these locks are held, OPEN_GROUP / CLOSE_GROUP cannot
  -- advance this Summary Group Round until Staff resolution
  -- commits or rolls back.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        p_settlement_session_id::text,
        v_lock_summary_group_id
      ),
      0
    )
  );


  -- Serialize Claim / Renew / Release / Resolve for the exact
  -- message only after the lifecycle boundaries are held.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || v_message_id::text,
      0
    )
  );


  -- Preserve the same row-lock order as the existing Review
  -- mutation functions: Review -> Message.
  select
    r.*
  into
    v_review
  from public.review_items r
  where
    r.id = p_review_id
  for update;


  if not found then
    raise exception
      'REVIEW_NOT_FOUND';
  end if;


  if v_review.status <> 'OPEN' then
    raise exception
      'REVIEW_NOT_OPEN';
  end if;


  if v_review.message_record_id
       is distinct from
       v_message_id
  then
    raise exception
      'REVIEW_MESSAGE_CHANGED';
  end if;


  select
    m.*
  into
    v_message
  from public.messages m
  where
    m.id = v_message_id
  for update;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if v_message.summary_group_id
       is distinct from
       v_lock_summary_group_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Hold the OPEN settlement state through the transaction.
  perform 1
  from public.settlement_sessions s
  where
    s.id = p_settlement_session_id
    and s.status = 'OPEN'
  for share;


  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  if v_message.settlement_session_id
       is distinct from
       p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  -- Hold Staff active state through the transaction.
  select
    s.*
  into
    v_staff
  from public.staff_accounts s
  where
    s.id = p_staff_id
    and s.enabled = true
  for share;


  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  -- Server-resolved scope passed by the API remains mandatory.
  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  -- Re-check the authoritative settlement snapshot.
  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;


  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  -- Non-admin Staff must still have the assignment at mutation time.
  -- FOR SHARE prevents the assignment row from being changed until
  -- this transaction finishes.
  if upper(
       coalesce(
         v_staff.role,
         ''
       )
     ) <> 'ADMIN'
  then
    perform 1
    from public.line_group_staff_assignments a
    where
      a.staff_id = p_staff_id
      and a.line_group_id =
        v_message.line_group_id
      and a.enabled = true
    for share;


    if not found then
      raise exception
        'MESSAGE_OUTSIDE_STAFF_SCOPE';
    end if;
  end if;


  -- Latest Round is authoritative whether that Round is OPEN or
  -- CLOSED. This matches the existing Staff Workbench semantics.
  select
    r.id
  into
    v_latest_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_message.summary_group_id
  order by
    r.round_no desc
  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
         is distinct from
         v_latest_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Claim is checked only after all authoritative ownership scope
  -- has been verified. Row lock plus the advisory lock serializes
  -- Claim/Renew/Release/Resolve for this message.
  select
    c.*
  into
    v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      v_message.id
  for update;


  if not found then
    raise exception
      'CLAIM_REQUIRED';
  end if;


  v_now :=
    clock_timestamp();


  if v_claim.claim_expires_at <= v_now then
    raise exception
      'CLAIM_EXPIRED';
  end if;


  if v_claim.staff_id
       is distinct from
       p_staff_id
  then
    raise exception
      'CLAIM_OWNED_BY_OTHER';
  end if;


  if v_claim.lease_version
       is distinct from
       p_expected_lease_version
  then
    raise exception
      'STALE_CLAIM_VERSION';
  end if;


  return
    v_message.id;
end;
$$;


-- ------------------------------------------------------------
-- CORE: claim_staff_review_work(p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_lease_seconds integer)
-- ------------------------------------------------------------

create or replace function
  public.claim_staff_review_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_lease_seconds integer default 300
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz :=
    clock_timestamp();

  v_lease_seconds integer;

  v_staff
    public.staff_accounts%rowtype;

  v_message
    public.messages%rowtype;

  v_review
    public.review_items%rowtype;

  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_latest_round_id uuid;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_holder_name text;
  v_result text;

begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;

  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;

  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  perform 1
  from public.settlement_sessions s
  where
    s.id = p_settlement_session_id
    and s.status = 'OPEN';

  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  v_lease_seconds :=
    greatest(
      60,
      least(
        coalesce(
          p_lease_seconds,
          300
        ),
        1800
      )
    );


  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id = p_staff_id
    and s.enabled = true;

  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  select m.*
  into v_message
  from public.messages m
  where
    m.id = p_message_record_id;

  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  -- Historical settlement messages are never actionable
  -- through the current Workbench.
  if v_message.settlement_session_id
       is distinct from
       p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Validate authoritative message Round ownership.
  select r.*
  into v_round
  from public.settlement_summary_group_rounds r
  where
    r.id =
      v_message.summary_group_round_id

    and r.settlement_session_id =
      p_settlement_session_id

    and r.summary_group_id =
      v_message.summary_group_id;

  if not found then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- The Workbench follows the latest round, regardless of
  -- OPEN/CLOSED Summary Group lifecycle state.
  select r.id
  into v_latest_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id

    and r.summary_group_id =
      v_message.summary_group_id

  order by
    r.round_no desc

  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
         is distinct from
         v_latest_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- LINE Group must belong to the same Summary Group in this
  -- settlement snapshot. Live line_groups is not authoritative here.
  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  select r.*
  into v_review
  from public.review_items r
  where
    r.message_record_id =
      p_message_record_id

    and r.status = 'OPEN';

  if not found then
    raise exception
      'REVIEW_NOT_OPEN';
  end if;


  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;


  if not found then
    insert into
      public.staff_message_work_claims (
        message_record_id,
        staff_id,
        claimed_at,
        claim_expires_at,
        lease_version,
        updated_at
      )
    values (
      p_message_record_id,
      p_staff_id,
      v_now,
      v_now
        + make_interval(
            secs => v_lease_seconds
          ),
      1,
      v_now
    )
    returning *
    into v_claim;

    v_result :=
      'CLAIMED';


  elsif
    v_claim.staff_id =
      p_staff_id
  then
    update
      public.staff_message_work_claims
    set
      claim_expires_at =
        v_now
        + make_interval(
            secs => v_lease_seconds
          ),

      lease_version =
        lease_version + 1,

      updated_at =
        v_now

    where
      message_record_id =
        p_message_record_id

    returning *
    into v_claim;

    v_result :=
      'RENEWED';


  elsif
    v_claim.claim_expires_at
      <= v_now
  then
    update
      public.staff_message_work_claims
    set
      staff_id =
        p_staff_id,

      claimed_at =
        v_now,

      claim_expires_at =
        v_now
        + make_interval(
            secs => v_lease_seconds
          ),

      lease_version =
        lease_version + 1,

      updated_at =
        v_now

    where
      message_record_id =
        p_message_record_id

    returning *
    into v_claim;

    v_result :=
      'CLAIMED';


  else
    select s.display_name
    into v_holder_name
    from public.staff_accounts s
    where
      s.id =
        v_claim.staff_id;


    return jsonb_build_object(
      'ok',
        false,

      'status',
        'BUSY',

      'message_record_id',
        p_message_record_id,

      'claimed_by_staff_id',
        v_claim.staff_id,

      'claimed_by_display_name',
        v_holder_name,

      'claim_expires_at',
        v_claim.claim_expires_at,

      'lease_version',
        v_claim.lease_version
    );
  end if;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      v_result,

    'message_record_id',
      v_claim.message_record_id,

    'staff_id',
      v_claim.staff_id,

    'claimed_at',
      v_claim.claimed_at,

    'claim_expires_at',
      v_claim.claim_expires_at,

    'lease_version',
      v_claim.lease_version
  );
end;
$$;


-- ------------------------------------------------------------
-- CORE: release_staff_review_work(p_message_record_id uuid, p_staff_id uuid, p_settlement_session_id uuid, p_expected_lease_version bigint)
-- ------------------------------------------------------------

create or replace function
  public.release_staff_review_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_settlement_session_id uuid,
    p_expected_lease_version bigint default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message
    public.messages%rowtype;

  v_latest_round_id uuid;

  v_claim
    public.staff_message_work_claims%rowtype;

begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;

  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;

  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  perform 1
  from public.settlement_sessions s
  where
    s.id = p_settlement_session_id
    and s.status = 'OPEN';

  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      p_message_record_id;

  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if v_message.settlement_session_id
       is distinct from
       p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  select r.id
  into v_latest_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id

    and r.summary_group_id =
      v_message.summary_group_id

  order by
    r.round_no desc

  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
         is distinct from
         v_latest_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;


  if not found then
    return jsonb_build_object(
      'ok',
        true,

      'status',
        'NOT_CLAIMED',

      'message_record_id',
        p_message_record_id
    );
  end if;


  if v_claim.staff_id
       <> p_staff_id
  then
    return jsonb_build_object(
      'ok',
        false,

      'status',
        'CLAIM_OWNED_BY_OTHER',

      'message_record_id',
        p_message_record_id,

      'claimed_by_staff_id',
        v_claim.staff_id,

      'claim_expires_at',
        v_claim.claim_expires_at,

      'lease_version',
        v_claim.lease_version
    );
  end if;


  if
    p_expected_lease_version
      is not null

    and p_expected_lease_version
      <> v_claim.lease_version
  then
    return jsonb_build_object(
      'ok',
        false,

      'status',
        'STALE_CLAIM_VERSION',

      'message_record_id',
        p_message_record_id,

      'lease_version',
        v_claim.lease_version
    );
  end if;


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      p_message_record_id;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      'RELEASED',

    'message_record_id',
      p_message_record_id,

    'lease_version',
      v_claim.lease_version
  );
end;
$$;


-- ------------------------------------------------------------
-- CORE: claim_staff_message_verification_work(p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_lease_seconds integer)
-- ------------------------------------------------------------

create or replace function
  public.claim_staff_message_verification_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_lease_seconds integer default 300
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz :=
    clock_timestamp();

  v_lease_seconds integer;

  v_staff
    public.staff_accounts%rowtype;

  v_message
    public.messages%rowtype;

  v_latest_round_id uuid;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_holder_name text;
  v_result text;
  v_claim_version bigint;
begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  perform 1
  from public.settlement_sessions s
  where
    s.id =
      p_settlement_session_id
    and s.status =
      'OPEN';

  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  v_lease_seconds :=
    greatest(
      60,
      least(
        coalesce(
          p_lease_seconds,
          300
        ),
        1800
      )
    );


  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id =
      p_staff_id
    and s.enabled =
      true;

  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      p_message_record_id;

  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id
      is distinct from
      p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  select r.id
  into v_latest_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_message.summary_group_id
  order by
    r.round_no desc
  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from
      v_latest_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  if exists (
    select 1
    from public.message_verifications mv
    where
      mv.message_record_id =
        p_message_record_id
  ) then
    raise exception
      'MESSAGE_ALREADY_VERIFIED';
  end if;


  if v_message.parse_status <> 'PARSED' then
    raise exception
      'MESSAGE_NOT_READY_FOR_VERIFICATION';
  end if;


  if not exists (
    select 1
    from public.order_items oi
    where
      oi.message_record_id =
        p_message_record_id
  ) then
    raise exception
      'MESSAGE_HAS_NO_ORDER_ITEMS';
  end if;


  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;


  if not found then
    update public.messages
    set verification_claim_version =
      greatest(
        verification_claim_version + 1,
        floor(
          extract(
            epoch from clock_timestamp()
          ) * 1000000
        )::bigint
      )
    where id =
      p_message_record_id
    returning
      verification_claim_version
    into
      v_claim_version;


    insert into
      public.staff_message_work_claims (
        message_record_id,
        staff_id,
        claimed_at,
        claim_expires_at,
        lease_version,
        updated_at
      )
    values (
      p_message_record_id,
      p_staff_id,
      v_now,
      v_now
        + make_interval(
            secs => v_lease_seconds
          ),
      v_claim_version,
      v_now
    )
    returning *
    into v_claim;

    v_result :=
      'CLAIMED';


  elsif v_claim.staff_id =
    p_staff_id
  then
    update public.messages
    set verification_claim_version =
      greatest(
        verification_claim_version + 1,
        floor(
          extract(
            epoch from clock_timestamp()
          ) * 1000000
        )::bigint,
        v_claim.lease_version + 1
      )
    where id =
      p_message_record_id
    returning
      verification_claim_version
    into
      v_claim_version;


    update
      public.staff_message_work_claims
    set
      claim_expires_at =
        v_now
        + make_interval(
            secs => v_lease_seconds
          ),

      lease_version =
        v_claim_version,

      updated_at =
        v_now
    where
      message_record_id =
        p_message_record_id
    returning *
    into v_claim;

    v_result :=
      'RENEWED';


  elsif v_claim.claim_expires_at <=
    v_now
  then
    update public.messages
    set verification_claim_version =
      greatest(
        verification_claim_version + 1,
        floor(
          extract(
            epoch from clock_timestamp()
          ) * 1000000
        )::bigint,
        v_claim.lease_version + 1
      )
    where id =
      p_message_record_id
    returning
      verification_claim_version
    into
      v_claim_version;


    update
      public.staff_message_work_claims
    set
      staff_id =
        p_staff_id,

      claimed_at =
        v_now,

      claim_expires_at =
        v_now
        + make_interval(
            secs => v_lease_seconds
          ),

      lease_version =
        v_claim_version,

      updated_at =
        v_now
    where
      message_record_id =
        p_message_record_id
    returning *
    into v_claim;

    v_result :=
      'CLAIMED';


  else
    select s.display_name
    into v_holder_name
    from public.staff_accounts s
    where
      s.id =
        v_claim.staff_id;

    return jsonb_build_object(
      'ok',
        false,

      'status',
        'BUSY',

      'message_record_id',
        p_message_record_id,

      'claimed_by_staff_id',
        v_claim.staff_id,

      'claimed_by_display_name',
        v_holder_name,

      'claim_expires_at',
        v_claim.claim_expires_at,

      'lease_version',
        v_claim.lease_version
    );
  end if;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      v_result,

    'message_record_id',
      v_claim.message_record_id,

    'staff_id',
      v_claim.staff_id,

    'claimed_at',
      v_claim.claimed_at,

    'claim_expires_at',
      v_claim.claim_expires_at,

    'lease_version',
      v_claim.lease_version
  );
end;
$$;


-- ------------------------------------------------------------
-- CORE: verify_staff_message_order(p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint, p_expected_parser_version text, p_expected_normalized_text text, p_expected_order_items jsonb)
-- ------------------------------------------------------------

create or replace function
  public.verify_staff_message_order(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint,
    p_expected_parser_version text,
    p_expected_normalized_text text,
    p_expected_order_items jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz :=
    clock_timestamp();

  v_staff
    public.staff_accounts%rowtype;

  v_message
    public.messages%rowtype;

  v_latest_round_id uuid;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_current_order_items jsonb;
begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  if
    p_expected_lease_version is null
    or p_expected_lease_version <= 0
  then
    raise exception
      'LEASE_VERSION_REQUIRED';
  end if;


  perform 1
  from public.settlement_sessions s
  where
    s.id =
      p_settlement_session_id
    and s.status =
      'OPEN';

  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id =
      p_staff_id
    and s.enabled =
      true;

  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      p_message_record_id
  for update;

  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id
      is distinct from
      p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  select r.id
  into v_latest_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_message.summary_group_id
  order by
    r.round_no desc
  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from
      v_latest_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  if v_message.parse_status <> 'PARSED' then
    raise exception
      'MESSAGE_NOT_READY_FOR_VERIFICATION';
  end if;


  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category',
            oi.category,
          'code',
            oi.code,
          'quantity',
            oi.quantity
        )
        order by
          oi.category,
          oi.code,
          oi.quantity
      ),
      '[]'::jsonb
    )
  into
    v_current_order_items
  from public.order_items oi
  where
    oi.message_record_id =
      p_message_record_id;


  if jsonb_array_length(
    v_current_order_items
  ) = 0 then
    raise exception
      'MESSAGE_HAS_NO_ORDER_ITEMS';
  end if;


  if
    p_expected_order_items is null
    or v_current_order_items
      is distinct from
      p_expected_order_items
  then
    raise exception
      'VERIFICATION_SOURCE_CHANGED';
  end if;


  if
    v_message.parser_version
      is distinct from
      p_expected_parser_version

    or v_message.normalized_text
      is distinct from
      p_expected_normalized_text
  then
    raise exception
      'VERIFICATION_SOURCE_CHANGED';
  end if;


  if exists (
    select 1
    from public.message_verifications mv
    where
      mv.message_record_id =
        p_message_record_id
  ) then
    raise exception
      'MESSAGE_ALREADY_VERIFIED';
  end if;


  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;

  if not found then
    raise exception
      'CLAIM_REQUIRED';
  end if;


  if v_claim.claim_expires_at <= v_now then
    raise exception
      'CLAIM_EXPIRED';
  end if;


  if v_claim.staff_id
    is distinct from
    p_staff_id
  then
    raise exception
      'CLAIM_OWNED_BY_OTHER';
  end if;


  if v_claim.lease_version
    is distinct from
    p_expected_lease_version
  then
    raise exception
      'STALE_CLAIM_VERSION';
  end if;


  insert into
    public.message_verifications (
      message_record_id,
      verified_at,
      verified_by_staff_id,
      verified_by_staff_code,
      verified_by_display_name,
      verified_parser_version,
      verified_normalized_text,
      verified_order_items
    )
  values (
    p_message_record_id,
    v_now,
    v_staff.id,
    v_staff.staff_code,
    v_staff.display_name,
    v_message.parser_version,
    v_message.normalized_text,
    v_current_order_items
  );


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      p_message_record_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  if not found then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      'VERIFIED',

    'message_record_id',
      p_message_record_id,

    'verified_at',
      v_now,

    'verified_by_staff_id',
      v_staff.id,

    'verified_by_staff_code',
      v_staff.staff_code,

    'verified_by_display_name',
      v_staff.display_name,

    'parser_version',
      v_message.parser_version
  );
end;
$$;


-- ------------------------------------------------------------
-- CORE: correct_staff_message_verification_order(p_message_record_id uuid, p_staff_id uuid, p_allowed_line_group_ids text[], p_settlement_session_id uuid, p_expected_lease_version bigint, p_expected_parser_version text, p_expected_normalized_text text, p_expected_order_items jsonb, p_corrected_text text, p_corrected_parser_version text, p_corrected_normalized_text text, p_corrected_order_items jsonb, p_corrected_first_order_code text)
-- ------------------------------------------------------------

create or replace function
  public.correct_staff_message_verification_order(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint,
    p_expected_parser_version text,
    p_expected_normalized_text text,
    p_expected_order_items jsonb,
    p_corrected_text text,
    p_corrected_parser_version text,
    p_corrected_normalized_text text,
    p_corrected_order_items jsonb,
    p_corrected_first_order_code text
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz :=
    clock_timestamp();

  v_lock_settlement_session_id uuid;
  v_lock_summary_group_id text;
  v_lock_round_id uuid;

  v_message
    public.messages%rowtype;

  v_staff
    public.staff_accounts%rowtype;

  v_latest_round_id uuid;
  v_latest_round_status text;

  v_canonical_mutation_applied boolean :=
    false;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_current_order_items jsonb;
  v_corrected_order_items jsonb;

  v_item jsonb;
  v_category text;
  v_code text;
  v_quantity integer;
  v_key text;

  v_seen_keys text[] :=
    array[]::text[];

  v_inserted integer := 0;
begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  if
    p_expected_lease_version is null
    or p_expected_lease_version <= 0
  then
    raise exception
      'LEASE_VERSION_REQUIRED';
  end if;


  if coalesce(
    btrim(p_expected_parser_version),
    ''
  ) = '' then
    raise exception
      'PARSER_VERSION_REQUIRED';
  end if;


  if p_expected_normalized_text is null then
    raise exception
      'NORMALIZED_TEXT_REQUIRED';
  end if;


  if
    p_expected_order_items is null
    or jsonb_typeof(
      p_expected_order_items
    ) <> 'array'
    or jsonb_array_length(
      p_expected_order_items
    ) = 0
  then
    raise exception
      'ORDER_ITEMS_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_text),
    ''
  ) = '' then
    raise exception
      'CORRECTED_TEXT_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_parser_version),
    ''
  ) = '' then
    raise exception
      'CORRECTED_PARSER_VERSION_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_normalized_text),
    ''
  ) = '' then
    raise exception
      'CORRECTED_NORMALIZED_TEXT_REQUIRED';
  end if;


  if
    p_corrected_order_items is null
    or jsonb_typeof(
      p_corrected_order_items
    ) <> 'array'
    or jsonb_array_length(
      p_corrected_order_items
    ) = 0
  then
    raise exception
      'CORRECTED_ORDER_ITEMS_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_first_order_code),
    ''
  ) = '' then
    raise exception
      'CORRECTED_FIRST_ORDER_CODE_REQUIRED';
  end if;


  -- Resolve only the identities required for lifecycle locks.
  -- This preliminary read does not authorize the operation.
  select
    m.settlement_session_id,
    m.summary_group_id,
    m.summary_group_round_id
  into
    v_lock_settlement_session_id,
    v_lock_summary_group_id,
    v_lock_round_id
  from public.messages m
  where
    m.id =
      p_message_record_id;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_lock_settlement_session_id
      is distinct from
        p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_lock_summary_group_id is null
    or v_lock_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Lock order matches Summary Group lifecycle mutation:
  --
  -- global settlement
  --   -> Summary Group
  --   -> exact message Staff claim
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        p_settlement_session_id::text,
        v_lock_summary_group_id
      ),
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  -- Parent settlement remains OPEN for the entire transaction.
  perform 1
  from public.settlement_sessions s
  where
    s.id =
      p_settlement_session_id
    and s.status =
      'OPEN'
  for share;


  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  -- Hold Staff active state through the mutation.
  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id =
      p_staff_id
    and s.enabled =
      true
  for share;


  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  -- Message snapshot is authoritative.
  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      p_message_record_id
  for update;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id
      is distinct from
        p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  if
    v_message.summary_group_id
      is distinct from
        v_lock_summary_group_id
    or
    v_message.summary_group_round_id
      is distinct from
        v_lock_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  if v_message.parse_status <> 'PARSED' then
    raise exception
      'MESSAGE_NOT_READY_FOR_VERIFICATION';
  end if;


  -- Server-resolved LINE Group scope is mandatory.
  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  -- Settlement mapping must still match the message snapshot.
  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;


  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  -- Non-admin Staff must still own the LINE Group.
  if upper(
    coalesce(
      v_staff.role,
      ''
    )
  ) <> 'ADMIN'
  then
    perform 1
    from public.line_group_staff_assignments a
    where
      a.staff_id =
        p_staff_id
      and a.line_group_id =
        v_message.line_group_id
      and a.enabled =
        true
    for share;


    if not found then
      raise exception
        'MESSAGE_OUTSIDE_STAFF_SCOPE';
    end if;
  end if;


  -- Latest Round is authoritative even when that latest Round
  -- has already CLOSED. Intake close must not block Human
  -- Verification, but CLOSED canonical rows remain immutable.
  select
    r.id,
    r.status
  into
    v_latest_round_id,
    v_latest_round_status
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_message.summary_group_id
  order by
    r.round_no desc
  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from
        v_latest_round_id
    or v_latest_round_status
      not in (
        'OPEN',
        'CLOSED'
      )
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Exact ORIGINAL parser proposal.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category',
            oi.category,
          'code',
            oi.code,
          'quantity',
            oi.quantity
        )
        order by
          oi.category,
          oi.code,
          oi.quantity
      ),
      '[]'::jsonb
    )
  into
    v_current_order_items
  from public.order_items oi
  where
    oi.message_record_id =
      p_message_record_id;


  if jsonb_array_length(
    v_current_order_items
  ) = 0 then
    raise exception
      'MESSAGE_HAS_NO_ORDER_ITEMS';
  end if;


  if
    v_current_order_items
      is distinct from
        p_expected_order_items
    or v_message.parser_version
      is distinct from
        p_expected_parser_version
    or v_message.normalized_text
      is distinct from
        p_expected_normalized_text
  then
    raise exception
      'VERIFICATION_SOURCE_CHANGED';
  end if;


  if exists (
    select 1
    from public.message_verifications mv
    where
      mv.message_record_id =
        p_message_record_id
  ) then
    raise exception
      'MESSAGE_ALREADY_VERIFIED';
  end if;


  -- Exact lease ownership.
  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;


  if not found then
    raise exception
      'CLAIM_REQUIRED';
  end if;


  if v_claim.claim_expires_at <= v_now then
    raise exception
      'CLAIM_EXPIRED';
  end if;


  if
    v_claim.staff_id
      is distinct from
        p_staff_id
  then
    raise exception
      'CLAIM_OWNED_BY_OTHER';
  end if;


  if
    v_claim.lease_version
      is distinct from
        p_expected_lease_version
  then
    raise exception
      'STALE_CLAIM_VERSION';
  end if;


  -- Validate corrected parser proposal before touching canonical rows.
  for v_item in
    select value
    from jsonb_array_elements(
      p_corrected_order_items
    )
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception
        'INVALID_CORRECTED_ITEM';
    end if;


    v_category :=
      upper(
        btrim(
          v_item ->> 'category'
        )
      );

    v_code :=
      btrim(
        v_item ->> 'code'
      );


    begin
      v_quantity :=
        (v_item ->> 'quantity')::integer;
    exception
      when others then
        raise exception
          'INVALID_CORRECTED_ITEM_QUANTITY';
    end;


    if v_category not in (
      'A',
      'B',
      'E',
      'F',
      'G',
      'H',
      'L'
    ) then
      raise exception
        'INVALID_CORRECTED_ITEM_CATEGORY';
    end if;


    if coalesce(
      v_code,
      ''
    ) = '' then
      raise exception
        'INVALID_CORRECTED_ITEM_CODE';
    end if;


    if v_quantity <= 0 then
      raise exception
        'INVALID_CORRECTED_ITEM_QUANTITY';
    end if;


    v_key :=
      v_category
      || '|'
      || v_code;


    if v_key = any(
      v_seen_keys
    ) then
      raise exception
        'DUPLICATE_CORRECTED_ITEM';
    end if;


    v_seen_keys :=
      array_append(
        v_seen_keys,
        v_key
      );
  end loop;


  -- OPEN Round:
  --
  -- Human correction becomes operational canonical truth.
  --
  -- CLOSED Round:
  --
  -- Closed canonical message/order rows are immutable. The corrected
  -- Human Truth is persisted only in message_verifications.
  if v_latest_round_status = 'OPEN' then

    delete from
      public.order_items
    where
      message_record_id =
        p_message_record_id;


    for v_item in
      select value
      from jsonb_array_elements(
        p_corrected_order_items
      )
    loop
      v_category :=
        upper(
          btrim(
            v_item ->> 'category'
          )
        );

      v_code :=
        btrim(
          v_item ->> 'code'
        );

      v_quantity :=
        (v_item ->> 'quantity')::integer;


      insert into public.order_items (
        message_record_id,
        business_date,
        line_group_id,
        summary_group_id,
        category,
        code,
        quantity,
        unsent_flag,
        parser_version,
        settlement_session_id
      )
      values (
        v_message.id,
        v_message.business_date,
        v_message.line_group_id,
        v_message.summary_group_id,
        v_category,
        v_code,
        v_quantity,
        false,
        p_corrected_parser_version,
        v_message.settlement_session_id
      );


      -- summary_group_round_id is deliberately omitted.
      -- order_items_round_ownership_trg inherits and validates
      -- immutable Round ownership from the authoritative message.
      v_inserted :=
        v_inserted + 1;
    end loop;


    if
      v_inserted
        <> jsonb_array_length(
          p_corrected_order_items
        )
    then
      raise exception
        'CORRECTED_ITEM_COUNT_MISMATCH';
    end if;


    update public.messages
    set
      normalized_text =
        p_corrected_normalized_text,
      parse_status =
        'PARSED',
      parser_version =
        p_corrected_parser_version,
      first_order_code =
        p_corrected_first_order_code
    where
      id =
        p_message_record_id;


    -- Re-read exactly what became operational canonical truth.
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',
              oi.category,
            'code',
              oi.code,
            'quantity',
              oi.quantity
          )
          order by
            oi.category,
            oi.code,
            oi.quantity
        ),
        '[]'::jsonb
      )
    into
      v_corrected_order_items
    from public.order_items oi
    where
      oi.message_record_id =
        p_message_record_id;


    if jsonb_array_length(
      v_corrected_order_items
    ) <> v_inserted then
      raise exception
        'CORRECTED_ITEM_COUNT_MISMATCH';
    end if;


    if
      v_corrected_order_items
        is distinct from
          p_corrected_order_items
    then
      raise exception
        'CORRECTED_CANONICAL_SNAPSHOT_MISMATCH';
    end if;


    v_canonical_mutation_applied :=
      true;

  elsif v_latest_round_status = 'CLOSED' then

    -- Human Truth may advance after intake close, but operational
    -- canonical rows from the closed Round must never be rewritten.
    v_corrected_order_items :=
      p_corrected_order_items;

    v_inserted :=
      jsonb_array_length(
        p_corrected_order_items
      );

    v_canonical_mutation_applied :=
      false;

  else
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Preserve both the parser proposal and final Human Truth.
  --
  -- Durable lifecycle identity is written explicitly here; the INSERT
  -- trigger independently enforces the same context from the live
  -- message and also serves the unchanged CONFIRMED verification RPC.
  insert into
    public.message_verifications (
      message_record_id,
      settlement_session_id,
      summary_group_id,
      summary_group_round_id,
      line_group_id,
      business_date,
      verified_at,
      verified_by_staff_id,
      verified_by_staff_code,
      verified_by_display_name,
      verified_parser_version,
      verified_normalized_text,
      verified_order_items,
      verified_first_order_code,
      verification_mode,
      source_parser_version,
      source_normalized_text,
      source_order_items,
      corrected_text,
      canonical_mutation_applied
    )
  values (
    p_message_record_id,
    v_message.settlement_session_id,
    v_message.summary_group_id,
    v_message.summary_group_round_id,
    v_message.line_group_id,
    v_message.business_date,
    v_now,
    v_staff.id,
    v_staff.staff_code,
    v_staff.display_name,
    p_corrected_parser_version,
    p_corrected_normalized_text,
    v_corrected_order_items,
    p_corrected_first_order_code,
    'CORRECTED',
    v_message.parser_version,
    v_message.normalized_text,
    v_current_order_items,
    p_corrected_text,
    v_canonical_mutation_applied
  );


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      p_message_record_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  if not found then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return jsonb_build_object(
    'ok',
      true,
    'status',
      'VERIFIED',
    'verification_mode',
      'CORRECTED',
    'message_record_id',
      p_message_record_id,
    'verified_at',
      v_now,
    'verified_by_staff_id',
      v_staff.id,
    'verified_by_staff_code',
      v_staff.staff_code,
    'verified_by_display_name',
      v_staff.display_name,
    'parser_version',
      p_corrected_parser_version,
    'first_order_code',
      p_corrected_first_order_code,
    'round_status',
      v_latest_round_status,
    'canonical_mutation_applied',
      v_canonical_mutation_applied,
    'items_count',
      v_inserted
  );

end;
$$;


-- ------------------------------------------------------------
-- CORE: resolve_review_with_items(p_review_id bigint, p_corrected_text text, p_parser_version text, p_items jsonb, p_resolved_by text)
-- ------------------------------------------------------------

create or replace function public.resolve_review_with_items(
  p_review_id bigint,
  p_corrected_text text,
  p_parser_version text,
  p_items jsonb,
  p_resolved_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.review_items%rowtype;
  v_message public.messages%rowtype;
  v_summary_group_id text;
  v_before_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_category text;
  v_code text;
  v_quantity integer;
  v_session_status text;
  v_latest_round_id uuid;
begin
  select r.* into v_review from public.review_items r where r.id=p_review_id for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.status <> 'OPEN' then raise exception 'REVIEW_NOT_OPEN'; end if;
  select m.* into v_message from public.messages m where m.id=v_review.message_record_id for update;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if v_message.unsent then raise exception 'MESSAGE_ALREADY_UNSENT'; end if;
  if v_message.settlement_session_id is null then raise exception 'MESSAGE_SETTLEMENT_NOT_ASSIGNED'; end if;
  select status into v_session_status from public.settlement_sessions where id=v_message.settlement_session_id;
  if v_session_status <> 'OPEN' then raise exception 'SETTLEMENT_NOT_OPEN'; end if;

  v_summary_group_id :=
    v_message.summary_group_id;

  if
    v_summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  perform 1
  from public.settlement_line_group_round_config lineage
  where
    lineage.round_id =
      v_message.summary_group_round_id
    and lineage.line_group_id =
      v_message.line_group_id;

  if not found then
    raise exception
      'MESSAGE_GROUP_NOT_CONFIGURED';
  end if;

  -- ----------------------------------------------------------
  -- Current Working Round boundary.
  --
  -- CLOSE_GROUP stops new intake only. Review/correction of an
  -- already-owned message remains valid while that message still
  -- belongs to the latest Summary Group Round, whether that Round
  -- is OPEN or CLOSED.
  --
  -- Opening the next Round supersedes the previous one.
  -- ----------------------------------------------------------
  if
    v_message.summary_group_round_id is null
    or v_message.summary_group_id
      is distinct from v_summary_group_id
  then
    raise exception 'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  select
    r.id
  into
    v_latest_round_id
  from
    public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      v_message.settlement_session_id
    and r.summary_group_id =
      v_summary_group_id
  order by
    r.round_no desc
  limit 1;

  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from v_latest_round_id
  then
    raise exception 'MESSAGE_ROUND_NOT_CURRENT';
  end if;

  -- Exact-message, transaction-local marker consumed only by
  -- enforce_order_item_summary_group_accepting().
  perform set_config(
    'line_order.current_working_round_review_message_id',
    v_message.id::text,
    true
  );

  if coalesce(trim(p_corrected_text),'')='' then raise exception 'CORRECTED_TEXT_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'PARSED_ITEMS_REQUIRED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('category',oi.category,'code',oi.code,'quantity',oi.quantity) order by oi.category,oi.code),'[]'::jsonb)
  into v_before_items from public.order_items oi where oi.message_record_id=v_message.id;
  delete from public.order_items where message_record_id=v_message.id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category:=upper(trim(v_item->>'category')); v_code:=trim(v_item->>'code');
    begin v_quantity:=(v_item->>'quantity')::integer; exception when others then raise exception 'INVALID_ITEM_QUANTITY'; end;
    if v_category not in ('A','B','E','F','G') or coalesce(v_code,'')='' or v_quantity<=0 then raise exception 'INVALID_PARSED_ITEM'; end if;
    insert into public.order_items(message_record_id,business_date,line_group_id,summary_group_id,category,code,quantity,unsent_flag,parser_version,settlement_session_id)
    values(v_message.id,v_message.business_date,v_message.line_group_id,v_summary_group_id,v_category,v_code,v_quantity,false,p_parser_version,v_message.settlement_session_id);
  end loop;

  update public.messages set normalized_text=p_corrected_text,parse_status='PARSED',parser_version=p_parser_version where id=v_message.id;
  update public.review_items set status='RESOLVED',resolved_at=now(),resolution_type='CORRECTED',corrected_text=p_corrected_text,resolved_by=p_resolved_by where id=v_review.id;
  insert into public.review_resolution_events(review_id,message_record_id,action,original_parse_status,corrected_text,before_items,after_items,resolved_by)
  values(v_review.id,v_message.id,'CORRECTED',v_message.parse_status,p_corrected_text,v_before_items,p_items,p_resolved_by);
  return jsonb_build_object('review_id',v_review.id,'message_record_id',v_message.id,'status','RESOLVED','resolution_type','CORRECTED','items_count',jsonb_array_length(p_items));
end;
$$;

-- Reassert server-only execution for replaced CORE signatures.

revoke all
on function public.assert_staff_review_resolution_claim(bigint, uuid, text[], uuid, bigint)
from public, anon, authenticated;

grant execute
on function public.assert_staff_review_resolution_claim(bigint, uuid, text[], uuid, bigint)
to service_role;

revoke all
on function public.claim_staff_review_work(uuid, uuid, text[], uuid, integer)
from public, anon, authenticated;

grant execute
on function public.claim_staff_review_work(uuid, uuid, text[], uuid, integer)
to service_role;

revoke all
on function public.release_staff_review_work(uuid, uuid, uuid, bigint)
from public, anon, authenticated;

grant execute
on function public.release_staff_review_work(uuid, uuid, uuid, bigint)
to service_role;

revoke all
on function public.claim_staff_message_verification_work(uuid, uuid, text[], uuid, integer)
from public, anon, authenticated;

grant execute
on function public.claim_staff_message_verification_work(uuid, uuid, text[], uuid, integer)
to service_role;

revoke all
on function public.verify_staff_message_order(uuid, uuid, text[], uuid, bigint, text, text, jsonb)
from public, anon, authenticated;

grant execute
on function public.verify_staff_message_order(uuid, uuid, text[], uuid, bigint, text, text, jsonb)
to service_role;

revoke all
on function public.correct_staff_message_verification_order(uuid, uuid, text[], uuid, bigint, text, text, jsonb, text, text, text, jsonb, text)
from public, anon, authenticated;

grant execute
on function public.correct_staff_message_verification_order(uuid, uuid, text[], uuid, bigint, text, text, jsonb, text, text, text, jsonb, text)
to service_role;

revoke all
on function public.resolve_review_with_items(bigint, text, text, jsonb, text)
from public, anon, authenticated;

grant execute
on function public.resolve_review_with_items(bigint, text, text, jsonb, text)
to service_role;

commit;
