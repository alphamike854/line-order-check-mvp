-- R2D2C
-- Atomic Staff Review resolution ownership guard.
--
-- Goals:
--   1. Staff must still be active.
--   2. Review must still be OPEN.
--   3. Message must still belong to the current OPEN settlement.
--   4. Message must still belong to the latest Summary Group Round.
--   5. Settlement LINE Group snapshot must still match.
--   6. Staff assignment must still authorize the LINE Group.
--   7. Staff must own a non-expired claim.
--   8. expected lease_version is mandatory.
--   9. Resolve/Ignore + claim cleanup happen in one DB transaction.
--
-- Legacy Dashboard RPC signatures are intentionally unchanged.


-- ============================================================
-- Shared atomic guard
-- ============================================================

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
  from public.settlement_line_group_config cfg
  where
    cfg.settlement_session_id =
      p_settlement_session_id
    and cfg.line_group_id =
      v_message.line_group_id
    and cfg.summary_group_id =
      v_message.summary_group_id;


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


-- ============================================================
-- Staff CORRECT wrapper
-- ============================================================

create or replace function
  public.resolve_staff_review_with_preview(
    p_review_id bigint,
    p_corrected_text text,
    p_parser_version text,
    p_items jsonb,
    p_resolved_by text,
    p_preview_fingerprint text,
    p_previewed_at timestamptz,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_result jsonb;
begin
  v_message_id :=
    public.assert_staff_review_resolution_claim(
      p_review_id,
      p_staff_id,
      p_allowed_line_group_ids,
      p_settlement_session_id,
      p_expected_lease_version
    );


  -- Existing audited Preview + correction semantics remain
  -- authoritative and run inside this same transaction.
  v_result :=
    public.resolve_review_with_preview(
      p_review_id,
      p_corrected_text,
      p_parser_version,
      p_items,
      p_resolved_by,
      p_preview_fingerprint,
      p_previewed_at
    );


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      v_message_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  if not found then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return
    v_result
    || jsonb_build_object(
      'claim_released',
        true,
      'lease_version',
        p_expected_lease_version
    );
end;
$$;


-- ============================================================
-- Staff IGNORE wrapper
-- ============================================================

create or replace function
  public.ignore_staff_review(
    p_review_id bigint,
    p_resolved_by text,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message_id uuid;
  v_result jsonb;
begin
  v_message_id :=
    public.assert_staff_review_resolution_claim(
      p_review_id,
      p_staff_id,
      p_allowed_line_group_ids,
      p_settlement_session_id,
      p_expected_lease_version
    );


  -- Preserve the existing audited IGNORE implementation.
  v_result :=
    public.ignore_review(
      p_review_id,
      p_resolved_by
    );


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      v_message_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  if not found then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return
    v_result
    || jsonb_build_object(
      'claim_released',
        true,
      'lease_version',
        p_expected_lease_version
    );
end;
$$;


-- ============================================================
-- Security boundary
-- ============================================================

revoke all
on function
  public.assert_staff_review_resolution_claim(
    bigint,
    uuid,
    text[],
    uuid,
    bigint
  )
from public, anon, authenticated;


grant execute
on function
  public.assert_staff_review_resolution_claim(
    bigint,
    uuid,
    text[],
    uuid,
    bigint
  )
to service_role;


revoke all
on function
  public.resolve_staff_review_with_preview(
    bigint,
    text,
    text,
    jsonb,
    text,
    text,
    timestamptz,
    uuid,
    text[],
    uuid,
    bigint
  )
from public, anon, authenticated;


grant execute
on function
  public.resolve_staff_review_with_preview(
    bigint,
    text,
    text,
    jsonb,
    text,
    text,
    timestamptz,
    uuid,
    text[],
    uuid,
    bigint
  )
to service_role;


revoke all
on function
  public.ignore_staff_review(
    bigint,
    text,
    uuid,
    text[],
    uuid,
    bigint
  )
from public, anon, authenticated;


grant execute
on function
  public.ignore_staff_review(
    bigint,
    text,
    uuid,
    text[],
    uuid,
    bigint
  )
to service_role;
