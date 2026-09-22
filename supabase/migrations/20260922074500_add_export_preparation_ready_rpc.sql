-- Export Preparation v1 — Phase 2C
--
-- DRAFT -> READY only.
--
-- READY means:
-- * operator destination is locked
-- * live current/SENT availability was revalidated
-- * READY validation snapshot is preserved separately
--
-- READY DOES NOT:
-- * reserve quantity
-- * contribute to SENT cumulative
-- * send LINE
-- * mutate Allocation / Risk / Retention
--
-- Final availability must be revalidated again at SENT.

begin;


-- ============================================================
-- 1. Preserve READY-time validation separately from DRAFT snapshot
-- ============================================================

alter table
  public.settlement_export_cycles
add column if not exists
  ready_by text;


alter table
  public.settlement_export_items
add column if not exists
  ready_current_effective_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  ready_prior_sent_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  ready_available_quantity bigint;

alter table
  public.settlement_export_items
add column if not exists
  ready_validated_at timestamptz;


do $$
begin

  if not exists (
    select 1
    from pg_constraint
    where
      conname =
        'settlement_export_items_ready_snapshot_check'
      and conrelid =
        'public.settlement_export_items'::regclass
  ) then

    alter table
      public.settlement_export_items
    add constraint
      settlement_export_items_ready_snapshot_check
    check (
      (
        ready_current_effective_quantity is null
        and ready_prior_sent_quantity is null
        and ready_available_quantity is null
        and ready_validated_at is null
      )
      or
      (
        ready_current_effective_quantity >= 0
        and ready_prior_sent_quantity >= 0
        and ready_available_quantity >= 0
        and ready_validated_at is not null
        and ready_available_quantity =
          greatest(
            ready_current_effective_quantity
            - ready_prior_sent_quantity,
            0
          )
      )
    );

  end if;

end
$$;


-- ============================================================
-- 2. Atomic DRAFT -> READY
-- ============================================================

create or replace function
  public.mark_export_preparation_ready(
    p_cycle_id uuid,
    p_expected_summary_group_round_id uuid,
    p_destination_line_group_id text,
    p_destination_label text default null,
    p_ready_by text default 'DASHBOARD'
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

  v_destination_line_group_id text;
  v_destination_label text;
  v_ready_at timestamptz;

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

  v_destination_line_group_id :=
    trim(
      coalesce(
        p_destination_line_group_id,
        ''
      )
    );

  if
    v_destination_line_group_id = ''
    or length(
      v_destination_line_group_id
    ) > 255
  then
    raise exception
      'EXPORT_DESTINATION_INVALID';
  end if;

  v_destination_label :=
    nullif(
      trim(
        coalesce(
          p_destination_label,
          ''
        )
      ),
      ''
    );

  if
    v_destination_label is not null
    and length(v_destination_label) > 255
  then
    raise exception
      'EXPORT_DESTINATION_LABEL_INVALID';
  end if;


  /*
   * Lock the expected Round first.
   *
   * This prevents it from changing OPEN/CLOSED state
   * while READY validation is running.
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
   * Then lock exactly one Export cycle.
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
   * Retry-safe READY.
   *
   * Same READY cycle + same destination:
   * return the existing READY state.
   *
   * A retry cannot silently switch destination.
   */
  if v_cycle.status = 'READY' then

    if
      v_cycle.destination_line_group_id
      is distinct from
      v_destination_line_group_id

      or v_cycle.destination_label
      is distinct from
      v_destination_label
    then
      raise exception
        'EXPORT_READY_DESTINATION_CONFLICT';
    end if;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',
              i.category,
            'code',
              i.code,

            'draft_current_effective_quantity',
              i.current_effective_quantity,
            'draft_prior_sent_quantity',
              i.prior_sent_quantity,
            'draft_available_quantity',
              i.available_quantity,

            'selected_send_quantity',
              i.selected_send_quantity,

            'ready_current_effective_quantity',
              i.ready_current_effective_quantity,
            'ready_prior_sent_quantity',
              i.ready_prior_sent_quantity,
            'ready_available_quantity',
              i.ready_available_quantity,
            'ready_validated_at',
              i.ready_validated_at
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


  if v_cycle.status = 'SENT' then
    raise exception
      'EXPORT_CYCLE_ALREADY_SENT';
  end if;

  if v_cycle.status <> 'DRAFT' then
    raise exception
      'EXPORT_CYCLE_NOT_DRAFT';
  end if;


  /*
   * Canonical current truth.
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


  v_ready_at :=
    clock_timestamp();


  /*
   * Revalidate every selected code.
   *
   * READY is not a reservation, therefore only prior SENT
   * is subtracted. Another READY cycle does not consume
   * availability. SENT phase must revalidate again.
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
        'EXPORT_DRAFT_STALE_AVAILABILITY';
    end if;


    update
      public.settlement_export_items
    set
      ready_current_effective_quantity =
        v_current,

      ready_prior_sent_quantity =
        v_prior,

      ready_available_quantity =
        v_available,

      ready_validated_at =
        v_ready_at
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


  update
    public.settlement_export_cycles
  set
    status =
      'READY',

    destination_line_group_id =
      v_destination_line_group_id,

    destination_label =
      v_destination_label,

    ready_at =
      v_ready_at,

    ready_by =
      coalesce(
        nullif(
          trim(p_ready_by),
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

          'draft_current_effective_quantity',
            i.current_effective_quantity,
          'draft_prior_sent_quantity',
            i.prior_sent_quantity,
          'draft_available_quantity',
            i.available_quantity,

          'selected_send_quantity',
            i.selected_send_quantity,

          'ready_current_effective_quantity',
            i.ready_current_effective_quantity,
          'ready_prior_sent_quantity',
            i.ready_prior_sent_quantity,
          'ready_available_quantity',
            i.ready_available_quantity,
          'ready_validated_at',
            i.ready_validated_at
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
  public.mark_export_preparation_ready(
    uuid,
    uuid,
    text,
    text,
    text
  )
from
  public,
  anon,
  authenticated;


grant execute
on function
  public.mark_export_preparation_ready(
    uuid,
    uuid,
    text,
    text,
    text
  )
to
  service_role;


comment on function
  public.mark_export_preparation_ready(
    uuid,
    uuid,
    text,
    text,
    text
  )
is
  'Atomically revalidates one Export Preparation DRAFT against current same-Round truth and locks its destination as READY. READY is not a reservation and does not contribute to SENT cumulative.';

commit;
