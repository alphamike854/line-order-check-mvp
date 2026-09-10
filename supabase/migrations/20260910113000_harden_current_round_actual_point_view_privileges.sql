begin;

revoke all on table
  public.settlement_summary_group_actual_special_point_codes_current
from public, anon, authenticated, service_role;

grant select on table
  public.settlement_summary_group_actual_special_point_codes_current
to service_role;

revoke all on table
  public.session_summary_group_actual_point_status_current
from public, anon, authenticated, service_role;

grant select on table
  public.session_summary_group_actual_point_status_current
to service_role;

commit;
