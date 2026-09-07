-- P0-2C3C2A
-- Human Verification Correction Foundation
--
-- A PARSED message may be:
--   1. confirmed exactly as parsed, or
--   2. corrected by Staff and then confirmed.
--
-- Correction is intentionally separate from Review resolution.
-- It preserves the parser's original proposal while atomically
-- replacing canonical order_items with the human-confirmed result.

-- ============================================================
-- 1. Durable correction evidence
-- ============================================================

alter table public.message_verifications
  add column if not exists
    settlement_session_id uuid;

alter table public.message_verifications
  add column if not exists
    summary_group_id text;

alter table public.message_verifications
  add column if not exists
    summary_group_round_id uuid;

alter table public.message_verifications
  add column if not exists
    line_group_id text;

alter table public.message_verifications
  add column if not exists
    business_date date;

alter table public.message_verifications
  add column if not exists
    verification_mode text not null
      default 'CONFIRMED';

alter table public.message_verifications
  add column if not exists
    source_parser_version text;

alter table public.message_verifications
  add column if not exists
    source_normalized_text text;

alter table public.message_verifications
  add column if not exists
    source_order_items jsonb;

alter table public.message_verifications
  add column if not exists
    corrected_text text;

alter table public.message_verifications
  add column if not exists
    verified_first_order_code text;

alter table public.message_verifications
  add column if not exists
    canonical_mutation_applied boolean not null
      default false;


-- Existing Human Truth rows, if any, must acquire durable
-- lifecycle identity before message ownership is detached.
update public.message_verifications mv
set
  settlement_session_id =
    message.settlement_session_id,
  summary_group_id =
    message.summary_group_id,
  summary_group_round_id =
    message.summary_group_round_id,
  line_group_id =
    message.line_group_id,
  business_date =
    message.business_date,
  verified_first_order_code =
    coalesce(
      mv.verified_first_order_code,
      message.first_order_code
    )
from public.messages message
where
  message.id =
    mv.message_record_id
  and (
    mv.settlement_session_id is null
    or mv.summary_group_id is null
    or mv.summary_group_round_id is null
    or mv.line_group_id is null
    or mv.business_date is null
  );


do $$
begin
  if exists (
    select 1
    from public.message_verifications mv
    where
      mv.settlement_session_id is null
      or mv.summary_group_id is null
      or mv.summary_group_round_id is null
      or mv.line_group_id is null
      or mv.business_date is null
  ) then
    raise exception
      'MESSAGE_VERIFICATION_DURABLE_CONTEXT_BACKFILL_FAILED';
  end if;
end
$$;


alter table public.message_verifications
  alter column settlement_session_id
    set not null;

alter table public.message_verifications
  alter column summary_group_id
    set not null;

alter table public.message_verifications
  alter column summary_group_round_id
    set not null;

alter table public.message_verifications
  alter column line_group_id
    set not null;

alter table public.message_verifications
  alter column business_date
    set not null;


-- Human Truth must survive operational message purge.
--
-- message_record_id remains the immutable historical source identity,
-- but its lifetime is deliberately detached from public.messages.
alter table public.message_verifications
  drop constraint if exists
    message_verifications_message_record_id_fkey;


create index if not exists
  message_verifications_round_history_idx
on public.message_verifications (
  settlement_session_id,
  summary_group_id,
  summary_group_round_id,
  verified_at desc
);


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'message_verifications_mode_check'
      and conrelid =
        'public.message_verifications'::regclass
  ) then
    alter table public.message_verifications
      add constraint
        message_verifications_mode_check
      check (
        verification_mode in (
          'CONFIRMED',
          'CORRECTED'
        )
      );
  end if;


  if not exists (
    select 1
    from pg_constraint
    where conname =
      'message_verifications_correction_evidence_check'
      and conrelid =
        'public.message_verifications'::regclass
  ) then
    alter table public.message_verifications
      add constraint
        message_verifications_correction_evidence_check
      check (
        verification_mode <> 'CORRECTED'
        or (
          source_parser_version is not null
          and source_normalized_text is not null
          and source_order_items is not null
          and jsonb_typeof(source_order_items) = 'array'
          and jsonb_array_length(source_order_items) > 0
          and corrected_text is not null
          and btrim(corrected_text) <> ''
        )
      );
  end if;
end
$$;


comment on column
  public.message_verifications.message_record_id
is
  'Durable historical source message UUID. Deliberately has no FK to operational messages so Human Truth survives Round purge.';


comment on column
  public.message_verifications.verification_mode
is
  'Human Verification result: CONFIRMED accepts the parser proposal unchanged; CORRECTED records a Staff-corrected final snapshot.';


comment on column
  public.message_verifications.source_order_items
is
  'Canonical parser-proposed order_items immediately before a CORRECTED Human Verification decision.';


comment on column
  public.message_verifications.corrected_text
is
  'Human-entered source text that produced the final CORRECTED verification snapshot.';


comment on column
  public.message_verifications.verified_first_order_code
is
  'First order code belonging to the final Human Truth snapshot.';


comment on column
  public.message_verifications.canonical_mutation_applied
is
  'True only when a CORRECTED result was applied to mutable OPEN-Round canonical message/order rows. False for CONFIRMED and immutable CLOSED-Round correction.';


-- Existing verify_staff_message_order() intentionally keeps its
-- application/RPC contract unchanged. This trigger copies durable
-- lifecycle identity from the live message at verification INSERT.
create or replace function
  public.populate_message_verification_durable_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message
    public.messages%rowtype;
begin
  if new.message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      new.message_record_id;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id is null
    or v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
    or v_message.line_group_id is null
    or v_message.business_date is null
  then
    raise exception
      'MESSAGE_VERIFICATION_CONTEXT_REQUIRED';
  end if;


  -- Context is authoritative from the live message.
  new.settlement_session_id :=
    v_message.settlement_session_id;

  new.summary_group_id :=
    v_message.summary_group_id;

  new.summary_group_round_id :=
    v_message.summary_group_round_id;

  new.line_group_id :=
    v_message.line_group_id;

  new.business_date :=
    v_message.business_date;


  -- Existing CONFIRMED RPC does not explicitly send first code.
  -- CORRECTED RPC may provide the corrected Human Truth value,
  -- which must not be overwritten by the old canonical value.
  if new.verified_first_order_code is null then
    new.verified_first_order_code :=
      v_message.first_order_code;
  end if;


  return new;
end;
$$;


drop trigger if exists
  message_verifications_durable_context_before_insert_trg
on public.message_verifications;


create trigger
  message_verifications_durable_context_before_insert_trg
before insert
on public.message_verifications
for each row
execute function
  public.populate_message_verification_durable_context();


revoke all
on function
  public.populate_message_verification_durable_context()
from public, anon, authenticated;


-- ============================================================
-- 2. Atomic Staff correction + verification
-- ============================================================

create or replace function
  public.correct_staff_message_verification_order(
    p_message_record_id uuid,
    p_staff_id uuid,
    p_allowed_line_group_ids text[],
    p_settlement_session_id uuid,
    p_expected_lease_version bigint,
    p_expected_parser_version text,
    p_expected_normalized_text text,
    p_expected_order_items jsonb,
    p_corrected_text text,
    p_corrected_parser_version text,
    p_corrected_normalized_text text,
    p_corrected_order_items jsonb,
    p_corrected_first_order_code text
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz :=
    clock_timestamp();

  v_lock_settlement_session_id uuid;
  v_lock_summary_group_id text;
  v_lock_round_id uuid;

  v_message
    public.messages%rowtype;

  v_staff
    public.staff_accounts%rowtype;

  v_latest_round_id uuid;
  v_latest_round_status text;

  v_canonical_mutation_applied boolean :=
    false;

  v_claim
    public.staff_message_work_claims%rowtype;

  v_current_order_items jsonb;
  v_corrected_order_items jsonb;

  v_item jsonb;
  v_category text;
  v_code text;
  v_quantity integer;
  v_key text;

  v_seen_keys text[] :=
    array[]::text[];

  v_inserted integer := 0;
begin
  if p_message_record_id is null then
    raise exception
      'MESSAGE_RECORD_ID_REQUIRED';
  end if;


  if p_staff_id is null then
    raise exception
      'STAFF_ID_REQUIRED';
  end if;


  if p_settlement_session_id is null then
    raise exception
      'SETTLEMENT_SESSION_ID_REQUIRED';
  end if;


  if
    p_expected_lease_version is null
    or p_expected_lease_version <= 0
  then
    raise exception
      'LEASE_VERSION_REQUIRED';
  end if;


  if coalesce(
    btrim(p_expected_parser_version),
    ''
  ) = '' then
    raise exception
      'PARSER_VERSION_REQUIRED';
  end if;


  if p_expected_normalized_text is null then
    raise exception
      'NORMALIZED_TEXT_REQUIRED';
  end if;


  if
    p_expected_order_items is null
    or jsonb_typeof(
      p_expected_order_items
    ) <> 'array'
    or jsonb_array_length(
      p_expected_order_items
    ) = 0
  then
    raise exception
      'ORDER_ITEMS_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_text),
    ''
  ) = '' then
    raise exception
      'CORRECTED_TEXT_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_parser_version),
    ''
  ) = '' then
    raise exception
      'CORRECTED_PARSER_VERSION_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_normalized_text),
    ''
  ) = '' then
    raise exception
      'CORRECTED_NORMALIZED_TEXT_REQUIRED';
  end if;


  if
    p_corrected_order_items is null
    or jsonb_typeof(
      p_corrected_order_items
    ) <> 'array'
    or jsonb_array_length(
      p_corrected_order_items
    ) = 0
  then
    raise exception
      'CORRECTED_ORDER_ITEMS_REQUIRED';
  end if;


  if coalesce(
    btrim(p_corrected_first_order_code),
    ''
  ) = '' then
    raise exception
      'CORRECTED_FIRST_ORDER_CODE_REQUIRED';
  end if;


  -- Resolve only the identities required for lifecycle locks.
  -- This preliminary read does not authorize the operation.
  select
    m.settlement_session_id,
    m.summary_group_id,
    m.summary_group_round_id
  into
    v_lock_settlement_session_id,
    v_lock_summary_group_id,
    v_lock_round_id
  from public.messages m
  where
    m.id =
      p_message_record_id;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_lock_settlement_session_id
      is distinct from
        p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_lock_summary_group_id is null
    or v_lock_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Lock order matches Summary Group lifecycle mutation:
  --
  -- global settlement
  --   -> Summary Group
  --   -> exact message Staff claim
  perform pg_advisory_xact_lock(
    hashtextextended(
      'LINE_ORDER_SETTLEMENT_OPEN_CLOSE',
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SETTLEMENT_SUMMARY_GROUP_CONTROL',
        p_settlement_session_id::text,
        v_lock_summary_group_id
      ),
      0
    )
  );


  perform pg_advisory_xact_lock(
    hashtextextended(
      'staff-work-claim:'
      || p_message_record_id::text,
      0
    )
  );


  -- Parent settlement remains OPEN for the entire transaction.
  perform 1
  from public.settlement_sessions s
  where
    s.id =
      p_settlement_session_id
    and s.status =
      'OPEN'
  for share;


  if not found then
    raise exception
      'SETTLEMENT_NOT_OPEN';
  end if;


  -- Hold Staff active state through the mutation.
  select s.*
  into v_staff
  from public.staff_accounts s
  where
    s.id =
      p_staff_id
    and s.enabled =
      true
  for share;


  if not found then
    raise exception
      'STAFF_NOT_ACTIVE';
  end if;


  -- Message snapshot is authoritative.
  select m.*
  into v_message
  from public.messages m
  where
    m.id =
      p_message_record_id
  for update;


  if not found then
    raise exception
      'MESSAGE_NOT_FOUND';
  end if;


  if
    v_message.settlement_session_id
      is distinct from
        p_settlement_session_id
  then
    raise exception
      'MESSAGE_OUTSIDE_CURRENT_SETTLEMENT';
  end if;


  if
    v_message.summary_group_id is null
    or v_message.summary_group_round_id is null
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  if
    v_message.summary_group_id
      is distinct from
        v_lock_summary_group_id
    or
    v_message.summary_group_round_id
      is distinct from
        v_lock_round_id
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  if v_message.unsent then
    raise exception
      'MESSAGE_ALREADY_UNSENT';
  end if;


  if v_message.parse_status <> 'PARSED' then
    raise exception
      'MESSAGE_NOT_READY_FOR_VERIFICATION';
  end if;


  -- Server-resolved LINE Group scope is mandatory.
  if not (
    v_message.line_group_id =
      any(
        coalesce(
          p_allowed_line_group_ids,
          array[]::text[]
        )
      )
  ) then
    raise exception
      'MESSAGE_OUTSIDE_STAFF_SCOPE';
  end if;


  -- Settlement mapping must still match the message snapshot.
  perform 1
  from public.settlement_line_group_config cfg
  where
    cfg.settlement_session_id =
      p_settlement_session_id
    and cfg.line_group_id =
      v_message.line_group_id
    and cfg.summary_group_id =
      v_message.summary_group_id;


  if not found then
    raise exception
      'MESSAGE_LINE_GROUP_CONFIG_MISMATCH';
  end if;


  -- Non-admin Staff must still own the LINE Group.
  if upper(
    coalesce(
      v_staff.role,
      ''
    )
  ) <> 'ADMIN'
  then
    perform 1
    from public.line_group_staff_assignments a
    where
      a.staff_id =
        p_staff_id
      and a.line_group_id =
        v_message.line_group_id
      and a.enabled =
        true
    for share;


    if not found then
      raise exception
        'MESSAGE_OUTSIDE_STAFF_SCOPE';
    end if;
  end if;


  -- Latest Round is authoritative even when that latest Round
  -- has already CLOSED. Intake close must not block Human
  -- Verification, but CLOSED canonical rows remain immutable.
  select
    r.id,
    r.status
  into
    v_latest_round_id,
    v_latest_round_status
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id =
      p_settlement_session_id
    and r.summary_group_id =
      v_message.summary_group_id
  order by
    r.round_no desc
  limit 1;


  if
    v_latest_round_id is null
    or v_message.summary_group_round_id
      is distinct from
        v_latest_round_id
    or v_latest_round_status
      not in (
        'OPEN',
        'CLOSED'
      )
  then
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Exact ORIGINAL parser proposal.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category',
            oi.category,
          'code',
            oi.code,
          'quantity',
            oi.quantity
        )
        order by
          oi.category,
          oi.code,
          oi.quantity
      ),
      '[]'::jsonb
    )
  into
    v_current_order_items
  from public.order_items oi
  where
    oi.message_record_id =
      p_message_record_id;


  if jsonb_array_length(
    v_current_order_items
  ) = 0 then
    raise exception
      'MESSAGE_HAS_NO_ORDER_ITEMS';
  end if;


  if
    v_current_order_items
      is distinct from
        p_expected_order_items
    or v_message.parser_version
      is distinct from
        p_expected_parser_version
    or v_message.normalized_text
      is distinct from
        p_expected_normalized_text
  then
    raise exception
      'VERIFICATION_SOURCE_CHANGED';
  end if;


  if exists (
    select 1
    from public.message_verifications mv
    where
      mv.message_record_id =
        p_message_record_id
  ) then
    raise exception
      'MESSAGE_ALREADY_VERIFIED';
  end if;


  -- Exact lease ownership.
  select c.*
  into v_claim
  from public.staff_message_work_claims c
  where
    c.message_record_id =
      p_message_record_id
  for update;


  if not found then
    raise exception
      'CLAIM_REQUIRED';
  end if;


  if v_claim.claim_expires_at <= v_now then
    raise exception
      'CLAIM_EXPIRED';
  end if;


  if
    v_claim.staff_id
      is distinct from
        p_staff_id
  then
    raise exception
      'CLAIM_OWNED_BY_OTHER';
  end if;


  if
    v_claim.lease_version
      is distinct from
        p_expected_lease_version
  then
    raise exception
      'STALE_CLAIM_VERSION';
  end if;


  -- Validate corrected parser proposal before touching canonical rows.
  for v_item in
    select value
    from jsonb_array_elements(
      p_corrected_order_items
    )
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception
        'INVALID_CORRECTED_ITEM';
    end if;


    v_category :=
      upper(
        btrim(
          v_item ->> 'category'
        )
      );

    v_code :=
      btrim(
        v_item ->> 'code'
      );


    begin
      v_quantity :=
        (v_item ->> 'quantity')::integer;
    exception
      when others then
        raise exception
          'INVALID_CORRECTED_ITEM_QUANTITY';
    end;


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
        'INVALID_CORRECTED_ITEM_CATEGORY';
    end if;


    if coalesce(
      v_code,
      ''
    ) = '' then
      raise exception
        'INVALID_CORRECTED_ITEM_CODE';
    end if;


    if v_quantity <= 0 then
      raise exception
        'INVALID_CORRECTED_ITEM_QUANTITY';
    end if;


    v_key :=
      v_category
      || '|'
      || v_code;


    if v_key = any(
      v_seen_keys
    ) then
      raise exception
        'DUPLICATE_CORRECTED_ITEM';
    end if;


    v_seen_keys :=
      array_append(
        v_seen_keys,
        v_key
      );
  end loop;


  -- OPEN Round:
  --
  -- Human correction becomes operational canonical truth.
  --
  -- CLOSED Round:
  --
  -- Closed canonical message/order rows are immutable. The corrected
  -- Human Truth is persisted only in message_verifications.
  if v_latest_round_status = 'OPEN' then

    delete from
      public.order_items
    where
      message_record_id =
        p_message_record_id;


    for v_item in
      select value
      from jsonb_array_elements(
        p_corrected_order_items
      )
    loop
      v_category :=
        upper(
          btrim(
            v_item ->> 'category'
          )
        );

      v_code :=
        btrim(
          v_item ->> 'code'
        );

      v_quantity :=
        (v_item ->> 'quantity')::integer;


      insert into public.order_items (
        message_record_id,
        business_date,
        line_group_id,
        summary_group_id,
        category,
        code,
        quantity,
        unsent_flag,
        parser_version,
        settlement_session_id
      )
      values (
        v_message.id,
        v_message.business_date,
        v_message.line_group_id,
        v_message.summary_group_id,
        v_category,
        v_code,
        v_quantity,
        false,
        p_corrected_parser_version,
        v_message.settlement_session_id
      );


      -- summary_group_round_id is deliberately omitted.
      -- order_items_round_ownership_trg inherits and validates
      -- immutable Round ownership from the authoritative message.
      v_inserted :=
        v_inserted + 1;
    end loop;


    if
      v_inserted
        <> jsonb_array_length(
          p_corrected_order_items
        )
    then
      raise exception
        'CORRECTED_ITEM_COUNT_MISMATCH';
    end if;


    update public.messages
    set
      normalized_text =
        p_corrected_normalized_text,
      parse_status =
        'PARSED',
      parser_version =
        p_corrected_parser_version,
      first_order_code =
        p_corrected_first_order_code
    where
      id =
        p_message_record_id;


    -- Re-read exactly what became operational canonical truth.
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'category',
              oi.category,
            'code',
              oi.code,
            'quantity',
              oi.quantity
          )
          order by
            oi.category,
            oi.code,
            oi.quantity
        ),
        '[]'::jsonb
      )
    into
      v_corrected_order_items
    from public.order_items oi
    where
      oi.message_record_id =
        p_message_record_id;


    if jsonb_array_length(
      v_corrected_order_items
    ) <> v_inserted then
      raise exception
        'CORRECTED_ITEM_COUNT_MISMATCH';
    end if;


    if
      v_corrected_order_items
        is distinct from
          p_corrected_order_items
    then
      raise exception
        'CORRECTED_CANONICAL_SNAPSHOT_MISMATCH';
    end if;


    v_canonical_mutation_applied :=
      true;

  elsif v_latest_round_status = 'CLOSED' then

    -- Human Truth may advance after intake close, but operational
    -- canonical rows from the closed Round must never be rewritten.
    v_corrected_order_items :=
      p_corrected_order_items;

    v_inserted :=
      jsonb_array_length(
        p_corrected_order_items
      );

    v_canonical_mutation_applied :=
      false;

  else
    raise exception
      'MESSAGE_ROUND_NOT_CURRENT';
  end if;


  -- Preserve both the parser proposal and final Human Truth.
  --
  -- Durable lifecycle identity is written explicitly here; the INSERT
  -- trigger independently enforces the same context from the live
  -- message and also serves the unchanged CONFIRMED verification RPC.
  insert into
    public.message_verifications (
      message_record_id,
      settlement_session_id,
      summary_group_id,
      summary_group_round_id,
      line_group_id,
      business_date,
      verified_at,
      verified_by_staff_id,
      verified_by_staff_code,
      verified_by_display_name,
      verified_parser_version,
      verified_normalized_text,
      verified_order_items,
      verified_first_order_code,
      verification_mode,
      source_parser_version,
      source_normalized_text,
      source_order_items,
      corrected_text,
      canonical_mutation_applied
    )
  values (
    p_message_record_id,
    v_message.settlement_session_id,
    v_message.summary_group_id,
    v_message.summary_group_round_id,
    v_message.line_group_id,
    v_message.business_date,
    v_now,
    v_staff.id,
    v_staff.staff_code,
    v_staff.display_name,
    p_corrected_parser_version,
    p_corrected_normalized_text,
    v_corrected_order_items,
    p_corrected_first_order_code,
    'CORRECTED',
    v_message.parser_version,
    v_message.normalized_text,
    v_current_order_items,
    p_corrected_text,
    v_canonical_mutation_applied
  );


  delete from
    public.staff_message_work_claims
  where
    message_record_id =
      p_message_record_id
    and staff_id =
      p_staff_id
    and lease_version =
      p_expected_lease_version;


  if not found then
    raise exception
      'CLAIM_RELEASE_FAILED';
  end if;


  return jsonb_build_object(
    'ok',
      true,
    'status',
      'VERIFIED',
    'verification_mode',
      'CORRECTED',
    'message_record_id',
      p_message_record_id,
    'verified_at',
      v_now,
    'verified_by_staff_id',
      v_staff.id,
    'verified_by_staff_code',
      v_staff.staff_code,
    'verified_by_display_name',
      v_staff.display_name,
    'parser_version',
      p_corrected_parser_version,
    'first_order_code',
      p_corrected_first_order_code,
    'round_status',
      v_latest_round_status,
    'canonical_mutation_applied',
      v_canonical_mutation_applied,
    'items_count',
      v_inserted
  );

end;
$$;


-- ============================================================
-- 3. Security boundary
-- ============================================================

revoke all
on function
  public.correct_staff_message_verification_order(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    text,
    text,
    jsonb,
    text,
    text,
    text,
    jsonb,
    text
  )
from public, anon, authenticated;


grant execute
on function
  public.correct_staff_message_verification_order(
    uuid,
    uuid,
    text[],
    uuid,
    bigint,
    text,
    text,
    jsonb,
    text,
    text,
    text,
    jsonb,
    text
  )
to service_role;
