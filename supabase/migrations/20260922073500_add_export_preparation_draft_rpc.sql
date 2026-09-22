-- Export Preparation v1 — Phase 2B
--
-- Atomic DRAFT preparation only.
--
-- Guarantees:
-- * exact OPEN Summary Group Round
-- * server/DB recomputes current quantity
-- * prior quantity comes only from SENT cycles in same Round
-- * selected quantity cannot exceed current availability
-- * DRAFT does not affect SENT cumulative
-- * retry-safe via client_request_id
-- * no LINE / Allocation / Risk mutation

begin;

alter table
  public.settlement_export_cycles
add column if not exists
  client_request_id uuid;

alter table
  public.settlement_export_cycles
add column if not exists
  request_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where
      conname =
        'settlement_export_cycles_request_fingerprint_check'
      and conrelid =
        'public.settlement_export_cycles'::regclass
  ) then
    alter table
      public.settlement_export_cycles
    add constraint
      settlement_export_cycles_request_fingerprint_check
    check (
      request_fingerprint is null
      or request_fingerprint ~ '^[0-9a-f]{32}$'
    );
  end if;
end
$$;

create unique index if not exists
  settlement_export_cycles_request_id_idx
on public.settlement_export_cycles (
  summary_group_round_id,
  client_request_id
)
where
  client_request_id is not null;


create or replace function
  public.create_export_preparation_draft(
    p_summary_group_round_id uuid,
    p_client_request_id uuid,
    p_items jsonb,
    p_created_by text default 'DASHBOARD'
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round
    public.settlement_summary_group_rounds%rowtype;

  v_existing
    public.settlement_export_cycles%rowtype;

  v_cycle
    public.settlement_export_cycles%rowtype;

  v_snapshot jsonb;
  v_risk_row jsonb;
  v_item jsonb;

  v_prepared_items jsonb :=
    '[]'::jsonb;

  v_existing_items jsonb :=
    '[]'::jsonb;

  v_seen jsonb :=
    '{}'::jsonb;

  v_category text;
  v_code text;
  v_identity text;
  v_selected_text text;

  v_selected bigint;
  v_current bigint;
  v_prior bigint;
  v_available bigint;

  v_cycle_no integer;

  v_request_fingerprint text :=
    md5(
      coalesce(
        p_items,
        'null'::jsonb
      )::text
    );
begin

  if p_summary_group_round_id is null then
    raise exception
      'EXPORT_ROUND_REQUIRED';
  end if;

  if p_client_request_id is null then
    raise exception
      'EXPORT_CLIENT_REQUEST_ID_REQUIRED';
  end if;

  if
    p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    raise exception
      'EXPORT_ITEMS_INVALID';
  end if;

  if
    jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 200
  then
    raise exception
      'EXPORT_ITEMS_COUNT_INVALID';
  end if;

  /*
   * Serialize all DRAFT creation for one Round.
   *
   * This makes cycle_no deterministic and also protects
   * the current/SENT availability snapshot used below.
   */
  perform pg_advisory_xact_lock(
    hashtextextended(
      'EXPORT_PREPARATION_DRAFT:'
      || p_summary_group_round_id::text,
      0
    )
  );

  select
    r.*
  into
    v_round
  from
    public.settlement_summary_group_rounds r
  where
    r.id =
      p_summary_group_round_id
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
   * Retry safety.
   *
   * Same client_request_id + same request:
   * return the existing DRAFT.
   *
   * Same id + different request:
   * fail closed.
   */
  select
    c.*
  into
    v_existing
  from
    public.settlement_export_cycles c
  where
    c.summary_group_round_id =
      p_summary_group_round_id
    and c.client_request_id =
      p_client_request_id
  limit 1;

  if found then

    if
      v_existing.request_fingerprint
      is distinct from
      v_request_fingerprint
    then
      raise exception
        'EXPORT_CLIENT_REQUEST_CONFLICT';
    end if;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',
              i.category,
            'code',
              i.code,
            'current_effective_quantity',
              i.current_effective_quantity,
            'prior_sent_quantity',
              i.prior_sent_quantity,
            'available_quantity',
              i.available_quantity,
            'selected_send_quantity',
              i.selected_send_quantity
          )
          order by
            i.category,
            i.code
        ),
        '[]'::jsonb
      )
    into
      v_existing_items
    from
      public.settlement_export_items i
    where
      i.cycle_id =
        v_existing.id;

    return jsonb_build_object(
      'ok', true,
      'created', false,
      'idempotent_replay', true,
      'cycle', to_jsonb(v_existing),
      'items', v_existing_items
    );
  end if;


  /*
   * Current code truth is the same canonical
   * Dashboard Risk snapshot used by Phase 2A.
   *
   * No client-supplied current/prior/available values
   * participate in this mutation.
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


  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    if jsonb_typeof(v_item) <> 'object' then
      raise exception
        'EXPORT_ITEM_INVALID';
    end if;

    v_category :=
      upper(
        trim(
          coalesce(
            v_item ->> 'category',
            ''
          )
        )
      );

    v_code :=
      trim(
        coalesce(
          v_item ->> 'code',
          ''
        )
      );

    v_selected_text :=
      trim(
        coalesce(
          v_item
            ->> 'selected_send_quantity',
          ''
        )
      );

    if v_category not in (
      'A',
      'B',
      'E',
      'F',
      'G',
      'H',
      'L'
    ) then
      raise exception
        'EXPORT_CATEGORY_INVALID';
    end if;

    if v_code !~ '^[0-9]{1,3}$' then
      raise exception
        'EXPORT_CODE_INVALID';
    end if;

    if
      v_selected_text = ''
      or v_selected_text !~ '^[0-9]+$'
    then
      raise exception
        'EXPORT_SELECTED_QUANTITY_INVALID';
    end if;

    begin
      v_selected :=
        v_selected_text::bigint;
    exception
      when numeric_value_out_of_range then
        raise exception
          'EXPORT_SELECTED_QUANTITY_INVALID';
    end;

    if v_selected <= 0 then
      raise exception
        'EXPORT_SELECTED_QUANTITY_INVALID';
    end if;

    v_identity :=
      v_category
      || ':'
      || v_code;

    if v_seen ? v_identity then
      raise exception
        'EXPORT_DUPLICATE_CODE';
    end if;

    v_seen :=
      v_seen
      || jsonb_build_object(
        v_identity,
        true
      );


    /*
     * Current effective quantity.
     *
     * If a code no longer exists in current truth,
     * current = 0 and therefore no positive DRAFT
     * can be prepared for it.
     */
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
        v_category
      and x.value
        ->> 'code'
          =
        v_code
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
     * Only SENT contributes to prior cumulative.
     * DRAFT and READY are intentionally ignored.
     */
    select
      s.sent_cumulative_quantity
    into
      v_prior
    from
      public.settlement_export_sent_totals s
    where
      s.summary_group_round_id =
        p_summary_group_round_id
      and s.category =
        v_category
      and s.code =
        v_code;

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

    if v_selected > v_available then
      raise exception
        'EXPORT_QUANTITY_EXCEEDS_AVAILABLE';
    end if;


    v_prepared_items :=
      v_prepared_items
      || jsonb_build_array(
        jsonb_build_object(
          'category',
            v_category,
          'code',
            v_code,
          'current_effective_quantity',
            v_current,
          'prior_sent_quantity',
            v_prior,
          'available_quantity',
            v_available,
          'selected_send_quantity',
            v_selected
        )
      );

  end loop;


  select
    coalesce(
      max(c.cycle_no),
      0
    ) + 1
  into
    v_cycle_no
  from
    public.settlement_export_cycles c
  where
    c.summary_group_round_id =
      p_summary_group_round_id;


  insert into
    public.settlement_export_cycles (
      summary_group_round_id,
      cycle_no,
      status,
      client_request_id,
      request_fingerprint,
      created_by
    )
  values (
    p_summary_group_round_id,
    v_cycle_no,
    'DRAFT',
    p_client_request_id,
    v_request_fingerprint,
    coalesce(
      nullif(
        trim(p_created_by),
        ''
      ),
      'DASHBOARD'
    )
  )
  returning *
  into
    v_cycle;


  insert into
    public.settlement_export_items (
      cycle_id,
      category,
      code,
      current_effective_quantity,
      prior_sent_quantity,
      available_quantity,
      selected_send_quantity
    )
  select
    v_cycle.id,
    x.category,
    x.code,
    x.current_effective_quantity,
    x.prior_sent_quantity,
    x.available_quantity,
    x.selected_send_quantity
  from jsonb_to_recordset(
    v_prepared_items
  ) as x(
    category text,
    code text,
    current_effective_quantity bigint,
    prior_sent_quantity bigint,
    available_quantity bigint,
    selected_send_quantity bigint
  );


  return jsonb_build_object(
    'ok', true,
    'created', true,
    'idempotent_replay', false,
    'cycle', to_jsonb(v_cycle),
    'items', v_prepared_items
  );

end;
$$;


revoke all
on function
  public.create_export_preparation_draft(
    uuid,
    uuid,
    jsonb,
    text
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.create_export_preparation_draft(
    uuid,
    uuid,
    jsonb,
    text
  )
to
  service_role;


comment on function
  public.create_export_preparation_draft(
    uuid,
    uuid,
    jsonb,
    text
  )
is
  'Atomically creates an Export Preparation DRAFT from current Summary Group Round truth. Recomputes current/SENT availability in DB; performs no LINE or Allocation mutation.';

commit;
