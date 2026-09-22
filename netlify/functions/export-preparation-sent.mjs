import {
  json,
  requireDashboardAccess,
} from "../../src/lib/dashboard-api.mjs";


export default async function handler(req) {
  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const denied =
    requireDashboardAccess(req);

  if (denied) {
    return denied;
  }

  /*
   * Phase 2E hardening:
   *
   * SENT must only be reached through the LINE delivery
   * acknowledgement boundary.
   */
  return json(
    {
      ok: false,

      error:
        "EXPORT_SENT_DIRECT_DISABLED",

      use:
        "/api/export-preparation-send",
    },
    410,
  );
}


export const config = {
  path:
    "/api/export-preparation-sent",
};
