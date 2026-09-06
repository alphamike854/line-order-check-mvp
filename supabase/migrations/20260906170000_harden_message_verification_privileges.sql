-- Human Verification privilege hardening
--
-- message_verifications is human-truth evidence.
-- Application mutation must occur only through SECURITY DEFINER RPCs.
-- service_role may read evidence but may not INSERT/UPDATE/DELETE directly.

revoke all
on public.message_verifications
from public, anon, authenticated, service_role;


grant select
on public.message_verifications
to service_role;


-- Reassert RPC execution boundary explicitly.

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
