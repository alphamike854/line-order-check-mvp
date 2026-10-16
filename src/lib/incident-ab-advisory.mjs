/*
 * A/B Advisory from an already-authorized Dashboard Risk Snapshot.
 * Pure calculation only. No Supabase, network, writes, LINE or transfer actions.
 * Use the identical Shared A/B engine and loss resolver as the normal path.
 */
import { buildAbAdvisoryScopes } from "./ab-advisory-scope.mjs";
import {
  resolveAbSharedMaxLoss,
} from "./ab-advisory-loss-setting.mjs";

export function buildIncidentAbAdvisory({
  snapshot,
  summaryGroupId,
  riskBudgetRows,
} = {}) {
  const selectedGroup = String(summaryGroupId ?? "").trim();
  if (!selectedGroup || selectedGroup === "ALL") {
    throw new Error("AB_INCIDENT_SUMMARY_GROUP_REQUIRED");
  }
  if (
    !Array.isArray(snapshot?.risk_codes)
    || !Array.isArray(snapshot?.line_group_risk_codes)
    || !Array.isArray(riskBudgetRows)
  ) {
    throw new Error("AB_INCIDENT_INPUT_INCOMPLETE");
  }

  // The risk snapshot must already have been scoped by the server to the
  // selected group and current session. Never blend risk between groups.
  const summaryRows = snapshot.risk_codes;
  const lineGroupRows = snapshot.line_group_risk_codes;
  if (
    summaryRows.some(row => row?.summary_group_id !== selectedGroup)
    || lineGroupRows.some(row => row?.summary_group_id !== selectedGroup)
    || riskBudgetRows.some(row => row?.summary_group_id !== selectedGroup || row?.risk_pool !== "MAIN")
  ) {
    throw new Error("AB_INCIDENT_GROUP_SCOPE_MISMATCH");
  }

  // An explicitly configured MAIN = 0 is authoritative; missing MAIN
  // falls back to 200,000. A failed budget read must be handled by caller
  // and must NEVER be misrepresented here as an empty configuration.
  const setting = resolveAbSharedMaxLoss({
    rows: riskBudgetRows,
    summaryGroupId: selectedGroup,
  });

  const scopes = buildAbAdvisoryScopes({
    summaryRows,
    lineGroupRows,
    sharedMaxLoss: setting.shared_max_loss,
  });
  const notReady = scopes.summary_groups.some(
    row => row.calculation_status !== "READY",
  );

  return {
    calculation_status: notReady ? "PARTIAL" : "READY",
    calculation_error: null,
    shared_max_loss_source: setting.source,
    ...scopes,
  };
}
