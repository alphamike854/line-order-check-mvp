-- Export Preparation v1 — Phase 2D
--
-- Atomic READY -> SENT transition foundation.
--
-- Important:
-- * this migration DOES NOT send LINE
-- * SENT is the cumulative accounting boundary
-- * current truth is revalidated again at SENT
-- * all SENT transitions for the same Round serialize on the Round row
-- * selected_send_quantity remains immutable
-- * no Allocation / Risk / Retention mutation
--
-- A later transport phase must invoke this transition only after
-- successful outbound delivery acknowledgement.

begin;


-- ============================================================
-- 1. Separate final SENT-time validation snapshot
-- ============================================================

alter table
  public.settlement_export_items
add column if not exists
  sent_current_effective_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  sent_prior_sent_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  sent_available_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  sent_validated_at timestamptz;


do $$
begin

  if not exists (
    select 1
    from pg_constraint
    where
      conname =
        'settlement_export_items_sent_snapshot_check'
      and conrelid =
        'public.settlement_export_items'::regclass
  ) then

    alter table
      public.settlement_export_items
    add constraint
      settlement_export_items_sent_snapshot_check
    check (
      (
        sent_current_effective_quantity is null
        and sent_prior_sent_quantity is null
        and sent_available_quantity is null
        and sent_validated_at is null
      )
      or
      (
        sent_current_effective_quantity >= 0
        and sent_prior_sent_quantity >= 0
        and sent_available_quantity >= 0
        and sent_validated_at is not null
        and sent_available_quantity =
          greatest(
            sent_current_effective_quantity
            - sent_prior_sent_quantity,
            0
          )
      )
    );

  end if;

end
$$;


-- ============================================================
-- 2. Atomic READY -> SENT
-- ============================================================

create or replace function
  public.mark_export_preparation_sent(
    p_cycle_id uuid,
    p_expected_summary_group_round_id uuid,
    p_sent_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare

  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_cycle
    public.settlement_export_cycles%rowtype;

  v_snapshot jsonb;
  v_risk_row jsonb;

  v_item
    public.settlement_export_items%rowtype;

  v_current bigint;
  v_prior bigint;
  v_available bigint;

  v_sent_at timestamptz;
  v_item_count integer := 0;

  v_items jsonb :=
    '[]'::jsonb;

begin

  if p_cycle_id is null then
    raise exception
      'EXPORT_CYCLE_ID_REQUIRED';
  end if;

  if p_expected_summary_group_round_id is null then
    raise exception
      'EXPORT_ROUND_REQUIRED';
  end if;


  /*
   * The Round row is the serialization boundary.
   *
   * Two READY cycles in the same Round cannot cross the
   * SENT boundary concurrently. The first SENT becomes
   * part of cumulative truth before the second revalidates.
   *
   * The same row lock also protects against CLOSE/OPEN
   * lifecycle changes during this transaction.
   */
  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      p_expected_summary_group_round_id
  for update;


  if not found then
    raise exception
      'EXPORT_ROUND_NOT_FOUND';
  end if;


  if v_round.status <> 'OPEN' then
    raise exception
      'EXPORT_ROUND_NOT_OPEN';
  end if;


  /*
   * Lock exactly one export cycle after the Round.
   */
  select
    c.*
  into
    v_cycle
  from
    public.settlement_export_cycles c
  where
    c.id =
      p_cycle_id
  for update;


  if not found then
    raise exception
      'EXPORT_CYCLE_NOT_FOUND';
  end if;


  if
    v_cycle.summary_group_round_id
    <>
    p_expected_summary_group_round_id
  then
    raise exception
      'EXPORT_PREPARATION_STALE_ROUND';
  end if;


  /*
   * SENT retry is idempotent.
   *
   * No client quantity or destination can be changed here.
   */
  if v_cycle.status = 'SENT' then

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',
              i.category,
            'code',
              i.code,

            'selected_send_quantity',
              i.selected_send_quantity,

            'draft_current_effective_quantity',
              i.current_effective_quantity,
            'draft_prior_sent_quantity',
              i.prior_sent_quantity,
            'draft_available_quantity',
              i.available_quantity,

            'ready_current_effective_quantity',
              i.ready_current_effective_quantity,
            'ready_prior_sent_quantity',
              i.ready_prior_sent_quantity,
            'ready_available_quantity',
              i.ready_available_quantity,
            'ready_validated_at',
              i.ready_validated_at,

            'sent_current_effective_quantity',
              i.sent_current_effective_quantity,
            'sent_prior_sent_quantity',
              i.sent_prior_sent_quantity,
            'sent_available_quantity',
              i.sent_available_quantity,
            'sent_validated_at',
              i.sent_validated_at
          )
          order by
            i.category,
            i.code
        ),
        '[]'::jsonb
      )
    into
      v_items
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        v_cycle.id;


    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'idempotent_replay', true,
      'cycle', to_jsonb(v_cycle),
      'items', v_items
    );

  end if;


  if v_cycle.status <> 'READY' then
    raise exception
      'EXPORT_CYCLE_NOT_READY';
  end if;


  /*
   * READY must have a locked destination.
   */
  if
    nullif(
      trim(
        coalesce(
          v_cycle.destination_line_group_id,
          ''
        )
      ),
      ''
    )
    is null

    or v_cycle.ready_at is null
  then
    raise exception
      'EXPORT_READY_STATE_INVALID';
  end if;


  /*
   * Canonical current truth at final transition.
   */
  select
    public.dashboard_risk_snapshot(
      v_round.settlement_session_id,
      v_round.summary_group_id
    )
  into
    v_snapshot;


  if
    v_snapshot is null
    or jsonb_typeof(v_snapshot) <> 'object'
    or jsonb_typeof(
      v_snapshot -> 'risk_codes'
    ) <> 'array'
  then
    raise exception
      'EXPORT_RISK_SNAPSHOT_INVALID';
  end if;


  v_sent_at :=
    clock_timestamp();


  /*
   * Final per-code validation.
   *
   * Because the Round row remains locked, another SENT
   * transition in this Round cannot become cumulative
   * until this transaction completes.
   */
  for v_item in

    select
      i.*
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        v_cycle.id
    order by
      i.category,
      i.code

  loop

    v_item_count :=
      v_item_count + 1;


    /*
     * A valid READY cycle must carry its READY snapshot.
     */
    if
      v_item.ready_current_effective_quantity
        is null
      or v_item.ready_prior_sent_quantity
        is null
      or v_item.ready_available_quantity
        is null
      or v_item.ready_validated_at
        is null
    then
      raise exception
        'EXPORT_READY_SNAPSHOT_MISSING';
    end if;


    v_risk_row := null;

    select
      x.value
    into
      v_risk_row
    from
      jsonb_array_elements(
        v_snapshot -> 'risk_codes'
      ) x(value)
    where
      x.value
        ->> 'summary_group_id'
          =
        v_round.summary_group_id

      and upper(
        x.value
          ->> 'category'
      ) =
        v_item.category

      and x.value
        ->> 'code'
          =
        v_item.code
    limit 1;


    if found then

      begin

        v_current :=
          coalesce(
            (
              v_risk_row
                ->> 'order_total'
            )::bigint,
            0
          );

      exception
        when others then
          raise exception
            'EXPORT_CURRENT_QUANTITY_INVALID';
      end;

    else
      v_current := 0;
    end if;


    if v_current < 0 then
      raise exception
        'EXPORT_CURRENT_QUANTITY_INVALID';
    end if;


    /*
     * Prior cumulative contains SENT cycles only.
     *
     * The current cycle is still READY at this point,
     * therefore it is not included in v_prior yet.
     */
    select
      s.sent_cumulative_quantity
    into
      v_prior
    from
      public.settlement_export_sent_totals s
    where
      s.summary_group_round_id =
        p_expected_summary_group_round_id
      and s.category =
        v_item.category
      and s.code =
        v_item.code;


    if not found then
      v_prior := 0;
    end if;


    v_prior :=
      coalesce(
        v_prior,
        0
      );


    v_available :=
      greatest(
        v_current
        - v_prior,
        0
      );


    if
      v_item.selected_send_quantity
      >
      v_available
    then
      raise exception
        'EXPORT_READY_STALE_AVAILABILITY';
    end if;


    /*
     * Preserve final SENT validation separately.
     * Never rewrite DRAFT or READY snapshots.
     * Never rewrite selected_send_quantity.
     */
    update
      public.settlement_export_items
    set
      sent_current_effective_quantity =
        v_current,

      sent_prior_sent_quantity =
        v_prior,

      sent_available_quantity =
        v_available,

      sent_validated_at =
        v_sent_at
    where
      cycle_id =
        v_cycle.id
      and category =
        v_item.category
      and code =
        v_item.code;

  end loop;


  if v_item_count < 1 then
    raise exception
      'EXPORT_CYCLE_HAS_NO_ITEMS';
  end if;


  /*
   * This single status transition is what makes the selected
   * quantities visible to settlement_export_sent_totals.
   */
  update
    public.settlement_export_cycles
  set
    status =
      'SENT',

    sent_at =
      v_sent_at,

    sent_by =
      coalesce(
        nullif(
          trim(p_sent_by),
          ''
        ),
        'DASHBOARD'
      )
  where
    id =
      v_cycle.id
  returning *
  into
    v_cycle;


  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category',
            i.category,
          'code',
            i.code,

          'selected_send_quantity',
            i.selected_send_quantity,

          'draft_current_effective_quantity',
            i.current_effective_quantity,
          'draft_prior_sent_quantity',
            i.prior_sent_quantity,
          'draft_available_quantity',
            i.available_quantity,

          'ready_current_effective_quantity',
            i.ready_current_effective_quantity,
          'ready_prior_sent_quantity',
            i.ready_prior_sent_quantity,
          'ready_available_quantity',
            i.ready_available_quantity,
          'ready_validated_at',
            i.ready_validated_at,

          'sent_current_effective_quantity',
            i.sent_current_effective_quantity,
          'sent_prior_sent_quantity',
            i.sent_prior_sent_quantity,
          'sent_available_quantity',
            i.sent_available_quantity,
          'sent_validated_at',
            i.sent_validated_at
        )
        order by
          i.category,
          i.code
      ),
      '[]'::jsonb
    )
  into
    v_items
  from
    public.settlement_export_items i
  where
    i.cycle_id =
      v_cycle.id;


  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'idempotent_replay', false,
    'cycle', to_jsonb(v_cycle),
    'items', v_items
  );

end;
$$;


revoke all
on function
  public.mark_export_preparation_sent(
    uuid,
    uuid,
    text
  )
from
  public,
  anon,
  authenticated;


grant execute
on function
  public.mark_export_preparation_sent(
    uuid,
    uuid,
    text
  )
to
  service_role;


comment on function
  public.mark_export_preparation_sent(
    uuid,
    uuid,
    text
  )
is
  'Final READY-to-SENT accounting transition for Export Preparation. Revalidates current same-Round availability and makes selected quantities cumulative. Does not perform LINE transport; a later transport layer must invoke only after successful delivery acknowledgement.';

commit;
