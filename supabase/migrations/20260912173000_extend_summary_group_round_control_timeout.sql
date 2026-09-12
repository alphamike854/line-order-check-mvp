begin;

-- OPEN_GROUP/CLOSE_GROUP is intentionally heavier than ordinary
-- Dashboard RPC traffic because opening a new Summary Group Round
-- snapshots the prior round and resets its operational rows.
--
-- Production PostgREST connections enter through authenticator,
-- whose statement_timeout is 8s. Keep that global safety boundary
-- unchanged and grant only this lifecycle RPC a bounded 30s budget.
--
-- No trigger is disabled and no lifecycle/archive semantics change.

alter function
  public.set_settlement_summary_group_accepting(
    uuid,
    text,
    boolean,
    text
  )
  set statement_timeout = '30s';

commit;
