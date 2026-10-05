-- Final B2 hardening.
--
-- Production application is already deployed using the fenced
-- six-argument revision claim RPC. The legacy five-argument
-- signature is no longer application-callable.

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
  authenticated,
  service_role;


-- Keep the fenced boundary explicit: service_role only.

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
