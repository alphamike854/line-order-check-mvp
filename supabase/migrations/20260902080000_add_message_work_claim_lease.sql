-- R2D2A
-- Message-level Shared Work Claim + Lease Foundation
--
-- Claim grain:
--   message_record_id
--
-- Important:
--   - Staff identity comes from authenticated server actor.
--   - Browser must never choose arbitrary staff_id.
--   - Claims are soft leases and may be reclaimed after expiry.
--   - Current phase applies only to actionable OPEN review_items.
--   - Human verification state is NOT changed here.

create table if not exists public.staff_message_work_claims (
  message_record_id uuid primary key
    references public.messages(id)
    on delete cascade,

  staff_id uuid not null
    references public.staff_accounts(id)
    on delete cascade,

  claimed_at timestamptz not null
    default now(),

  claim_expires_at timestamptz not null,

  lease_version bigint not null
    default 1
    check (lease_version > 0),

  updated_at timestamptz not null
    default now(),

  check (
    claim_expires_at > claimed_at
  )
);


create index if not exists
  staff_message_work_claims_staff_idx
on public.staff_message_work_claims (
  staff_id,
  claim_expires_at
);


create index if not exists
  staff_message_work_claims_expiry_idx
on public.staff_message_work_claims (
  claim_expires_at
);


alter table
  public.staff_message_work_claims
enable row level security;


revoke all
on public.staff_message_work_claims
from anon, authenticated;


grant
  select,
  insert,
  update,
  delete
on public.staff_message_work_claims
to service_role;


comment on table
  public.staff_message_work_claims
is
  'Current message-level Staff work lease. Expired leases are reclaimable.';


-- ============================================================
-- Claim or renew one exact work item.
--
-- The allowed LINE Group list is calculated server-side from
-- authenticated Staff assignments and passed through service role.
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
  v_now timestamptz :=
    clock_timestamp();

  v_lease_seconds integer;

  v_staff
    public.staff_accounts%rowtype;

  v_message
    public.messages%rowtype;

  v_review
    public.review_items%rowtype;

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


  -- Serialize all claim/release transitions for one message.
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
  where m.id =
    p_message_record_id;

  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
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
  where c.message_record_id =
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

    where message_record_id =
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

    where message_record_id =
      p_message_record_id

    returning *
      into v_claim;

    v_result :=
      'CLAIMED';


  else
    select s.display_name
      into v_holder_name
    from public.staff_accounts s
    where s.id =
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
-- Release own claim.
--
-- expected lease version prevents an old browser tab from
-- releasing a newer lease accidentally.
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


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  select c.*
    into v_claim
  from public.staff_message_work_claims c
  where c.message_record_id =
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

    and
    p_expected_lease_version
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
  where message_record_id =
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
-- Read current active claim state for bounded Workbench items.
--
-- Expired rows deliberately behave as unclaimed.
-- ============================================================

create or replace function
  public.staff_workbench_claim_state(
    p_message_record_ids uuid[]
  )
returns table (
  message_record_id uuid,
  staff_id uuid,
  staff_code text,
  staff_display_name text,
  claim_expires_at timestamptz,
  lease_version bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.message_record_id,
    c.staff_id,
    s.staff_code,
    s.display_name,
    c.claim_expires_at,
    c.lease_version

  from public.staff_message_work_claims c

  join public.staff_accounts s
    on s.id =
       c.staff_id

  where
    c.message_record_id =
      any(
        coalesce(
          p_message_record_ids,
          array[]::uuid[]
        )
      )

    and c.claim_expires_at >
      clock_timestamp()

    and s.enabled = true;
$$;


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


revoke all
on function public.staff_workbench_claim_state(
  uuid[]
)
from public, anon, authenticated;

grant execute
on function public.staff_workbench_claim_state(
  uuid[]
)
to service_role;
