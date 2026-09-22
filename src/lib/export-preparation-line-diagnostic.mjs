export const LINE_BOT_INFO_ENDPOINT =
  "https://api.line.me/v2/bot/info";


export function buildLineGroupSummaryEndpoint(
  lineGroupId,
) {
  const id =
    String(
      lineGroupId ?? "",
    ).trim();

  if (!id) {
    throw new Error(
      "LINE_DESTINATION_MISSING",
    );
  }

  return (
    "https://api.line.me/v2/bot/group/"
    + encodeURIComponent(id)
    + "/summary"
  );
}


function classifyHttpFailure({
  status,
  scope,
}) {
  if (status === 401) {
    return "LINE_UNAUTHORIZED";
  }

  if (status === 403) {
    return "LINE_FORBIDDEN";
  }

  if (
    status === 404
    && scope === "GROUP"
  ) {
    return "LINE_GROUP_NOT_FOUND_OR_NOT_MEMBER";
  }

  if (status === 404) {
    return "LINE_NOT_FOUND";
  }

  if (status === 429) {
    return "LINE_RATE_LIMITED";
  }

  if (
    Number.isInteger(status)
    && status >= 500
    && status <= 599
  ) {
    return "LINE_UPSTREAM_ERROR";
  }

  return "LINE_HTTP_ERROR";
}


async function lineGetJson({
  url,
  token,
  scope,
  fetchImpl,
  timeoutMs,
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs,
    );

  try {
    const response =
      await fetchImpl(
        url,
        {
          method:
            "GET",

          headers: {
            Authorization:
              `Bearer ${token}`,
          },

          signal:
            controller.signal,
        },
      );

    let body = null;

    try {
      body =
        await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        http_status:
          response.status,
        error:
          classifyHttpFailure({
            status:
              response.status,
            scope,
          }),
        body,
      };
    }

    return {
      ok: true,
      http_status:
        response.status,
      error: null,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      error:
        error?.name ===
        "AbortError"
          ? "LINE_TIMEOUT"
          : "LINE_REQUEST_FAILED",
      body: null,
    };
  } finally {
    clearTimeout(timer);
  }
}


function normalizeBotResult(
  result,
) {
  if (!result.ok) {
    return {
      ok: false,
      http_status:
        result.http_status,
      error:
        result.error,
      display_name: null,
      basic_id: null,
      user_id: null,
      chat_mode: null,
    };
  }

  const body =
    result.body
    && typeof result.body ===
      "object"
      ? result.body
      : {};

  const userId =
    String(
      body.userId ?? "",
    ).trim();

  return {
    ok:
      Boolean(userId),
    http_status:
      result.http_status,
    error:
      userId
        ? null
        : "LINE_BOT_IDENTITY_INCOMPLETE",
    display_name:
      String(
        body.displayName ?? "",
      ).trim()
      || null,
    basic_id:
      String(
        body.basicId ?? "",
      ).trim()
      || null,
    user_id:
      userId
      || null,
    chat_mode:
      String(
        body.chatMode ?? "",
      ).trim()
      || null,
  };
}


function normalizeGroupResult(
  result,
  expectedGroupId,
) {
  if (!result.ok) {
    return {
      ok: false,
      http_status:
        result.http_status,
      error:
        result.error,
      group_id: null,
      group_name: null,
      id_matches: false,
    };
  }

  const body =
    result.body
    && typeof result.body ===
      "object"
      ? result.body
      : {};

  const groupId =
    String(
      body.groupId ?? "",
    ).trim();

  const idMatches =
    Boolean(groupId)
    && groupId ===
      expectedGroupId;

  let error = null;

  if (!groupId) {
    error =
      "LINE_GROUP_ID_MISSING";
  } else if (!idMatches) {
    error =
      "LINE_GROUP_ID_MISMATCH";
  }

  return {
    ok:
      idMatches,
    http_status:
      result.http_status,
    error,
    group_id:
      groupId || null,
    group_name:
      String(
        body.groupName ?? "",
      ).trim()
      || null,
    id_matches:
      idMatches,
  };
}


export async function diagnoseExportPreparationLineDestination({
  channelAccessToken,
  destinationLineGroupId,
  fetchImpl = fetch,
  timeoutMs = 8000,
}) {
  const token =
    String(
      channelAccessToken ?? "",
    ).trim();

  const destination =
    String(
      destinationLineGroupId
      ?? "",
    ).trim();

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
    );
  }

  if (!destination) {
    throw new Error(
      "LINE_DESTINATION_MISSING",
    );
  }

  const effectiveTimeout =
    Number.isFinite(
      Number(timeoutMs),
    )
    && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : 8000;

  /*
   * Diagnostic is intentionally GET-only.
   * It never calls message/push.
   */
  const botRaw =
    await lineGetJson({
      url:
        LINE_BOT_INFO_ENDPOINT,
      token,
      scope:
        "BOT",
      fetchImpl,
      timeoutMs:
        effectiveTimeout,
    });

  const groupRaw =
    await lineGetJson({
      url:
        buildLineGroupSummaryEndpoint(
          destination,
        ),
      token,
      scope:
        "GROUP",
      fetchImpl,
      timeoutMs:
        effectiveTimeout,
    });

  const bot =
    normalizeBotResult(
      botRaw,
    );

  const group =
    normalizeGroupResult(
      groupRaw,
      destination,
    );

  const botIdentityVerified =
    bot.ok === true;

  const groupMembershipVerified =
    group.ok === true
    && group.id_matches === true;

  return {
    bot,
    group,

    bot_identity_verified:
      botIdentityVerified,

    group_membership_verified:
      groupMembershipVerified,

    ready_to_consider_enable:
      botIdentityVerified
      && groupMembershipVerified,
  };
}
