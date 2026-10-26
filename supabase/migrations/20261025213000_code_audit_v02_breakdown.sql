-- Read-only addition: group a single selected code by Summary Group and LINE Group.
-- Uses exact same effective-truth function as the accepted Summary and Detail.
BEGIN;
CREATE FUNCTION public.code_audit_v02_breakdown(
  p_summary_group_ids text[], p_line_group_ids text[], p_category text, p_code text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $sql$
WITH grouped AS MATERIALIZED (
 SELECT m.summary_group_id,m.line_group_id,
        max(m.line_group_name) AS line_group_name,
        sum(m.quantity)::bigint AS order_total,
        count(*)::bigint AS message_count
 FROM public.code_audit_v02_message_codes(p_summary_group_ids,p_line_group_ids) m
 WHERE m.category=p_category AND m.code=p_code
 GROUP BY m.summary_group_id,m.line_group_id
)
SELECT jsonb_build_object('rows',coalesce(
 (SELECT jsonb_agg(jsonb_build_object(
    'summary_group_id',summary_group_id,'line_group_id',line_group_id,
    'line_group_name',line_group_name,'order_total',order_total,'message_count',message_count
 ) ORDER BY order_total DESC,summary_group_id,line_group_id) FROM grouped),'[]'::jsonb));
$sql$;
REVOKE ALL ON FUNCTION public.code_audit_v02_breakdown(text[],text[],text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.code_audit_v02_breakdown(text[],text[],text,text) TO service_role;
COMMIT;
