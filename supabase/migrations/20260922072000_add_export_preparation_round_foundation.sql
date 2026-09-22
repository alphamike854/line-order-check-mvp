-- Export Preparation v1 — Round-scoped temporary working state
--
-- Business contract:
--
-- * Export Preparation is NOT Allocation / confirmed cut.
-- * Only SENT cycles contribute to cumulative exported quantity.
-- * Data exists only for the current Summary Group Round.
-- * Creating a newer Round for the same Summary Group purges all
--   Export Preparation rows from older Rounds of that Summary Group.
-- * No cross-Round Export History is retained.
-- * Other Summary Groups remain untouched.
--
-- This foundation deliberately DOES NOT:
-- * send LINE messages
-- * change Risk / Retention
-- * confirm Allocation
-- * provide browser/API mutation endpoints

begin;

-- ============================================================
-- 1. Export cycle
-- ============================================================

create table if not exists
  public.settlement_export_cycles (
    id uuid primary key
      default gen_random_uuid(),

    summary_group_round_id uuid not null
      references
        public.settlement_summary_group_rounds(id)
      on delete cascade,

    cycle_no integer not null
      check (cycle_no > 0),

    status text not null
      default 'DRAFT'
      check (
        status in (
          'DRAFT',
          'READY',
          'SENT'
        )
      ),

    -- Destination is intentionally independent from Mirror routing.
    -- A later operator-facing API will resolve/validate the LINE
    -- destination before READY/SENT.
    destination_line_group_id text,
    destination_label text,

    snapshot_at timestamptz not null
      default now(),

    created_by text,
    created_at timestamptz not null
      default now(),

    ready_at timestamptz,
    sent_at timestamptz,
    sent_by text,

    unique (
      summary_group_round_id,
      cycle_no
    ),

    constraint
      settlement_export_cycles_state_check
    check (
      (
        status = 'DRAFT'
        and sent_at is null
      )
      or
      (
        status = 'READY'
        and destination_line_group_id is not null
        and ready_at is not null
        and sent_at is null
      )
      or
      (
        status = 'SENT'
        and destination_line_group_id is not null
        and ready_at is not null
        and sent_at is not null
      )
    )
  );

create index if not exists
  settlement_export_cycles_round_status_idx
on public.settlement_export_cycles (
  summary_group_round_id,
  status,
  cycle_no
);

comment on table
  public.settlement_export_cycles
is
  'Temporary operator Export Preparation cycles for one Summary Group Round. Rows are purged when a newer Round opens for the same Summary Group.';


-- ============================================================
-- 2. Per-code snapshot + selected quantity
-- ============================================================

create table if not exists
  public.settlement_export_items (
    cycle_id uuid not null
      references
        public.settlement_export_cycles(id)
      on delete cascade,

    category text not null,
    code text not null,

    -- Current effective quantity observed when this cycle was prepared.
    current_effective_quantity bigint not null
      check (
        current_effective_quantity >= 0
      ),

    -- SUM(selected_send_quantity) of prior SENT cycles
    -- in this exact Summary Group Round + category + code.
    prior_sent_quantity bigint not null
      default 0
      check (
        prior_sent_quantity >= 0
      ),

    -- max(current - prior SENT, 0) at preparation time.
    available_quantity bigint not null
      check (
        available_quantity >= 0
      ),

    -- Operator-selected amount for this cycle.
    --
    -- No 500/1000/etc unit rule is enforced in this foundation.
    -- That remains an operator/UI policy for a later phase.
    selected_send_quantity bigint not null
      check (
        selected_send_quantity > 0
      ),

    created_at timestamptz not null
      default now(),

    primary key (
      cycle_id,
      category,
      code
    ),

    constraint
      settlement_export_items_available_truth_check
    check (
      available_quantity =
        greatest(
          current_effective_quantity
          - prior_sent_quantity,
          0
        )
    ),

    constraint
      settlement_export_items_selected_within_available_check
    check (
      selected_send_quantity
      <= available_quantity
    )
  );

create index if not exists
  settlement_export_items_code_idx
on public.settlement_export_items (
  category,
  code,
  cycle_id
);

comment on table
  public.settlement_export_items
is
  'Per-code Export Preparation snapshot. selected_send_quantity is operator-selected and becomes cumulative only when its parent cycle is SENT.';


-- ============================================================
-- 3. Canonical SENT cumulative read model
-- ============================================================

create or replace view
  public.settlement_export_sent_totals
as
select
  c.summary_group_round_id,
  i.category,
  i.code,
  sum(
    i.selected_send_quantity
  )::bigint
    as sent_cumulative_quantity,
  count(
    distinct c.id
  )::integer
    as sent_cycle_count,
  max(
    c.sent_at
  )
    as last_sent_at
from
  public.settlement_export_cycles c
join
  public.settlement_export_items i
    on i.cycle_id = c.id
where
  c.status = 'SENT'
group by
  c.summary_group_round_id,
  i.category,
  i.code;

comment on view
  public.settlement_export_sent_totals
is
  'Current-Round cumulative Export Preparation quantity. DRAFT and READY cycles never contribute; only SENT cycles are summed.';


-- ============================================================
-- 4. Destructive Round boundary
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
   * When any newer Round is created, remove all Export
   * Preparation cycles belonging to older Rounds of the SAME
   * Summary Group.
   *
   * settlement_export_items cascade from their cycle.
   *
   * Other Summary Groups are not touched.
   *
   * This trigger executes inside the transaction that creates
   * the new Round. If Round creation rolls back, this purge also
   * rolls back.
   */

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

drop trigger if exists
  settlement_export_purge_on_new_round_trg
on
  public.settlement_summary_group_rounds;

create trigger
  settlement_export_purge_on_new_round_trg
after insert
on
  public.settlement_summary_group_rounds
for each row
execute function
  public.purge_export_preparation_on_new_round();


-- ============================================================
-- 5. Security
-- ============================================================

alter table
  public.settlement_export_cycles
enable row level security;

alter table
  public.settlement_export_items
enable row level security;

revoke all
on public.settlement_export_cycles
from public, anon, authenticated;

revoke all
on public.settlement_export_items
from public, anon, authenticated;

revoke all
on public.settlement_export_sent_totals
from public, anon, authenticated;

revoke all
on function
  public.purge_export_preparation_on_new_round()
from public, anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on public.settlement_export_cycles
to service_role;

grant
  select,
  insert,
  update,
  delete
on public.settlement_export_items
to service_role;

grant select
on public.settlement_export_sent_totals
to service_role;

comment on function
  public.purge_export_preparation_on_new_round()
is
  'Purges temporary Export Preparation cycles from older Rounds of the same Summary Group whenever a new Round is created. No Export History is retained across Rounds.';

commit;
