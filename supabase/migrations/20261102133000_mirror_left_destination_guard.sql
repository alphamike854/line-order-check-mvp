-- LOC Mirror LEFT destination policy (OFFLINE CANDIDATE, NOT APPLIED)
-- Never run on production without a separate release approval.
-- Exact scope: prevent enabling a Mirror Route targeting a last-observed 'leave'
-- and expose a service_role-only, read-only membership gate to the worker.
-- Does NOT alter observed records, existing routes, batches, queues or histories.

BEGIN;

DO $precheck$
BEGIN
  IF to_regclass('public.observed_line_groups') IS NULL
     OR to_regclass('public.line_message_mirror_routes') IS NULL THEN
    RAISE EXCEPTION 'LOC_MIRROR_LEFT_REQUIRED_TABLE_MISSING';
  END IF;
  IF to_regprocedure('public.mirror_destination_is_not_left(text)') IS NOT NULL
     OR to_regprocedure('public.enforce_mirror_route_destination_not_left()') IS NOT NULL THEN
    RAISE EXCEPTION 'LOC_MIRROR_LEFT_CANDIDATE_OBJECT_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.line_message_mirror_routes'::regclass
      AND tgname = 'line_mirror_route_left_destination_guard_trg'
  ) THEN
    RAISE EXCEPTION 'LOC_MIRROR_LEFT_CANDIDATE_TRIGGER_CONFLICT';
  END IF;
END;
$precheck$;

-- Only explicit 'leave' blocks; missing or unknown observation keeps current behavior.
CREATE FUNCTION public.mirror_destination_is_not_left(p_destination_line_group_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $gate$
  SELECT p_destination_line_group_id IS NOT NULL
     AND pg_catalog.btrim(p_destination_line_group_id) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.observed_line_groups AS o
       WHERE o.line_group_id = pg_catalog.btrim(p_destination_line_group_id)
         AND o.last_event_type = 'leave'
     );
$gate$;

REVOKE ALL ON FUNCTION public.mirror_destination_is_not_left(text) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.mirror_destination_is_not_left(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.mirror_destination_is_not_left(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.mirror_destination_is_not_left(text) TO service_role;
  END IF;
END;
$grants$;

CREATE FUNCTION public.enforce_mirror_route_destination_not_left()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $trigger$
BEGIN
  IF NEW.enabled IS TRUE
    AND NOT public.mirror_destination_is_not_left(NEW.destination_line_group_id) THEN
    RAISE EXCEPTION 'MIRROR_DESTINATION_LEFT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION public.enforce_mirror_route_destination_not_left() FROM PUBLIC, anon, authenticated;

-- Table-level enforcement also protects direct service-role writes and RPC calls.
-- Existing disabled LEFT routes stay disabled; history is preserved.
CREATE TRIGGER line_mirror_route_left_destination_guard_trg
BEFORE INSERT OR UPDATE OF enabled
ON public.line_message_mirror_routes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_mirror_route_destination_not_left();

COMMIT;
