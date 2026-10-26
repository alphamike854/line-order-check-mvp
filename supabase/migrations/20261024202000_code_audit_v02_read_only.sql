-- CANDIDATE ONLY. NEVER RUN AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- Independent read-only Code Audit V0.2. Existing Supervisor/Accounting RPCs untouched.
-- Fidelity source: 20261016102000_supervisor_category_ceiling_scope_first_v5.sql
-- Requires isolated PostgreSQL schema/runtime acceptance, parity checks and EXPLAIN before any migration.
BEGIN;

CREATE FUNCTION public.code_audit_v02_message_codes(
  p_summary_group_ids text[], p_line_group_ids text[]
) RETURNS TABLE (
  message_record_id uuid, summary_group_id text, line_group_id text,
  summary_group_round_id uuid, settlement_session_id uuid,
  business_date date, event_timestamp timestamptz,
  line_group_name text, first_order_code text,
  category text, code text, quantity bigint, truth_source text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $sql$
WITH scoped_rounds AS MATERIALIZED (
  SELECT r.id AS round_id, r.settlement_session_id,
         r.summary_group_id, r.business_date
  FROM public.summary_group_round_runtime_state st
  JOIN public.settlement_summary_group_rounds r
    ON r.id = st.latest_round_id AND r.summary_group_id = st.summary_group_id
  JOIN public.summary_groups g ON g.id = r.summary_group_id AND g.enabled = true
  WHERE r.status IN ('OPEN','CLOSED')
    AND r.summary_group_id = ANY(p_summary_group_ids)
),
session_rounds AS (
  SELECT settlement_session_id, array_agg(round_id) AS round_ids
  FROM scoped_rounds GROUP BY settlement_session_id
),
validated_rounds AS MATERIALIZED (
  SELECT r.* FROM session_rounds sess
  CROSS JOIN LATERAL public.accounting_round_scope(sess.settlement_session_id,sess.round_ids) valid
  JOIN scoped_rounds r ON r.round_id = valid.round_id
),
scoped_messages AS MATERIALIZED (
  SELECT m.id AS message_record_id, m.settlement_session_id, m.summary_group_id,
         m.line_group_id, m.summary_group_round_id, r.business_date,
         coalesce(m.event_timestamp,m.created_at) AS event_timestamp,
         cfg.reduction_pct, lg.line_group_name
  FROM validated_rounds r
  JOIN public.settlement_line_group_round_config cfg ON cfg.round_id = r.round_id
  JOIN public.messages m ON m.summary_group_round_id = r.round_id
    AND m.settlement_session_id = r.settlement_session_id
    AND m.summary_group_id = r.summary_group_id
    AND m.line_group_id = cfg.line_group_id
  LEFT JOIN public.line_groups lg ON lg.line_group_id = m.line_group_id
  WHERE m.line_group_id = ANY(p_line_group_ids)
    AND NOT m.unsent
    AND NOT EXISTS (
      SELECT 1 FROM public.unsend_events u
      WHERE u.matched_message_record_id = m.id
    )
),
resolved_post_close AS MATERIALIZED (
  SELECT DISTINCT ON (a.source_message_record_id)
    a.source_message_record_id AS message_record_id,
    a.line_group_id, a.summary_group_id,
    a.post_close_resolution_type, a.post_close_items
  FROM public.post_close_review_archive a
  JOIN scoped_messages m ON m.message_record_id = a.source_message_record_id
    AND m.settlement_session_id = a.settlement_session_id
  WHERE a.post_close_resolution_type IS NOT NULL
  ORDER BY a.source_message_record_id,
           a.post_close_resolved_at DESC NULLS LAST,
           a.updated_at DESC, a.id DESC
),
verified AS MATERIALIZED (
  SELECT v.message_record_id,v.line_group_id,v.summary_group_id,
         v.verified_order_items,v.verified_first_order_code
  FROM public.message_verifications v
  JOIN scoped_messages m ON m.message_record_id = v.message_record_id
    AND m.settlement_session_id = v.settlement_session_id
),
effective_items AS (
  SELECT m.message_record_id,m.summary_group_id,m.line_group_id,
         upper(btrim(j.value ->> 'category')) AS category,
         btrim(j.value ->> 'code') AS code,
         (j.value ->> 'quantity')::bigint AS quantity,
         'POST_CLOSE'::text AS truth_source
  FROM scoped_messages m
  JOIN resolved_post_close a ON a.message_record_id = m.message_record_id
    AND a.line_group_id = m.line_group_id AND a.summary_group_id = m.summary_group_id
  CROSS JOIN LATERAL jsonb_array_elements(a.post_close_items) j(value)
  WHERE a.post_close_resolution_type = 'CORRECTED'
  UNION ALL
  SELECT m.message_record_id,m.summary_group_id,m.line_group_id,
         upper(btrim(j.value ->> 'category')),
         btrim(j.value ->> 'code'),(j.value ->> 'quantity')::bigint,
         'VERIFIED'::text
  FROM scoped_messages m
  JOIN verified v ON v.message_record_id = m.message_record_id
    AND v.line_group_id = m.line_group_id AND v.summary_group_id = m.summary_group_id
  LEFT JOIN resolved_post_close a ON a.message_record_id = m.message_record_id
  CROSS JOIN LATERAL jsonb_array_elements(v.verified_order_items) j(value)
  WHERE a.message_record_id IS NULL
  UNION ALL
  SELECT m.message_record_id,m.summary_group_id,m.line_group_id,
         upper(btrim(oi.category)),btrim(oi.code),oi.quantity::bigint,
         'CANONICAL'::text
  FROM scoped_messages m
  JOIN public.order_items oi ON oi.message_record_id = m.message_record_id
    AND oi.settlement_session_id = m.settlement_session_id
    AND oi.line_group_id = m.line_group_id
    AND oi.summary_group_id = m.summary_group_id
  LEFT JOIN resolved_post_close a ON a.message_record_id = m.message_record_id
  LEFT JOIN verified v ON v.message_record_id = m.message_record_id
  WHERE a.message_record_id IS NULL AND v.message_record_id IS NULL
)
SELECT m.message_record_id,m.summary_group_id,m.line_group_id,
       m.summary_group_round_id,m.settlement_session_id,m.business_date,
       m.event_timestamp,coalesce(m.line_group_name,m.line_group_id),
       -- First-code source is authoritative only for verified messages;
       -- NULL otherwise. Never fabricate it from a sorted code row.
       CASE WHEN item.truth_source = 'VERIFIED' THEN max(v.verified_first_order_code)::text ELSE NULL END AS first_order_code,
       item.category,item.code,sum(item.quantity)::bigint AS quantity,
       item.truth_source
FROM effective_items item
JOIN scoped_messages m ON m.message_record_id = item.message_record_id
  AND m.summary_group_id = item.summary_group_id AND m.line_group_id = item.line_group_id
LEFT JOIN verified v ON v.message_record_id = item.message_record_id
WHERE item.category IN ('A','B','E','F','H','L') AND item.quantity > 0
GROUP BY m.message_record_id,m.summary_group_id,m.line_group_id,
         m.summary_group_round_id,m.settlement_session_id,m.business_date,
         m.event_timestamp,m.line_group_name,item.category,item.code,item.truth_source;
$sql$;

CREATE FUNCTION public.code_audit_v02_summary(
  p_summary_group_ids text[], p_line_group_ids text[]
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $sql$
WITH rows AS MATERIALIZED (
  SELECT category,code,sum(quantity)::bigint AS order_total,
         count(*)::bigint AS message_count
  FROM public.code_audit_v02_message_codes(p_summary_group_ids,p_line_group_ids)
  GROUP BY category,code
),
scope AS (
  SELECT r.id AS round_id,r.summary_group_id,r.business_date,r.status
  FROM public.summary_group_round_runtime_state state
  JOIN public.settlement_summary_group_rounds r ON r.id=state.latest_round_id
    AND r.summary_group_id=state.summary_group_id
  JOIN public.summary_groups g ON g.id=r.summary_group_id AND g.enabled=true
  WHERE r.summary_group_id=ANY(p_summary_group_ids) AND r.status IN ('OPEN','CLOSED')
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'category',category,'code',code,'order_total',order_total,'message_count',message_count
  ) ORDER BY order_total DESC,category,code) FROM rows),'[]'::jsonb),
  'round_scope',coalesce((SELECT jsonb_agg(to_jsonb(scope) ORDER BY summary_group_id) FROM scope),'[]'::jsonb),
  'fetched_at', now()
);
$sql$;

CREATE FUNCTION public.code_audit_v02_detail(
  p_summary_group_ids text[],p_line_group_ids text[],
  p_category text,p_code text,p_page_size integer,
  p_after_quantity bigint DEFAULT NULL,
  p_after_event_timestamp timestamptz DEFAULT NULL,
  p_after_message_record_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public, pg_temp AS $plpgsql$
DECLARE result jsonb;
BEGIN
  IF p_category IS NULL OR p_category NOT IN ('A','B','E','F','H','L') OR
     p_code IS NULL OR p_code !~ '^\d{1,3}$' OR
     p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50 OR
     ((p_after_quantity IS NULL)::int +
      (p_after_event_timestamp IS NULL)::int +
      (p_after_message_record_id IS NULL)::int) NOT IN (0,3) OR
     (p_after_quantity IS NOT NULL AND p_after_quantity <= 0)
  THEN RAISE EXCEPTION 'INVALID_CODE_AUDIT_DETAIL_REQUEST'; END IF;
  WITH candidate AS MATERIALIZED (
    SELECT * FROM public.code_audit_v02_message_codes(p_summary_group_ids,p_line_group_ids)
    WHERE category=p_category AND code=p_code
  ),
  ranked AS MATERIALIZED (
    SELECT * FROM candidate c
    WHERE p_after_quantity IS NULL
       OR c.quantity < p_after_quantity
       OR (c.quantity = p_after_quantity AND c.event_timestamp > p_after_event_timestamp)
       OR (c.quantity = p_after_quantity AND c.event_timestamp = p_after_event_timestamp
           AND c.message_record_id > p_after_message_record_id)
    ORDER BY c.quantity DESC,c.event_timestamp ASC,c.message_record_id ASC
    LIMIT p_page_size+1
  ),
  numbered AS (
    SELECT ranked.*,row_number() OVER (ORDER BY quantity DESC,event_timestamp ASC,message_record_id ASC) rn
    FROM ranked
  ),
  page AS (SELECT * FROM numbered WHERE rn<=p_page_size)
  SELECT jsonb_build_object(
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'rn' ORDER BY rn) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>p_page_size FROM numbered),
    'next_cursor',(
      SELECT jsonb_build_object(
        'quantity',quantity,
        'event_timestamp',to_char(event_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'message_record_id',message_record_id
      ) FROM page ORDER BY rn DESC LIMIT 1
    )
  ) INTO result;
  RETURN result;
END;
$plpgsql$;

REVOKE ALL ON FUNCTION public.code_audit_v02_message_codes(text[],text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.code_audit_v02_summary(text[],text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.code_audit_v02_detail(text[],text[],text,text,integer,bigint,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.code_audit_v02_message_codes(text[],text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_audit_v02_summary(text[],text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_audit_v02_detail(text[],text[],text,text,integer,bigint,timestamptz,uuid) TO service_role;
COMMIT;
