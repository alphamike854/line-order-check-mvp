"use strict";

export const LINE_GROUP_SUMMARY_BASE_URL =
  "https://api.line.me/v2/bot/group";


function lineGroupFetchSignal(
  timeoutMs,
) {
  if (
    typeof AbortSignal !== "undefined"
    && typeof AbortSignal.timeout
      === "function"
  ) {
    return AbortSignal.timeout(
      timeoutMs,
    );
  }

  return undefined;
}


export async function fetchLineGroupSummary({
  lineGroupId,
  channelAccessToken,
  fetchImpl = fetch,
  timeoutMs = 3000,
}) {
  const groupId =
    String(
      lineGroupId ?? "",
    ).trim();

  const token =
    String(
      channelAccessToken ?? "",
    ).trim();

  if (!groupId) {
    throw new Error(
      "LINE_GROUP_ID_REQUIRED",
    );
  }

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
    );
  }

  const response =
    await fetchImpl(
      `${
        LINE_GROUP_SUMMARY_BASE_URL
      }/${
        encodeURIComponent(groupId)
      }/summary`,
      {
        method: "GET",

        headers: {
          authorization:
            `Bearer ${token}`,
        },

        signal:
          lineGroupFetchSignal(
            timeoutMs,
          ),
      },
    );

  if (response.status === 404) {
    return {
      status: "NOT_MEMBER",
      group_name: null,
    };
  }

  if (!response.ok) {
    throw new Error(
      `LINE_GROUP_SUMMARY_HTTP_${response.status}`,
    );
  }

  const payload =
    await response.json();

  const groupName =
    String(
      payload?.groupName ?? "",
    ).trim();

  if (!groupName) {
    throw new Error(
      "LINE_GROUP_SUMMARY_NAME_MISSING",
    );
  }

  if (groupName.length > 120) {
    throw new Error(
      "LINE_GROUP_SUMMARY_NAME_TOO_LONG",
    );
  }

  return {
    status: "FOUND",
    group_name: groupName,
  };
}
