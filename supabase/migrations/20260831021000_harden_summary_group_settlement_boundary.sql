-- S1A
-- Serialize canonical order-item persistence with Summary Group OPEN/CLOSE.
-- Uses the same advisory lock key as
-- set_settlement_summary_group_accepting().

create or replace function
  public.enforce_order_item_summary_group_accepting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    new.settlement_session_id is null
    or coalesce(new.summary_group_id, '') = ''
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        new.settlement_session_id::text,
        new.summary_group_id
      ),
      0
    )
  );

  if not public.is_settlement_summary_group_accepting(
    new.settlement_session_id,
    new.summary_group_id
  ) then
    raise exception 'SUMMARY_GROUP_CLOSED';
  end if;

  return new;
end;
$$;

revoke all
on function public.enforce_order_item_summary_group_accepting()
from public, anon, authenticated;

grant execute
on function public.enforce_order_item_summary_group_accepting()
to service_role;
