-- R2E1 Human Verification Foundation
--
-- Business truth:
--   1. A message with summary_group_round_id IS NOT NULL was admitted
--      while that Summary Group round was OPEN.
--   2. parse_status describes machine interpretation only.
--   3. Human verification is a separate one-way state.
--   4. Existing Review semantics remain unchanged.
--
-- Phase scope:
--   - Human verification for PARSED messages only.
--   - REVIEW/PARTIAL/IGNORE correction workflow remains separate.
--   - Existing staff_message_work_claims table is reused.
--   - Existing claim_staff_review_work() is NOT replaced.

-- ============================================================
-- 0. Durable Human Verification claim generation
--
-- Lease fencing only. This is NOT Human Verification state.
-- It survives claim Release for the lifetime of the message.
-- ============================================================

alter table public.messages
  add column if not exists
    verification_claim_version bigint
    not null
    default 0;


alter table public.messages
  drop constraint if exists
    messages_verification_claim_version_check;


alter table public.messages
  add constraint
    messages_verification_claim_version_check
  check (
    verification_claim_version >= 0
  );


comment on column
  public.messages.verification_claim_version
is
  'Durable monotonic generation for Human Verification message claims. '
  'This is lease fencing only and is not Human Verification state.';


-- ============================================================
-- 1. One-to-one human verification result
-- ============================================================

create table if not exists
  public.message_verifications (
    message_record_id uuid primary key
      references public.messages(id)
      on delete cascade,

    verified_at timestamptz not null
      default clock_timestamp(),

    verified_by_staff_id uuid not null,

    verified_by_staff_code text not null,

    verified_by_display_name text not null,

    verified_parser_version text,

    verified_normalized_text text,

    verified_order_items jsonb not null
  );


create index if not exists
  message_verifications_verified_at_idx
on public.message_verifications (
  verified_at desc
);


comment on table
  public.message_verifications
is
  'One-way human confirmation of the current parsed order for one in-round message. Absence means PENDING; presence means VERIFIED.';


comment on column
  public.message_verifications.verified_by_staff_id
is
  'Staff UUID snapshot. Deliberately no FK so verification evidence is not invalidated by later Staff-account deletion.';


comment on column
  public.message_verifications.verified_parser_version
is
  'Parser version observed and confirmed by Staff at verification time.';


comment on column
  public.message_verifications.verified_normalized_text
is
  'Normalized order text observed and confirmed by Staff at verification time.';


comment on column
  public.message_verifications.verified_order_items
is
  'Canonical category/code/quantity items observed and confirmed by Staff at verification time.';


alter table
  public.message_verifications
enable row level security;


revoke all
on public.message_verifications
from anon, authenticated;


grant
  select
on public.message_verifications
to service_role;


-- ============================================================
-- 2. Claim a PARSED message for human verification
--
-- Separate from claim_staff_review_work().
-- Uses the same message-level claim table and advisory-lock namespace.
-- ============================================================

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


-- ============================================================
-- 3. Atomic Staff verification
--
-- Confirm exactly the PARSED representation Staff observed.
-- Correction remains a separate Review operation.
-- ============================================================

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


-- ============================================================
-- 4. Security boundary
-- ============================================================

revoke all
on function
  public.claim_staff_message_verification_work(
    uuid,
    uuid,
    text[],
    uuid,
    integer
  )
from public, anon, authenticated;


grant execute
on function
  public.claim_staff_message_verification_work(
    uuid,
    uuid,
    text[],
    uuid,
    integer
  )
to service_role;


revoke all
on function
  public.verify_staff_message_order(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    text,
    text,
    jsonb
  )
from public, anon, authenticated;


grant execute
on function
  public.verify_staff_message_order(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    text,
    text,
    jsonb
  )
to service_role;
