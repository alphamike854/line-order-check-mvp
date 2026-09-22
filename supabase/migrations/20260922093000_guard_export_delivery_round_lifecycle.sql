-- Export Preparation Phase 2F2B1
-- Delivery / Summary Group Round lifecycle hardening.
--
-- Safety invariant:
--
-- A Summary Group Round MUST NOT leave OPEN state while an
-- Export Preparation delivery is unresolved at the external
-- LINE acknowledgement boundary.
--
-- Unresolved transport states:
--   SENDING
--   RETRYABLE
--   AMBIGUOUS
--
-- FAILED does not block Round close:
-- the transport result is deterministically non-accepted.
--
-- ACKNOWLEDGED does not block Round close:
-- positive acknowledgement and cycle SENT are committed in
-- the same transaction by Phase 2E.
--
-- Defense in depth:
--   1. block OPEN -> CLOSED while unresolved delivery exists
--   2. block creation of a new OPEN Round for a Summary Group
--      while an older unresolved delivery exists
--   3. make the destructive Export Preparation purge itself
--      fail closed before deleting any cycle / retry identity
--
-- This migration does NOT:
--   * send LINE messages
--   * change delivery status
--   * change Export selected quantities
--   * change Allocation / Risk / Retention
--   * retain Export Preparation history across Rounds

begin;


-- ============================================================
-- 1. Shared unresolved-delivery predicate
-- ============================================================

create or replace function
  public.export_preparation_round_has_unresolved_delivery(
    p_summary_group_round_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from
      public.settlement_export_deliveries d
    where
      d.summary_group_round_id =
        p_summary_group_round_id
      and d.status in (
        'SENDING',
        'RETRYABLE',
        'AMBIGUOUS'
      )
  );
$$;


-- ============================================================
-- 2. CLOSE guard
--
-- The existing CLOSE_GROUP lifecycle already locks the current
-- Round row FOR UPDATE before changing status.
--
-- Phase 2E begin/complete delivery also locks the same Round row.
-- Therefore the Round row remains the serialization boundary:
--
--   delivery wins lock first:
--     close waits, then observes unresolved transport and fails
--
--   close wins lock first:
--     Round becomes CLOSED, then new delivery begin fails because
--     Phase 2E requires an OPEN Round
-- ============================================================

create or replace function
  public.guard_export_delivery_on_round_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if
    old.status = 'OPEN'
    and new.status = 'CLOSED'
    and public.export_preparation_round_has_unresolved_delivery(
      old.id
    )
  then
    raise exception
      'EXPORT_DELIVERY_UNRESOLVED_BLOCKS_ROUND_CLOSE';
  end if;

  return new;
end;
$$;

drop trigger if exists
  settlement_export_delivery_round_close_guard_trg
on
  public.settlement_summary_group_rounds;

create trigger
  settlement_export_delivery_round_close_guard_trg
before update of status
on
  public.settlement_summary_group_rounds
for each row
when (
  old.status is distinct from new.status
  and old.status = 'OPEN'
  and new.status = 'CLOSED'
)
execute function
  public.guard_export_delivery_on_round_close();


-- ============================================================
-- 3. New-Round guard
--
-- Export Preparation purge semantics are Summary-Group-wide:
-- when a newer Round is created, old cycles of that Summary Group
-- are removed.
--
-- Therefore a new OPEN Round must not be created while ANY older
-- Round of the same Summary Group owns unresolved delivery state.
--
-- This also protects legacy/bypass states where an unresolved
-- delivery somehow already belongs to a CLOSED older Round.
-- ============================================================

create or replace function
  public.guard_export_delivery_on_new_round()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if
    new.status = 'OPEN'
    and exists (
      select 1
      from
        public.settlement_export_deliveries d
      join
        public.settlement_summary_group_rounds r
          on r.id =
            d.summary_group_round_id
      where
        r.summary_group_id =
          new.summary_group_id
        and d.status in (
          'SENDING',
          'RETRYABLE',
          'AMBIGUOUS'
        )
    )
  then
    raise exception
      'EXPORT_DELIVERY_UNRESOLVED_BLOCKS_NEW_ROUND';
  end if;

  return new;
end;
$$;

drop trigger if exists
  settlement_export_delivery_new_round_guard_trg
on
  public.settlement_summary_group_rounds;

create trigger
  settlement_export_delivery_new_round_guard_trg
before insert
on
  public.settlement_summary_group_rounds
for each row
when (
  new.status = 'OPEN'
)
execute function
  public.guard_export_delivery_on_new_round();


-- ============================================================
-- 4. Defensive purge replacement
--
-- Keep the original Phase 1 business rule:
-- Export Preparation has NO history across Rounds.
--
-- The only change is fail-closed protection before destructive
-- deletion. If unresolved transport exists, retry identity and
-- payload must survive.
-- ============================================================

create or replace function
  public.purge_export_preparation_on_new_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
   * Export Preparation deliberately has no cross-Round history.
   *
   * Before deleting older cycles, prove that none of the cycles
   * being purged owns an unresolved external delivery.
   *
   * settlement_export_deliveries cascades from its cycle, so
   * deleting the cycle without this check would destroy:
   *   - stable LINE retry key
   *   - transport attempt state
   *   - acknowledgement reconciliation identity
   */

  if exists (
    select 1
    from
      public.settlement_export_deliveries d
    join
      public.settlement_summary_group_rounds old_round
        on old_round.id =
          d.summary_group_round_id
    where
      old_round.summary_group_id =
        new.summary_group_id
      and old_round.id <>
        new.id
      and d.status in (
        'SENDING',
        'RETRYABLE',
        'AMBIGUOUS'
      )
  )
  then
    raise exception
      'EXPORT_DELIVERY_UNRESOLVED_BLOCKS_PURGE';
  end if;

  delete from
    public.settlement_export_cycles c
  using
    public.settlement_summary_group_rounds old_round
  where
    c.summary_group_round_id =
      old_round.id
    and old_round.summary_group_id =
      new.summary_group_id
    and old_round.id <>
      new.id;

  return new;
end;
$$;


-- ============================================================
-- 5. Privilege boundary
-- ============================================================

revoke all
on function
  public.export_preparation_round_has_unresolved_delivery(uuid)
from public, anon, authenticated;

revoke all
on function
  public.guard_export_delivery_on_round_close()
from public, anon, authenticated;

revoke all
on function
  public.guard_export_delivery_on_new_round()
from public, anon, authenticated;

revoke all
on function
  public.purge_export_preparation_on_new_round()
from public, anon, authenticated;


grant execute
on function
  public.export_preparation_round_has_unresolved_delivery(uuid)
to service_role;

grant execute
on function
  public.guard_export_delivery_on_round_close()
to service_role;

grant execute
on function
  public.guard_export_delivery_on_new_round()
to service_role;


comment on function
  public.export_preparation_round_has_unresolved_delivery(uuid)
is
  'Returns true when a Summary Group Round owns an unresolved Export Preparation delivery in SENDING, RETRYABLE, or AMBIGUOUS state.';

comment on function
  public.guard_export_delivery_on_round_close()
is
  'Fails closed when OPEN -> CLOSED would strand an unresolved Export Preparation delivery.';

comment on function
  public.guard_export_delivery_on_new_round()
is
  'Fails closed before creating a new OPEN Summary Group Round when an older Round of the same Summary Group still owns unresolved Export Preparation delivery state.';

comment on function
  public.purge_export_preparation_on_new_round()
is
  'Purges temporary Export Preparation cycles from older Rounds of the same Summary Group only after proving no unresolved delivery retry identity would be destroyed.';


commit;
