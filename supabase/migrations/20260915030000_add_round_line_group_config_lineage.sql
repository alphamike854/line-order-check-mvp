-- Round LINE Group Config Lineage Foundation v14B1
--
-- Architecture:
--
-- settlement_line_group_config
--   = current/future admission route inside the compatibility
--     settlement session.
--
-- settlement_line_group_round_config
--   = immutable LINE Group config lineage for one
--     Summary Group Round.
--
-- Accepted message ownership remains immutable.
--
-- This migration deliberately DOES NOT:
-- - remap any LINE Group
-- - rewrite messages
-- - rewrite order_items
-- - change save_line_group_live
-- - auto-open any Summary Group
--
-- Future remap semantics are ROUND_BOUNDARY_ONLY.

begin;


-- ============================================================
-- 1. Immutable Round -> LINE Group lineage
-- ============================================================

create table if not exists
  public.settlement_line_group_round_config (
    round_id uuid not null
      references
        public.settlement_summary_group_rounds(id)
      on delete cascade,

    line_group_id text not null,

    line_group_name text not null,

    reduction_pct numeric(7,3) not null
      default 0
      check (
        reduction_pct >= 0
        and reduction_pct <= 100
      ),

    capture_source text not null
      check (
        capture_source in (
          'ROUND_OPEN',
          'BACKFILL_OPEN_ROUTE',
          'BACKFILL_OBSERVED'
        )
      ),

    captured_at timestamptz not null
      default now(),

    primary key (
      round_id,
      line_group_id
    )
  );


comment on table
  public.settlement_line_group_round_config
is
  'Immutable LINE Group routing/config lineage captured per Summary Group Round. Current admission routing remains in settlement_line_group_config.';


comment on column
  public.settlement_line_group_round_config.capture_source
is
  'ROUND_OPEN = captured at new Round creation; BACKFILL_OPEN_ROUTE = enabled route for an existing OPEN Round; BACKFILL_OBSERVED = observed provenance for an existing CLOSED Round.';


create index if not exists
  settlement_line_group_round_config_line_lookup_idx
on public.settlement_line_group_round_config (
  line_group_id,
  round_id
);


alter table
  public.settlement_line_group_round_config
enable row level security;


revoke all
on table
  public.settlement_line_group_round_config
from
  public,
  anon,
  authenticated,
  service_role;


grant select
on table
  public.settlement_line_group_round_config
to service_role;


-- ============================================================
-- 2. Capture lineage atomically when OPEN_GROUP creates Round
--
-- Trigger execution remains inside the OPEN_GROUP transaction.
-- Failure therefore aborts Round creation.
-- ============================================================

create or replace function
  public.capture_settlement_line_group_round_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if new.status <> 'OPEN' then
    return new;
  end if;


  if not exists (
    select 1
    from
      public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id =
        new.settlement_session_id

      and cfg.summary_group_id =
        new.summary_group_id

      and cfg.enabled = true
  ) then
    raise exception
      'ROUND_LINE_GROUP_CONFIG_REQUIRED';
  end if;


  insert into
    public.settlement_line_group_round_config (
      round_id,
      line_group_id,
      line_group_name,
      reduction_pct,
      capture_source,
      captured_at
    )
  select
    new.id,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.reduction_pct,
    'ROUND_OPEN',
    now()
  from
    public.settlement_line_group_config cfg
  where
    cfg.settlement_session_id =
      new.settlement_session_id

    and cfg.summary_group_id =
      new.summary_group_id

    and cfg.enabled = true

  on conflict (
    round_id,
    line_group_id
  )
  do nothing;


  if not exists (
    select 1
    from
      public.settlement_line_group_round_config lineage
    where
      lineage.round_id = new.id
  ) then
    raise exception
      'ROUND_LINE_GROUP_CONFIG_REQUIRED';
  end if;


  return new;
end;
$$;


revoke all
on function
  public.capture_settlement_line_group_round_config()
from
  public,
  anon,
  authenticated,
  service_role;


drop trigger if exists
  settlement_round_capture_line_group_config_trg
on public.settlement_summary_group_rounds;


create trigger
  settlement_round_capture_line_group_config_trg
after insert
on public.settlement_summary_group_rounds
for each row
when (new.status = 'OPEN')
execute function
  public.capture_settlement_line_group_round_config();


-- ============================================================
-- 3. Conservative pre-foundation backfill
--
-- No historical remap is guessed.
--
-- OPEN:
--   capture current enabled admission route.
--
-- CLOSED + non-archived:
--   capture only LINE Groups observed through immutable
--   Round-owned messages/order_items.
--
-- Any contradiction aborts the migration.
-- ============================================================

do $$
declare
  v_bad_round_id uuid;
begin

  -- ----------------------------------------------------------
  -- A. Message ownership must agree with its Round.
  -- ----------------------------------------------------------

  select
    r.id
  into
    v_bad_round_id
  from
    public.messages m
  join
    public.settlement_summary_group_rounds r
      on r.id =
        m.summary_group_round_id
  where
    not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

    and (
      m.settlement_session_id
        is distinct from
          r.settlement_session_id

      or m.summary_group_id
        is distinct from
          r.summary_group_id
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_MESSAGE_OWNERSHIP_MISMATCH:%',
      v_bad_round_id;
  end if;


  v_bad_round_id := null;


  -- ----------------------------------------------------------
  -- B. order_items ownership must agree with its Round.
  -- ----------------------------------------------------------

  select
    r.id
  into
    v_bad_round_id
  from
    public.order_items oi
  join
    public.settlement_summary_group_rounds r
      on r.id =
        oi.summary_group_round_id
  where
    not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

    and (
      oi.settlement_session_id
        is distinct from
          r.settlement_session_id

      or oi.summary_group_id
        is distinct from
          r.summary_group_id
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_ITEM_OWNERSHIP_MISMATCH:%',
      v_bad_round_id;
  end if;


  v_bad_round_id := null;


  -- ----------------------------------------------------------
  -- C. Every observed message LINE Group must have an exact
  --    session + Summary Group config row.
  --
  -- Never infer through live line_groups master.
  -- ----------------------------------------------------------

  select
    r.id
  into
    v_bad_round_id
  from
    public.messages m
  join
    public.settlement_summary_group_rounds r
      on r.id =
        m.summary_group_round_id
  where
    not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

    and not exists (
      select 1
      from
        public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id =
          r.settlement_session_id

        and cfg.line_group_id =
          m.line_group_id

        and cfg.summary_group_id =
          r.summary_group_id
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_MESSAGE_ROUTE_AMBIGUOUS:%',
      v_bad_round_id;
  end if;


  v_bad_round_id := null;


  -- ----------------------------------------------------------
  -- D. Same exact config requirement for observed order_items.
  -- ----------------------------------------------------------

  select
    r.id
  into
    v_bad_round_id
  from
    public.order_items oi
  join
    public.settlement_summary_group_rounds r
      on r.id =
        oi.summary_group_round_id
  where
    not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

    and not exists (
      select 1
      from
        public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id =
          r.settlement_session_id

        and cfg.line_group_id =
          oi.line_group_id

        and cfg.summary_group_id =
          r.summary_group_id
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_ITEM_ROUTE_AMBIGUOUS:%',
      v_bad_round_id;
  end if;


  v_bad_round_id := null;


  -- ----------------------------------------------------------
  -- E. Existing OPEN Round requires an enabled admission route.
  -- ----------------------------------------------------------

  select
    r.id
  into
    v_bad_round_id
  from
    public.settlement_summary_group_rounds r
  where
    r.status = 'OPEN'

    and not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

    and not exists (
      select 1
      from
        public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id =
          r.settlement_session_id

        and cfg.summary_group_id =
          r.summary_group_id

        and cfg.enabled = true
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_OPEN_ROUTE_REQUIRED:%',
      v_bad_round_id;
  end if;


  v_bad_round_id := null;


  -- ----------------------------------------------------------
  -- E2. Every LINE Group already observed in an OPEN Round
  --     must still be part of that Round's enabled route.
  --
  -- OPEN backfill captures enabled routes only. Therefore a
  -- previously observed but now-disabled route cannot be
  -- silently omitted from lineage.
  -- ----------------------------------------------------------

  with open_observed as (
    select
      r.id as round_id,
      r.settlement_session_id,
      r.summary_group_id,
      m.line_group_id
    from
      public.settlement_summary_group_rounds r
    join
      public.messages m
        on m.summary_group_round_id = r.id
    where
      r.status = 'OPEN'

      and not exists (
        select 1
        from
          public.settlement_summary_group_round_snapshots snapshot
        where
          snapshot.round_id = r.id
      )

    union

    select
      r.id as round_id,
      r.settlement_session_id,
      r.summary_group_id,
      oi.line_group_id
    from
      public.settlement_summary_group_rounds r
    join
      public.order_items oi
        on oi.summary_group_round_id = r.id
    where
      r.status = 'OPEN'

      and not exists (
        select 1
        from
          public.settlement_summary_group_round_snapshots snapshot
        where
          snapshot.round_id = r.id
      )
  )
  select
    observed.round_id
  into
    v_bad_round_id
  from
    open_observed observed
  where
    not exists (
      select 1
      from
        public.settlement_line_group_config cfg
      where
        cfg.settlement_session_id =
          observed.settlement_session_id

        and cfg.line_group_id =
          observed.line_group_id

        and cfg.summary_group_id =
          observed.summary_group_id

        and cfg.enabled = true
    )
  limit 1;


  if v_bad_round_id is not null then
    raise exception
      'ROUND_LINE_GROUP_BACKFILL_OPEN_OBSERVED_ROUTE_DISABLED:%',
      v_bad_round_id;
  end if;


  -- ----------------------------------------------------------
  -- F. Existing OPEN Round:
  --    capture current enabled admission route.
  -- ----------------------------------------------------------

  insert into
    public.settlement_line_group_round_config (
      round_id,
      line_group_id,
      line_group_name,
      reduction_pct,
      capture_source,
      captured_at
    )
  select
    r.id,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.reduction_pct,
    'BACKFILL_OPEN_ROUTE',
    now()
  from
    public.settlement_summary_group_rounds r
  join
    public.settlement_line_group_config cfg
      on cfg.settlement_session_id =
           r.settlement_session_id

     and cfg.summary_group_id =
           r.summary_group_id

     and cfg.enabled = true
  where
    r.status = 'OPEN'

    and not exists (
      select 1
      from
        public.settlement_summary_group_round_snapshots snapshot
      where
        snapshot.round_id = r.id
    )

  on conflict (
    round_id,
    line_group_id
  )
  do nothing;


  -- ----------------------------------------------------------
  -- G. Existing CLOSED non-archived Round:
  --    preserve only actually observed LINE Group provenance.
  -- ----------------------------------------------------------

  with closed_rounds as (
    select
      r.id,
      r.settlement_session_id,
      r.summary_group_id
    from
      public.settlement_summary_group_rounds r
    where
      r.status = 'CLOSED'

      and not exists (
        select 1
        from
          public.settlement_summary_group_round_snapshots snapshot
        where
          snapshot.round_id = r.id
      )
  ),

  observed_line_groups as (
    select
      r.id as round_id,
      r.settlement_session_id,
      r.summary_group_id,
      m.line_group_id
    from
      closed_rounds r
    join
      public.messages m
        on m.summary_group_round_id = r.id

    union

    select
      r.id as round_id,
      r.settlement_session_id,
      r.summary_group_id,
      oi.line_group_id
    from
      closed_rounds r
    join
      public.order_items oi
        on oi.summary_group_round_id = r.id
  )

  insert into
    public.settlement_line_group_round_config (
      round_id,
      line_group_id,
      line_group_name,
      reduction_pct,
      capture_source,
      captured_at
    )
  select
    observed.round_id,
    cfg.line_group_id,
    cfg.line_group_name,
    cfg.reduction_pct,
    'BACKFILL_OBSERVED',
    now()
  from
    observed_line_groups observed
  join
    public.settlement_line_group_config cfg
      on cfg.settlement_session_id =
           observed.settlement_session_id

     and cfg.line_group_id =
           observed.line_group_id

     and cfg.summary_group_id =
           observed.summary_group_id

  on conflict (
    round_id,
    line_group_id
  )
  do nothing;

end;
$$;


comment on function
  public.capture_settlement_line_group_round_config()
is
  'V14B1 Round lineage boundary. Every new OPEN Summary Group Round atomically captures its enabled settlement LINE Group route.';


commit;
