-- R2D3C-1
-- Durable Post-close Review Claim / Lease Foundation
--
-- Claim grain:
--   post_close_review_archive.id
--
-- Important:
--   - This lifecycle is independent of live message Review claims.
--   - Staff identity comes from the authenticated server actor.
--   - Current Staff <-> LINE Group access is resolved server-side.
--   - No OPEN Settlement / latest Round requirement exists here.
--   - Archive evidence and canonical order data are not mutated.
--   - Post-close resolve/ignore remains outside this phase.

create table if not exists
  public.staff_post_close_review_claims (
    archive_id uuid primary key
      references public.post_close_review_archive(id)
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
  staff_post_close_review_claims_staff_idx
on public.staff_post_close_review_claims (
  staff_id,
  claim_expires_at
);


create index if not exists
  staff_post_close_review_claims_expiry_idx
on public.staff_post_close_review_claims (
  claim_expires_at
);


alter table
  public.staff_post_close_review_claims
enable row level security;


revoke all
on public.staff_post_close_review_claims
from public, anon, authenticated;


grant
  select,
  insert,
  update,
  delete
on public.staff_post_close_review_claims
to service_role;


comment on table
  public.staff_post_close_review_claims
is
  'Current Staff soft lease for one durable post-close Review archive item.';


-- ============================================================
-- Claim / Renew
-- ============================================================

create or replace function
  public.claim_staff_post_close_review_work(
    p_archive_id uuid,
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

  v_archive
    public.post_close_review_archive%rowtype;

  v_claim
    public.staff_post_close_review_claims%rowtype;

  v_holder_name text;
  v_result text;
begin
  if p_archive_id is null then
    raise exception
      'ARCHIVE_ID_REQUIRED';
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


  -- Serialize every ownership transition for this exact
  -- durable archive work item.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-post-close-review-claim:'
      || p_archive_id::text,
      0
    )
  );


  -- Archive identity and historical LINE Group ownership are
  -- authoritative here. No live message/review lookup exists.
  -- Resolve identity + authorization in one DB boundary.
  --
  -- Missing and out-of-scope archive identities are deliberately
  -- indistinguishable to the caller.
  select a.*
  into v_archive
  from public.post_close_review_archive a
  where
    a.id = p_archive_id
    and a.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  for key share;

  if not found then
    raise exception
      'POST_CLOSE_REVIEW_NOT_FOUND';
  end if;


  select c.*
  into v_claim
  from public.staff_post_close_review_claims c
  where c.archive_id =
    p_archive_id
  for update;


  if not found then

    insert into
      public.staff_post_close_review_claims (
        archive_id,
        staff_id,
        claimed_at,
        claim_expires_at,
        lease_version,
        updated_at
      )
    values (
      p_archive_id,
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
      public.staff_post_close_review_claims
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

    where archive_id =
      p_archive_id

    returning *
    into v_claim;

    v_result :=
      'RENEWED';


  elsif
    v_claim.claim_expires_at
      <= v_now
  then

    update
      public.staff_post_close_review_claims
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

    where archive_id =
      p_archive_id

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

      'archive_id',
        p_archive_id,

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

    'archive_id',
      v_claim.archive_id,

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
-- Release
--
-- Release deliberately does not depend on a source Review state.
-- R2D3D may resolve an archive while the lease still exists.
-- ============================================================

create or replace function
  public.release_staff_post_close_review_work(
    p_archive_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_expected_lease_version bigint default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff
    public.staff_accounts%rowtype;

  v_archive
    public.post_close_review_archive%rowtype;

  v_claim
    public.staff_post_close_review_claims%rowtype;
begin
  if p_archive_id is null then
    raise exception
      'ARCHIVE_ID_REQUIRED';
  end if;

  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


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
      'staff-post-close-review-claim:'
      || p_archive_id::text,
      0
    )
  );


  -- Apply the same anti-enumeration boundary as Claim:
  -- archive identity and current Staff LINE Group scope are checked
  -- in one lookup.
  select a.*
  into v_archive
  from public.post_close_review_archive a
  where
    a.id = p_archive_id
    and a.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  for key share;

  if not found then
    raise exception
      'POST_CLOSE_REVIEW_NOT_FOUND';
  end if;


  select c.*
  into v_claim
  from public.staff_post_close_review_claims c
  where c.archive_id =
    p_archive_id
  for update;


  if not found then
    return jsonb_build_object(
      'ok',
        true,

      'status',
        'NOT_CLAIMED',

      'archive_id',
        p_archive_id
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

      'archive_id',
        p_archive_id,

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

      'archive_id',
        p_archive_id,

      'lease_version',
        v_claim.lease_version
    );

  end if;


  delete from
    public.staff_post_close_review_claims
  where archive_id =
    p_archive_id;


  return jsonb_build_object(
    'ok',
      true,

    'status',
      'RELEASED',

    'archive_id',
      p_archive_id,

    'lease_version',
      v_claim.lease_version
  );
end;
$$;


-- ============================================================
-- Bounded active claim-state read
--
-- Expired leases behave as unclaimed.
-- ============================================================

create or replace function
  public.staff_post_close_review_claim_state(
    p_archive_ids uuid[]
  )
returns table (
  archive_id uuid,
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
    c.archive_id,
    c.staff_id,
    s.staff_code,
    s.display_name,
    c.claim_expires_at,
    c.lease_version

  from
    public.staff_post_close_review_claims c

  join public.staff_accounts s
    on s.id =
      c.staff_id

  where
    c.archive_id =
      any(
        coalesce(
          p_archive_ids,
          array[]::uuid[]
        )
      )

    and c.claim_expires_at >
      clock_timestamp()

    and s.enabled = true;
$$;


-- ============================================================
-- Security
-- ============================================================

revoke all
on function public.claim_staff_post_close_review_work(
  uuid,
  uuid,
  text[],
  integer
)
from public, anon, authenticated;

grant execute
on function public.claim_staff_post_close_review_work(
  uuid,
  uuid,
  text[],
  integer
)
to service_role;


revoke all
on function public.release_staff_post_close_review_work(
  uuid,
  uuid,
  text[],
  bigint
)
from public, anon, authenticated;

grant execute
on function public.release_staff_post_close_review_work(
  uuid,
  uuid,
  text[],
  bigint
)
to service_role;


revoke all
on function public.staff_post_close_review_claim_state(
  uuid[]
)
from public, anon, authenticated;

grant execute
on function public.staff_post_close_review_claim_state(
  uuid[]
)
to service_role;
