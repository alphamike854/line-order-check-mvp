create index if not exists messages_business_summary_status_idx
  on public.messages (business_date, summary_group_id, parse_status, created_at desc);

create index if not exists review_items_status_created_idx
  on public.review_items (status, created_at desc);

create index if not exists unsend_events_unsent_at_idx
  on public.unsend_events (unsent_at desc);

create table if not exists public.allocation_confirmation_events (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  summary_group_id text not null references public.summary_groups(id),
  category text not null check (category in ('A','B','E','F','G')),
  code text not null,
  previous_confirmed integer not null check (previous_confirmed >= 0),
  new_confirmed integer not null check (new_confirmed >= 0),
  delta_confirmed integer not null check (delta_confirmed > 0),
  confirmed_by text,
  confirmed_at timestamptz not null default now()
);

create index if not exists allocation_confirmation_events_lookup_idx
  on public.allocation_confirmation_events (
    business_date,
    summary_group_id,
    category,
    code,
    confirmed_at desc
  );

alter table public.allocation_confirmation_events enable row level security;
revoke all on public.allocation_confirmation_events from anon, authenticated;

create or replace function public.confirm_allocation_transfer(
  p_business_date date,
  p_summary_group_id text,
  p_category text,
  p_code text,
  p_confirmed_by text default 'DASHBOARD'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state record;
  v_previous integer;
  v_new integer;
  v_delta integer;
begin
  select *
    into v_state
  from public.allocation_state
  where business_date = p_business_date
    and summary_group_id = p_summary_group_id
    and category = p_category
    and code = p_code;

  if not found then
    raise exception 'ALLOCATION_STATE_NOT_FOUND';
  end if;

  if coalesce(v_state.transfer_now, 0) <= 0 then
    raise exception 'NO_TRANSFER_REQUIRED';
  end if;

  v_previous := coalesce(v_state.confirmed_transfer, 0)::integer;
  v_new := v_state.should_transfer::integer;
  v_delta := v_new - v_previous;

  insert into public.allocation_confirmations (
    business_date,
    summary_group_id,
    category,
    code,
    confirmed_transfer,
    confirmed_at,
    confirmed_by
  ) values (
    p_business_date,
    p_summary_group_id,
    p_category,
    p_code,
    v_new,
    now(),
    p_confirmed_by
  )
  on conflict (business_date, summary_group_id, category, code)
  do update set
    confirmed_transfer = excluded.confirmed_transfer,
    confirmed_at = excluded.confirmed_at,
    confirmed_by = excluded.confirmed_by;

  insert into public.allocation_confirmation_events (
    business_date,
    summary_group_id,
    category,
    code,
    previous_confirmed,
    new_confirmed,
    delta_confirmed,
    confirmed_by
  ) values (
    p_business_date,
    p_summary_group_id,
    p_category,
    p_code,
    v_previous,
    v_new,
    v_delta,
    p_confirmed_by
  );

  return jsonb_build_object(
    'business_date', p_business_date,
    'summary_group_id', p_summary_group_id,
    'category', p_category,
    'code', p_code,
    'previous_confirmed', v_previous,
    'confirmed_transfer', v_new,
    'delta_confirmed', v_delta
  );
end;
$$;

revoke all on function public.confirm_allocation_transfer(date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.confirm_allocation_transfer(date,text,text,text,text) to service_role;
