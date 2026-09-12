-- DR1A
-- Daily Summary Group Round Identity
--
-- Business contract:
-- - Round lifecycle remains independent per Summary Group.
-- - round_no remains the immutable internal sequence.
-- - business_date is the Bangkok calendar date on which a Round opens.
-- - daily_round_no starts at 1 for each Summary Group + business_date.
-- - A Round may remain OPEN across midnight without changing business_date.
-- - Opening again on a later date starts daily_round_no at 1.
--
-- This migration is additive.
-- It does NOT:
-- - purge messages/order_items/review data
-- - change existing round ownership
-- - change OPEN_GROUP/CLOSE_GROUP RPC signatures
-- - close any Round
-- - open any Round
-- - rewrite round_no
-- - change parent settlement lifecycle


alter table
  public.settlement_summary_group_rounds
add column if not exists
  business_date date;


alter table
  public.settlement_summary_group_rounds
add column if not exists
  daily_round_no integer;


-- Backfill historical business identity from the authoritative
-- opened_at timestamp using Thailand business time.
--
-- Existing round_no is deliberately NOT changed.
with ranked as (
  select
    r.id,

    (
      r.opened_at
        at time zone 'Asia/Bangkok'
    )::date
      as business_date,

    row_number() over (
      partition by
        r.summary_group_id,
        (
          r.opened_at
            at time zone 'Asia/Bangkok'
        )::date

      order by
        r.opened_at,
        r.round_no,
        r.id
    )::integer
      as daily_round_no

  from
    public.settlement_summary_group_rounds r
)
update
  public.settlement_summary_group_rounds r
set
  business_date =
    ranked.business_date,

  daily_round_no =
    ranked.daily_round_no,

  updated_at =
    greatest(
      r.updated_at,
      r.opened_at
    )

from ranked
where
  ranked.id = r.id
  and (
    r.business_date is null
    or r.daily_round_no is null
  );


alter table
  public.settlement_summary_group_rounds
alter column
  business_date
set not null;


alter table
  public.settlement_summary_group_rounds
alter column
  daily_round_no
set not null;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where
      conname =
        'settlement_summary_group_rounds_daily_round_no_check'
      and conrelid =
        'public.settlement_summary_group_rounds'::regclass
  ) then
    alter table
      public.settlement_summary_group_rounds

    add constraint
      settlement_summary_group_rounds_daily_round_no_check

    check (
      daily_round_no > 0
    );
  end if;
end
$$;


-- Business identity:
-- Summary Group + Bangkok business date + daily round number.
--
-- Do not include settlement_session_id here. A future compatibility
-- container change must not restart the business round numbering for
-- the same Summary Group/date.
create unique index if not exists
  settlement_summary_group_rounds_daily_identity_uidx

on public.settlement_summary_group_rounds (
  summary_group_id,
  business_date,
  daily_round_no
);


create index if not exists
  settlement_summary_group_rounds_daily_lookup_idx

on public.settlement_summary_group_rounds (
  settlement_session_id,
  summary_group_id,
  business_date desc,
  daily_round_no desc
);


create or replace function
  public.assign_summary_group_round_daily_identity()

returns trigger

language plpgsql

set search_path = public

as $$
declare
  v_opened_at timestamptz;

begin
  v_opened_at :=
    coalesce(
      new.opened_at,
      now()
    );


  if new.business_date is null then
    new.business_date :=
      (
        v_opened_at
          at time zone 'Asia/Bangkok'
      )::date;
  end if;


  -- Serialize daily numbering independently for each
  -- Summary Group + business date.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'SUMMARY_GROUP_DAILY_ROUND',
        new.summary_group_id,
        new.business_date::text
      ),
      0
    )
  );


  if new.daily_round_no is null then
    select
      coalesce(
        max(r.daily_round_no),
        0
      ) + 1

    into
      new.daily_round_no

    from
      public.settlement_summary_group_rounds r

    where
      r.summary_group_id =
        new.summary_group_id

      and r.business_date =
        new.business_date;
  end if;


  return new;
end;
$$;


drop trigger if exists
  settlement_summary_group_round_daily_identity_trg

on public.settlement_summary_group_rounds;


create trigger
  settlement_summary_group_round_daily_identity_trg

before insert

on public.settlement_summary_group_rounds

for each row

execute function
  public.assign_summary_group_round_daily_identity();


comment on column
  public.settlement_summary_group_rounds.business_date

is
  'Bangkok business date fixed when this Summary Group Round opens. '
  'The value does not change when an OPEN Round crosses midnight.';


comment on column
  public.settlement_summary_group_rounds.daily_round_no

is
  'User-facing Round sequence within summary_group_id + business_date. '
  'Starts from 1 each business date; internal round_no remains unchanged.';


comment on function
  public.assign_summary_group_round_daily_identity()

is
  'Assigns authoritative Bangkok business_date and per-day Summary Group '
  'daily_round_no to newly inserted Round rows.';
