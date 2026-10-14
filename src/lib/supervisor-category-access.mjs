// Server-side access policy for the all-group Supervisor V2 report.
// Caller must supply an authenticated actor from authenticateWorkbenchActor.
export function canReadSupervisorCategoryCeiling(actor) {
  const role = String(actor?.role ?? '').toUpperCase();
  return role === 'ADMIN' || role === 'SUPERVISOR';
}
