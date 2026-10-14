-- LOC Supervisor: independent read-only cross-Summary-Group ceilings for A/B/E/F.
-- Uses Accounting effective truth (human revisions + UNSEND rules), scoped
-- to the latest current Round per enabled Summary Group for Bangkok business date.
-- No operational mutation, no trigger, no table, no Round change.
BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_category_ceiling_report_v2(
  p_business_date date
)
RETURNS TABLE (
  category text,
  code text,
  order_total bigint,
  net_total numeric,
  summary_group_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $sql$
  WITH scoped_rounds AS (
    SELECT r.id AS round_id,
           r.settlement_session_id,
           r.summary_group_id,
           r.business_date
    FROM public.summary_group_round_runtime_state state
    JOIN public.settlement_summary_group_rounds r
      ON r.id = state.latest_round_id
     AND r.summary_group_id = state.summary_group_id
    JOIN public.summary_groups g
      ON g.id = r.summary_group_id
     AND g.enabled = TRUE
    WHERE r.business_date = p_business_date
      AND r.status IN ('OPEN', 'CLOSED')
  ),
  session_scopes AS (
    SELECT r.settlement_session_id,
           array_agg(DISTINCT r.round_id) AS round_ids,
           array_agg(DISTINCT cfg.line_group_id) AS line_group_ids
    FROM scoped_rounds r
    JOIN public.settlement_line_group_round_config cfg
      ON cfg.round_id = r.round_id
    GROUP BY r.settlement_session_id
  ),
  effective_items AS (
    SELECT scope.settlement_session_id,
           item.message_record_id,
           item.line_group_id,
           item.summary_group_id,
           item.category,
           item.code,
           item.quantity
    FROM session_scopes scope
    CROSS JOIN LATERAL public.accounting_effective_order_items_rounds(
      scope.settlement_session_id,
      scope.round_ids,
      scope.line_group_ids
    ) item
    WHERE item.category IN ('A', 'B', 'E', 'F')
      AND item.quantity > 0
  ),
  attributed AS (
    SELECT item.category,
           item.code,
           item.quantity,
           (item.quantity::numeric * (1 - cfg.reduction_pct / 100))
             AS adjusted_quantity,
           round_state.summary_group_id
    FROM effective_items item
    JOIN public.messages message
      ON message.id = item.message_record_id
     AND message.settlement_session_id = item.settlement_session_id
     AND message.line_group_id = item.line_group_id
     AND message.summary_group_id = item.summary_group_id
    JOIN scoped_rounds round_state
      ON round_state.round_id = message.summary_group_round_id
     AND round_state.settlement_session_id = item.settlement_session_id
     AND round_state.summary_group_id = item.summary_group_id
    JOIN public.settlement_line_group_round_config cfg
      ON cfg.round_id = round_state.round_id
     AND cfg.line_group_id = item.line_group_id
  )
  SELECT a.category,
         a.code,
         sum(a.quantity)::bigint AS order_total,
         round(sum(a.adjusted_quantity), 2)::numeric AS net_total,
         count(DISTINCT a.summary_group_id)::integer AS summary_group_count
  FROM attributed a
  GROUP BY a.category, a.code
  ORDER BY a.category, sum(a.quantity) DESC, a.code;
$sql$;

REVOKE ALL ON FUNCTION public.supervisor_category_ceiling_report_v2(date)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_category_ceiling_report_v2(date)
  TO service_role;
COMMENT ON FUNCTION public.supervisor_category_ceiling_report_v2(date) IS
  'Read-only A/B/E/F current-round effective Accounting aggregate across enabled Summary Groups; exact Bangkok date, no changes to source data or operations.';

COMMIT;
