-- R2D3D-3
-- Post-close Claim Incarnation Hardening
--
-- Problem:
-- staff_post_close_review_claims is intentionally deleted on Release.
-- The previous Claim RPC recreated lease_version at 1 after a Release,
-- allowing the same archive + Staff + lease version to recur.
--
-- Preview tokens bind archive_id + staff_id + lease_version +
-- fingerprint, so a released/reclaimed work item must never reuse
-- an earlier lease version.
--
-- This migration:
--   1. Adds a durable monotonic generation to the archive.
--   2. Fences pre-hardening generations on existing archive rows.
--   3. Replaces only the post-close Claim RPC.
--   4. Keeps Release, Preview, Resolve and browser contracts unchanged.


alter table public.post_close_review_archive
  add column if not exists
    post_close_claim_version bigint
    not null
    default 0;


alter table public.post_close_review_archive
  drop constraint if exists
    post_close_review_archive_post_close_claim_version_check;


alter table public.post_close_review_archive
  add constraint
    post_close_review_archive_post_close_claim_version_check
  check (
    post_close_claim_version >= 0
  );


comment on column
  public.post_close_review_archive.post_close_claim_version
is
  'Durable monotonic generation for post-close Staff claim ownership. '
  'It survives Release so a later Claim cannot reuse an earlier '
  'lease_version.';


-- Existing archive rows may have participated in Claim/Release before
-- this column existed. Released claim rows no longer retain their old
-- lease versions, so seed existing archives above the legacy small
-- integer generation space.
--
-- Microseconds since epoch gives existing rows a large positive fence.
-- Also preserve any currently-active claim version if it is larger.
update public.post_close_review_archive a
set post_close_claim_version =
  greatest(
    a.post_close_claim_version,

    floor(
      extract(
        epoch from clock_timestamp()
      ) * 1000000
    )::bigint,

    coalesce(
      (
        select c.lease_version
        from public.staff_post_close_review_claims c
        where c.archive_id = a.id
      ),
      0
    )
  );


-- ============================================================
-- Claim / Renew / Expired Reclaim
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

  v_transition text;

  v_claim_version bigint;

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


  -- Preserve the exact archive-scoped serialization namespace used by
  -- Claim, Release, Preview access and post-close resolution.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-post-close-review-claim:'
      || p_archive_id::text,
      0
    )
  );


  -- Archive identity and historical LINE Group scope remain the
  -- authoritative authorization boundary.
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
  where
    c.archive_id = p_archive_id
  for update;


  -- Decide ownership transition before advancing the durable
  -- generation. BUSY does not consume a generation.
  if not found then
    v_transition :=
      'INSERT';

    v_result :=
      'CLAIMED';

  elsif
    v_claim.staff_id =
      p_staff_id
  then
    v_transition :=
      'RENEW';

    v_result :=
      'RENEWED';

  elsif
    v_claim.claim_expires_at
      <= v_now
  then
    v_transition :=
      'RECLAIM';

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


  -- One durable version source for every successful ownership
  -- transition. Release never resets this value.
  update public.post_close_review_archive
  set post_close_claim_version =
    post_close_claim_version + 1
  where id =
    p_archive_id
  returning
    post_close_claim_version
  into
    v_claim_version;


  if not found then
    raise exception
      'POST_CLOSE_REVIEW_NOT_FOUND';
  end if;


  if v_transition = 'INSERT' then

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
      v_claim_version,
      v_now
    )
    returning *
    into v_claim;


  elsif v_transition = 'RENEW' then

    update
      public.staff_post_close_review_claims
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
    where archive_id =
      p_archive_id
    returning *
    into v_claim;


  elsif v_transition = 'RECLAIM' then

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
        v_claim_version,

      updated_at =
        v_now
    where archive_id =
      p_archive_id
    returning *
    into v_claim;


  else
    raise exception
      'INVALID_POST_CLOSE_CLAIM_TRANSITION';
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


revoke all
on function
  public.claim_staff_post_close_review_work(
    uuid,
    uuid,
    text[],
    integer
  )
from
  public,
  anon,
  authenticated;


grant execute
on function
  public.claim_staff_post_close_review_work(
    uuid,
    uuid,
    text[],
    integer
  )
to service_role;
