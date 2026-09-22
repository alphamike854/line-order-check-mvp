-- Phase 2F2B2B
-- Export Destination Registry Management
--
-- Management only.
-- No operational destination rows are inserted by this migration.
-- No LINE transport changes.
-- No Export cycle/delivery changes.

create or replace function public.save_export_destination_settings(
  p_line_group_id text,
  p_label text,
  p_enabled boolean,
  p_changed_by text
)
returns public.export_destination_line_groups
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_line_group_id text;
  v_label text;
  v_changed_by text;
  v_existing public.export_destination_line_groups%rowtype;
  v_saved public.export_destination_line_groups%rowtype;
begin
  v_line_group_id :=
    nullif(
      trim(
        coalesce(
          p_line_group_id,
          ''
        )
      ),
      ''
    );

  v_label :=
    nullif(
      trim(
        coalesce(
          p_label,
          ''
        )
      ),
      ''
    );

  v_changed_by :=
    nullif(
      trim(
        coalesce(
          p_changed_by,
          ''
        )
      ),
      ''
    );

  if p_enabled is null then
    raise exception
      'EXPORT_DESTINATION_ENABLED_REQUIRED';
  end if;

  if v_line_group_id is null then
    raise exception
      'EXPORT_DESTINATION_REQUIRED';
  end if;

  if length(v_line_group_id) > 255 then
    raise exception
      'EXPORT_DESTINATION_INVALID';
  end if;

  if v_label is null then
    raise exception
      'EXPORT_DESTINATION_LABEL_REQUIRED';
  end if;

  if length(v_label) > 150 then
    raise exception
      'EXPORT_DESTINATION_LABEL_INVALID';
  end if;

  perform
    public.lock_export_destination(
      v_line_group_id
    );

  select
    *
  into
    v_existing
  from
    public.export_destination_line_groups d
  where
    d.line_group_id =
      v_line_group_id
  for update;

  if not found then
    if not (
      exists (
        select 1
        from public.line_groups g
        where g.line_group_id =
          v_line_group_id
      )
      or exists (
        select 1
        from public.webhook_events e
        where e.line_group_id =
          v_line_group_id
      )
      or exists (
        select 1
        from public.line_message_mirror_routes r
        where r.destination_line_group_id =
          v_line_group_id
      )
    )
    then
      raise exception
        'EXPORT_DESTINATION_NOT_FOUND';
    end if;

    -- New registrations always start disabled.
    insert into public.export_destination_line_groups (
      line_group_id,
      label,
      enabled,
      created_by,
      updated_by
    )
    values (
      v_line_group_id,
      v_label,
      false,
      v_changed_by,
      v_changed_by
    )
    returning *
    into v_saved;

    return v_saved;
  end if;

  update
    public.export_destination_line_groups
  set
    label =
      v_label,
    enabled =
      p_enabled,
    updated_by =
      v_changed_by
  where
    line_group_id =
      v_line_group_id
  returning *
  into v_saved;

  return v_saved;
end;
$function$;

revoke all
on function public.save_export_destination_settings(
  text,
  text,
  boolean,
  text
)
from public, anon, authenticated;

grant execute
on function public.save_export_destination_settings(
  text,
  text,
  boolean,
  text
)
to service_role;
