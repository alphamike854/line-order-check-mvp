import {
  json,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  diagnoseExportPreparationLineDestination,
} from "../../src/lib/export-preparation-line-diagnostic.mjs";


export default async function handler(
  req,
) {
  if (req.method !== "GET") {
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

  const url =
    new URL(req.url);

  const lineGroupId =
    String(
      url.searchParams.get(
        "line_group_id",
      )
      ?? "",
    ).trim();

  if (
    !lineGroupId
    || lineGroupId.length > 255
  ) {
    return json(
      {
        ok: false,
        error:
          "LINE_GROUP_ID_REQUIRED",
      },
      400,
    );
  }

  try {
    /*
     * Read-only registry lookup.
     * Diagnostic is valid for a registered destination
     * even while enabled=false.
     */
    const {
      data:
        destination,
      error:
        destinationError,
    } =
      await supabase
        .from(
          "export_destination_line_groups",
        )
        .select(
          [
            "line_group_id",
            "label",
            "enabled",
            "verification_source",
          ].join(","),
        )
        .eq(
          "line_group_id",
          lineGroupId,
        )
        .maybeSingle();

    if (destinationError) {
      throw destinationError;
    }

    if (!destination) {
      return json(
        {
          ok: false,
          error:
            "EXPORT_DESTINATION_NOT_REGISTERED",
        },
        404,
      );
    }

    /*
     * Read credential only after authentication
     * and destination registry validation.
     *
     * Never expose this value in any response.
     */
    const channelAccessToken =
      String(
        process.env
          .LINE_CHANNEL_ACCESS_TOKEN
        ?? "",
      ).trim();

    if (!channelAccessToken) {
      return json(
        {
          ok: false,
          error:
            "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
        },
        503,
      );
    }

    const diagnostic =
      await diagnoseExportPreparationLineDestination({
        channelAccessToken,
        destinationLineGroupId:
          destination.line_group_id,
      });

    return json({
      ok: true,

      destination: {
        line_group_id:
          destination.line_group_id,
        label:
          destination.label,
        enabled:
          destination.enabled,
        verification_source:
          destination.verification_source,
      },

      transport: {
        credential_source:
          "LINE_CHANNEL_ACCESS_TOKEN",
        token_present:
          true,
        token_exposed:
          false,
        request_mode:
          "GET_ONLY",
      },

      diagnostic,

      ready_to_consider_enable:
        diagnostic
          .ready_to_consider_enable
          === true,
    });
  } catch {
    /*
     * Keep implementation/internal errors
     * and credential material out of the response.
     */
    return json(
      {
        ok: false,
        error:
          "EXPORT_LINE_DIAGNOSTIC_FAILED",
      },
      500,
    );
  }
}


export const config = {
  path:
    "/api/export-preparation-line-diagnostic",
  region:
    "sin",
};
