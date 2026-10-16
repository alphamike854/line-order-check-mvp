-- LOC Supervisor V5: read-only, round-first Accounting projection.
-- Preserve canonical < human verification < resolved post-close precedence;
-- UNSEND is excluded from all paths. Does not replace Accounting functions.
-- NOTE: only selected enabled current rounds, same V4 return contract.
BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_category_ceiling_report_v5(
  p_summary_group_ids text[]
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
WITH scoped_rounds AS MATERIALIZED (
  SELECT r.id AS round_id, r.settlement_session_id, r.summary_group_id,
         r.business_date
  FROM public.summary_group_round_runtime_state state
  JOIN public.settlement_summary_group_rounds r
    ON r.id = state.latest_round_id
   AND r.summary_group_id = state.summary_group_id
  JOIN public.summary_groups g
    ON g.id = r.summary_group_id AND g.enabled = TRUE
   AND g.id = ANY(p_summary_group_ids)
  WHERE r.status IN ('OPEN','CLOSED')
),
-- Preserve the accounting_round_scope fail-closed current/archived checks.
-- One call for each settlement session; never expand into historical rounds.
session_rounds AS (
  SELECT settlement_session_id, array_agg(round_id) AS round_ids
  FROM scoped_rounds GROUP BY settlement_session_id
),
validated_rounds AS MATERIALIZED (
  SELECT s.round_id, s.settlement_session_id, s.summary_group_id
  FROM session_rounds sessions
  CROSS JOIN LATERAL public.accounting_round_scope(
    sessions.settlement_session_id, sessions.round_ids
  ) valid
  JOIN scoped_rounds s ON s.round_id = valid.round_id
),
-- The core optimization: constrain by the indexed message Round ID *before*
-- reading canonical order rows or JSON human corrections.
scoped_messages AS MATERIALIZED (
  SELECT m.id AS message_record_id, m.settlement_session_id,
         m.line_group_id, m.summary_group_id, cfg.reduction_pct
  FROM validated_rounds r
  JOIN public.settlement_line_group_round_config cfg
    ON cfg.round_id = r.round_id
  JOIN public.messages m
    ON m.summary_group_round_id = r.round_id
   AND m.settlement_session_id = r.settlement_session_id
   AND m.summary_group_id = r.summary_group_id
   AND m.line_group_id = cfg.line_group_id
  WHERE NOT m.unsent
    AND NOT EXISTS (
      SELECT 1 FROM public.unsend_events u
      WHERE u.matched_message_record_id = m.id
    )
),
-- Historical accepted revisions take precedence even if they emit no items
-- (e.g., IGNORED). Keep the durable ordering from existing Accounting.
resolved_post_close AS MATERIALIZED (
  SELECT DISTINCT ON (a.source_message_record_id)
    a.source_message_record_id AS message_record_id,
    a.line_group_id, a.summary_group_id,
    a.post_close_resolution_type, a.post_close_items
  FROM public.post_close_review_archive a
  JOIN scoped_messages m
    ON m.message_record_id = a.source_message_record_id
   AND m.settlement_session_id = a.settlement_session_id
  WHERE a.post_close_resolution_type IS NOT NULL
  ORDER BY a.source_message_record_id,
           a.post_close_resolved_at DESC NULLS LAST,
           a.updated_at DESC, a.id DESC
),
verified AS MATERIALIZED (
  SELECT v.message_record_id, v.line_group_id, v.summary_group_id,
         v.verified_order_items
  FROM public.message_verifications v
  JOIN scoped_messages m
    ON m.message_record_id = v.message_record_id
   AND m.settlement_session_id = v.settlement_session_id
),
-- Each path emits the original source fields, then the same message ownership
-- tests that the V4 attributed JOIN imposed.
effective_items AS (
  SELECT m.summary_group_id, m.reduction_pct,
         upper(btrim(j.value ->> 'category')) AS category,
         btrim(j.value ->> 'code') AS code,
         (j.value ->> 'quantity')::bigint AS quantity
  FROM scoped_messages m
  JOIN resolved_post_close a
    ON a.message_record_id = m.message_record_id
   AND a.line_group_id = m.line_group_id
   AND a.summary_group_id = m.summary_group_id
  CROSS JOIN LATERAL jsonb_array_elements(a.post_close_items) j(value)
  WHERE a.post_close_resolution_type = 'CORRECTED'

  UNION ALL

  SELECT m.summary_group_id, m.reduction_pct,
         upper(btrim(j.value ->> 'category')),
         btrim(j.value ->> 'code'),
         (j.value ->> 'quantity')::bigint
  FROM scoped_messages m
  JOIN verified v ON v.message_record_id = m.message_record_id
    AND v.line_group_id = m.line_group_id
    AND v.summary_group_id = m.summary_group_id
  LEFT JOIN resolved_post_close a
    ON a.message_record_id = m.message_record_id
  CROSS JOIN LATERAL jsonb_array_elements(v.verified_order_items) j(value)
  WHERE a.message_record_id IS NULL

  UNION ALL

  SELECT m.summary_group_id, m.reduction_pct,
         oi.category, oi.code, oi.quantity::bigint
  FROM scoped_messages m
  JOIN public.order_items oi
    ON oi.message_record_id = m.message_record_id
   AND oi.settlement_session_id = m.settlement_session_id
   AND oi.line_group_id = m.line_group_id
   AND oi.summary_group_id = m.summary_group_id
  LEFT JOIN resolved_post_close a
    ON a.message_record_id = m.message_record_id
  LEFT JOIN verified v
    ON v.message_record_id = m.message_record_id
  WHERE a.message_record_id IS NULL
    AND v.message_record_id IS NULL
),
attributed AS (
  SELECT item.category, item.code, item.quantity,
         (item.quantity::numeric * (1 - item.reduction_pct / 100))
           AS adjusted_quantity,
         item.summary_group_id
  FROM effective_items item
  WHERE item.category IN ('A','B','E','F') AND item.quantity > 0
)
SELECT a.category, a.code, sum(a.quantity)::bigint AS order_total,
       round(sum(a.adjusted_quantity), 2)::numeric AS net_total,
       count(DISTINCT a.summary_group_id)::integer AS summary_group_count
FROM attributed a
GROUP BY a.category, a.code
ORDER BY a.category, sum(a.quantity) DESC, a.code;
$sql$;

REVOKE ALL ON FUNCTION public.supervisor_category_ceiling_report_v5(text[])
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_category_ceiling_report_v5(text[])
  TO service_role;
COMMENT ON FUNCTION public.supervisor_category_ceiling_report_v5(text[]) IS
  'Read-only Supervisor round-first effective Accounting A/B/E/F. Preserves correction precedence and UNSEND exclusions.';
COMMIT;
