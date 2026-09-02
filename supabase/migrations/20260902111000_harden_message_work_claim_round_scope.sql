-- R2D2A Hardening
-- Bind message work claims to:
--   1. current OPEN settlement container
--   2. latest Summary Group round inside that settlement
--   3. settlement LINE Group snapshot
--
-- The latest Summary Group round may be OPEN or CLOSED.
-- This preserves the accepted workflow where pre-close work remains
-- reviewable after Summary Group close, until the next same-group open/reset.
--
-- Compatibility overloads remain temporarily available so an older deployed
-- API cannot bypass the new boundary during DB -> API rollout.

-- ============================================================
-- New authoritative CLAIM overload.
-- ============================================================

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


-- ============================================================
-- Compatibility CLAIM overload.
--
-- Existing deployed API has no settlement argument.
-- It is NOT allowed to bypass the hardening. Instead it derives
-- the current OPEN settlement server-side and delegates to the
-- authoritative overload above.
-- ============================================================

create or replace function
  public.claim_staff_review_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_lease_seconds integer default 300
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;

begin
  select s.id
  into v_session_id
  from public.settlement_sessions s
  where
    s.status = 'OPEN'
  order by
    s.opened_at desc
  limit 1;


  if v_session_id is null then
    raise exception
      'NO_OPEN_SETTLEMENT';
  end if;


  return public.claim_staff_review_work(
    p_message_record_id,
    p_staff_id,
    p_allowed_line_group_ids,
    v_session_id,
    p_lease_seconds
  );
end;
$$;


-- ============================================================
-- New authoritative RELEASE overload.
--
-- Release does not require Review OPEN because an item may have
-- been resolved while a lease still exists. It does require the
-- message to remain in the current settlement/latest round.
-- ============================================================

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


-- ============================================================
-- Compatibility RELEASE overload.
-- ============================================================

create or replace function
  public.release_staff_review_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_expected_lease_version bigint default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;

begin
  select s.id
  into v_session_id
  from public.settlement_sessions s
  where
    s.status = 'OPEN'
  order by
    s.opened_at desc
  limit 1;


  if v_session_id is null then
    raise exception
      'NO_OPEN_SETTLEMENT';
  end if;


  return public.release_staff_review_work(
    p_message_record_id,
    p_staff_id,
    v_session_id,
    p_expected_lease_version
  );
end;
$$;


-- ============================================================
-- Security boundary for both authoritative and compatibility
-- overloads.
-- ============================================================

revoke all
on function public.claim_staff_review_work(
  uuid,
  uuid,
  text[],
  uuid,
  integer
)
from public, anon, authenticated;

grant execute
on function public.claim_staff_review_work(
  uuid,
  uuid,
  text[],
  uuid,
  integer
)
to service_role;


revoke all
on function public.claim_staff_review_work(
  uuid,
  uuid,
  text[],
  integer
)
from public, anon, authenticated;

grant execute
on function public.claim_staff_review_work(
  uuid,
  uuid,
  text[],
  integer
)
to service_role;


revoke all
on function public.release_staff_review_work(
  uuid,
  uuid,
  uuid,
  bigint
)
from public, anon, authenticated;

grant execute
on function public.release_staff_review_work(
  uuid,
  uuid,
  uuid,
  bigint
)
to service_role;


revoke all
on function public.release_staff_review_work(
  uuid,
  uuid,
  bigint
)
from public, anon, authenticated;

grant execute
on function public.release_staff_review_work(
  uuid,
  uuid,
  bigint
)
to service_role;
