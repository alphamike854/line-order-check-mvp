begin;

create or replace function
  public.replace_settlement_summary_group_actual_special_codes(
    p_session_id uuid,
    p_summary_group_id text,
    p_codes jsonb
  )
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_summary text;
  v_round_id uuid;
  v_round_result jsonb;
  v_count integer := 0;
begin
  v_summary :=
    nullif(trim(p_summary_group_id), '');

  if p_session_id is null then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if v_summary is null then
    raise exception 'SUMMARY_GROUP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.settlement_sessions s
    where s.id = p_session_id
  ) then
    raise exception 'SETTLEMENT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.settlement_line_group_config cfg
    where
      cfg.settlement_session_id = p_session_id
      and cfg.summary_group_id = v_summary
  ) then
    raise exception
      'SUMMARY_GROUP_NOT_IN_SETTLEMENT';
  end if;

  select r.id
  into v_round_id
  from public.settlement_summary_group_rounds r
  where
    r.settlement_session_id = p_session_id
    and r.summary_group_id = v_summary
    and not exists (
      select 1
      from public.settlement_summary_group_round_snapshots snap
      where snap.round_id = r.id
    )
  order by r.round_no desc
  limit 1;

  if v_round_id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  v_round_result :=
    public.replace_settlement_round_actual_special_codes(
      p_round_id => v_round_id,
      p_codes => p_codes,
      p_changed_by => 'LEGACY_COMPAT'
    );

  v_count :=
    coalesce(
      (v_round_result->>'count')::integer,
      0
    );

  delete from
    public.settlement_summary_group_actual_special_point_codes
  where
    settlement_session_id = p_session_id
    and summary_group_id = v_summary;

  insert into
    public.settlement_summary_group_actual_special_point_codes (
      settlement_session_id,
      summary_group_id,
      category,
      code
    )
  select
    p_session_id,
    v_summary,
    upper(trim(e.value->>'category')),
    trim(e.value->>'code')
  from
    jsonb_array_elements(
      coalesce(
        v_round_result->'codes',
        '[]'::jsonb
      )
    ) e(value);

  return v_count;
end;
$function$;

commit;
