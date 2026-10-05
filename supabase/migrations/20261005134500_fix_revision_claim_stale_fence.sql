-- Human Verification revision claim optimistic fence.
--
-- The six-argument overload is the only application-callable
-- revision claim boundary. It serializes on Human Truth,
-- verifies revision_no, then delegates to the existing
-- five-argument claim implementation in the same transaction.

create or replace function
  public.claim_staff_message_verification_revision_work(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_revision_no bigint,
    p_lease_seconds integer
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification
    public.message_verifications%rowtype;
begin
  if
    p_expected_revision_no is null
    or p_expected_revision_no < 1
  then
    raise exception
      'REVISION_NO_REQUIRED';
  end if;


  select mv.*
  into v_verification
  from public.message_verifications mv
  where
    mv.message_record_id =
      p_message_record_id
  for update;


  if not found then
    raise exception
      'MESSAGE_NOT_VERIFIED';
  end if;


  if
    v_verification.revision_no
      is distinct from
        p_expected_revision_no
  then
    raise exception
      'STALE_VERIFICATION_REVISION';
  end if;


  return
    public.claim_staff_message_verification_revision_work(
      p_message_record_id,
      p_staff_id,
      p_allowed_line_group_ids,
      p_settlement_session_id,
      p_lease_seconds
    );
end;
$$;


-- Rollout compatibility:
-- Keep the legacy five-argument signature callable by
-- service_role until the application using the fenced
-- six-argument signature is deployed.
--
-- A separate post-deploy hardening migration will revoke
-- service_role from the legacy signature.

revoke all
on function
  public.claim_staff_message_verification_revision_work(
    uuid,
    uuid,
    text[],
    uuid,
    integer
  )
from
  public,
  anon,
  authenticated;


-- New fenced signature: service_role only.

revoke all
on function
  public.claim_staff_message_verification_revision_work(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    integer
  )
from
  public,
  anon,
  authenticated;


grant execute
on function
  public.claim_staff_message_verification_revision_work(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    integer
  )
to service_role;
