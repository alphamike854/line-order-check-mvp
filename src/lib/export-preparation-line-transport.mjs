const LINE_PUSH_ENDPOINT =
  "https://api.line.me/v2/bot/message/push";


export function classifyLinePushResponse({
  status,
  acceptedRequestId,
}) {
  if (
    Number.isInteger(status)
    && status >= 200
    && status <= 299
  ) {
    return "ACCEPTED";
  }

  if (
    status === 409
    && String(
      acceptedRequestId ?? "",
    ).trim()
  ) {
    return "ALREADY_ACCEPTED";
  }

  if (
    Number.isInteger(status)
    && status >= 500
    && status <= 599
  ) {
    return "RETRYABLE";
  }

  return "FAILED";
}


export async function pushExportPreparationToLine({
  channelAccessToken,
  destinationLineGroupId,
  messages,
  retryKey,
  fetchImpl = fetch,
  timeoutMs = 12000,
}) {
  const token =
    String(
      channelAccessToken ?? "",
    ).trim();

  const destination =
    String(
      destinationLineGroupId ?? "",
    ).trim();

  const retry =
    String(
      retryKey ?? "",
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

  if (
    !Array.isArray(messages)
    || messages.length < 1
    || messages.length > 5
  ) {
    throw new Error(
      "LINE_MESSAGES_INVALID",
    );
  }

  if (!retry) {
    throw new Error(
      "LINE_RETRY_KEY_MISSING",
    );
  }


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
        LINE_PUSH_ENDPOINT,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`,

            "X-Line-Retry-Key":
              retry,
          },

          body:
            JSON.stringify({
              to:
                destination,

              messages,
            }),

          signal:
            controller.signal,
        },
      );


    const lineRequestId =
      response.headers.get(
        "x-line-request-id",
      );

    const acceptedRequestId =
      response.headers.get(
        "x-line-accepted-request-id",
      );


    let responseText = "";

    try {
      responseText =
        await response.text();
    } catch {
      responseText = "";
    }


    return {
      classification:
        classifyLinePushResponse({
          status:
            response.status,

          acceptedRequestId,
        }),

      http_status:
        response.status,

      line_request_id:
        lineRequestId,

      line_accepted_request_id:
        acceptedRequestId,

      response_text:
        responseText.slice(
          0,
          2000,
        ),
    };

  } catch (error) {

    return {
      classification:
        "AMBIGUOUS",

      http_status:
        null,

      line_request_id:
        null,

      line_accepted_request_id:
        null,

      response_text:
        String(
          error?.message
          ?? error,
        ).slice(
          0,
          2000,
        ),
    };

  } finally {
    clearTimeout(timer);
  }
}
