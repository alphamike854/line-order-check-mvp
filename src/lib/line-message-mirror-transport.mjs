"use strict";

import {
  timingSafeEqual,
} from "node:crypto";

export const LINE_MIRROR_PUSH_URL =
  "https://api.line.me/v2/bot/message/push";

export const LINE_MIRROR_LEASE_SECONDS =
  180;

export const LINE_MIRROR_RETRY_LEASE_SECONDS =
  600;

export const LINE_MIRROR_MAX_BATCHES_PER_RUN =
  120;

export const LINE_MIRROR_RETRY_DELAYS_MS =
  Object.freeze([
    1000,
    2000,
  ]);

export const LINE_MIRROR_FETCH_TIMEOUT_MS =
  15000;


export const LINE_MIRROR_WAKE_TIMEOUT_MS =
  3000;


export const LINE_MIRROR_WAIT_POLL_MS =
  1000;


export function safeMirrorSecretEqual(
  supplied,
  expected,
) {
  const left =
    Buffer.from(
      String(supplied ?? ""),
      "utf8",
    );

  const right =
    Buffer.from(
      String(expected ?? ""),
      "utf8",
    );

  return (
    left.length > 0
    && left.length === right.length
    && timingSafeEqual(
      left,
      right,
    )
  );
}


export function normalizeMirrorDestinations(
  result,
) {
  const values =
    Array.isArray(
      result?.destinations,
    )
      ? result.destinations
      : [];

  return [
    ...new Set(
      values
        .map(
          (value) =>
            String(
              value ?? "",
            ).trim(),
        )
        .filter(Boolean),
    ),
  ];
}


export function buildLineMirrorTextPayload(
  destinationLineGroupId,
  items,
) {
  const destination =
    String(
      destinationLineGroupId
        ?? "",
    ).trim();

  if (!destination) {
    throw new Error(
      "MIRROR_DESTINATION_REQUIRED",
    );
  }

  if (
    !Array.isArray(items)
    || items.length < 1
    || items.length > 5
  ) {
    throw new Error(
      "MIRROR_BATCH_ITEM_COUNT_INVALID",
    );
  }

  const messages =
    items.map(
      (item) => {
        if (
          item?.message_type
          !== "text"
        ) {
          throw new Error(
            "MIR2C_C_TEXT_ONLY_BATCH",
          );
        }

        if (
          typeof item.text_payload
          !== "string"
          || item.text_payload.length
            === 0
        ) {
          throw new Error(
            "MIRROR_TEXT_PAYLOAD_INVALID",
          );
        }

        return {
          type: "text",
          text: item.text_payload,
        };
      },
    );

  return {
    to: destination,
    messages,
  };
}


export function classifyLineMirrorPushStatus(
  status,
) {
  const code =
    Number(status);

  if (
    code >= 200
    && code < 300
  ) {
    return "ACCEPTED";
  }

  if (code === 409) {
    return "ALREADY_ACCEPTED";
  }

  if (code >= 500) {
    return "RETRYABLE";
  }

  return "PERMANENT";
}


export function getLineMirrorRequestId(
  response,
  status,
) {
  if (!response?.headers) {
    return null;
  }

  if (
    Number(status) === 409
  ) {
    return (
      response.headers.get(
        "x-line-accepted-request-id",
      )
      ?? response.headers.get(
        "x-line-request-id",
      )
      ?? null
    );
  }

  return (
    response.headers.get(
      "x-line-request-id",
    )
    ?? null
  );
}


export function sleepMirrorWorker(
  ms,
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        Math.max(
          0,
          Number(ms) || 0,
        ),
      ),
  );
}


async function callMirrorRpc(
  supabase,
  name,
  args,
) {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      name,
      args,
    );

  if (error) {
    throw new Error(
      `MIRROR_RPC_${name}: ${
        error.message
        ?? String(error)
      }`,
    );
  }

  return data;
}


async function releaseMirrorLeaseBestEffort({
  supabase,
  destinationLineGroupId,
  leaseToken,
  logger,
}) {
  if (!leaseToken) {
    return false;
  }

  try {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        "release_line_message_mirror_destination_worker",
        {
          p_destination_line_group_id:
            destinationLineGroupId,

          p_lease_token:
            leaseToken,
        },
      );

    if (error) {
      logger?.error?.(
        "LINE mirror lease release failed",
        destinationLineGroupId,
        error,
      );

      return false;
    }

    return data === true;
  } catch (error) {
    logger?.error?.(
      "LINE mirror lease release exception",
      destinationLineGroupId,
      error,
    );

    return false;
  }
}


export async function wakeLineMirrorDestinationBestEffort({
  supabase,
  destinationLineGroupId,
  baseUrl,
  workerSecret,
  fetchImpl = fetch,
  logger = console,
  wakeTimeoutMs =
    LINE_MIRROR_WAKE_TIMEOUT_MS,
}) {
  const destination =
    String(
      destinationLineGroupId
        ?? "",
    ).trim();

  const origin =
    String(
      baseUrl
        ?? "",
    ).trim();

  const secret =
    String(
      workerSecret
        ?? "",
    );

  if (!destination) {
    return {
      woken: false,
      skipped:
        "DESTINATION_MISSING",
    };
  }

  if (
    !origin
    || !/^https?:\/\//i.test(
      origin,
    )
  ) {
    return {
      woken: false,
      skipped:
        "WORKER_BASE_URL_MISSING",
    };
  }

  if (!secret) {
    return {
      woken: false,
      skipped:
        "WORKER_SECRET_MISSING",
    };
  }

  let reservation;

  try {
    const {
      data,
      error,
    } =
      await supabase.rpc(
        "reserve_line_message_mirror_destination_worker",
        {
          p_destination_line_group_id:
            destination,

          p_lease_seconds:
            LINE_MIRROR_LEASE_SECONDS,
        },
      );

    if (error) {
      logger?.error?.(
        "LINE mirror worker reservation failed",
        destination,
        error,
      );

      return {
        woken: false,
        error:
          error.message
          ?? String(error),
      };
    }

    reservation =
      data ?? null;
  } catch (error) {
    logger?.error?.(
      "LINE mirror worker reservation exception",
      destination,
      error,
    );

    return {
      woken: false,
      error:
        error?.message
        ?? String(error),
    };
  }

  if (!reservation?.reserved) {
    return {
      woken: false,
      skipped:
        reservation?.reason
        ?? "NOT_RESERVED",
    };
  }

  const leaseToken =
    reservation.lease_token;

  if (!leaseToken) {
    return {
      woken: false,
      error:
        "RESERVATION_LEASE_TOKEN_MISSING",
    };
  }

  const workerUrl =
    new URL(
      "/.netlify/functions/line-message-mirror-background",
      origin,
    );

  let response;

  try {
    response =
      await fetchImpl(
        workerUrl,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json",

            "x-line-message-mirror-worker-secret":
              secret,
          },

          body:
            JSON.stringify({
              destination_line_group_id:
                destination,

              lease_token:
                leaseToken,
            }),

          // Wake is secondary to admitted message processing.
          // Never let an internal Netlify invocation hang Parser/OCR.
          signal:
            mirrorFetchSignal(
              Math.max(
                1,
                Number(
                  wakeTimeoutMs,
                )
                || LINE_MIRROR_WAKE_TIMEOUT_MS,
              ),
            ),
        },
      );
  } catch (error) {
    // Network error / timeout is an ambiguous acceptance boundary.
    //
    // Netlify may already have accepted the background invocation
    // even though this caller never observed HTTP 202. Releasing the
    // destination lease here could allow a second worker to enter
    // while the accepted worker is still running.
    //
    // Therefore preserve the reservation until it expires or the
    // accepted worker renews/releases it itself.
    logger?.error?.(
      "Ambiguous LINE mirror background invocation",
      destination,
      error,
    );

    return {
      woken: false,

      ambiguous:
        true,

      lease_retained:
        true,

      error:
        error?.message
        ?? String(error),
    };
  }

  if (response.status !== 202) {
    const detail =
      await response
        .text()
        .catch(
          () => "",
        );

    await releaseMirrorLeaseBestEffort({
      supabase,
      destinationLineGroupId:
        destination,
      leaseToken,
      logger,
    });

    logger?.error?.(
      "Unexpected LINE mirror background response",
      destination,
      response.status,
      detail.slice(
        0,
        500,
      ),
    );

    return {
      woken: false,
      status:
        response.status,
    };
  }

  return {
    woken: true,
    lease_token:
      leaseToken,
  };
}


async function renewMirrorLease(
  supabase,
  destination,
  leaseToken,
  seconds,
) {
  return (
    await callMirrorRpc(
      supabase,
      "renew_line_message_mirror_destination_worker",
      {
        p_destination_line_group_id:
          destination,

        p_lease_token:
          leaseToken,

        p_lease_seconds:
          seconds,
      },
    )
  ) === true;
}


async function waitWithMirrorLease({
  supabase,
  destination,
  getLeaseToken,
  waitMs,
  sleepImpl,
}) {
  const remaining =
    Math.max(
      1,
      Math.min(
        300000,
        Math.ceil(
          Number(waitMs)
          || 0,
        ),
      ),
    );

  // Do not sleep the entire remaining flush window.
  //
  // New messages cannot start another worker while this worker
  // owns the destination lease. Re-checking claim every second
  // lets a queue that reaches max_batch_size flush promptly,
  // while the DB still owns the authoritative 30-second age rule.
  const step =
    Math.min(
      remaining,
      LINE_MIRROR_WAIT_POLL_MS,
    );

  await sleepImpl(
    step,
  );

  return renewMirrorLease(
    supabase,
    destination,
    getLeaseToken(),
    LINE_MIRROR_LEASE_SECONDS,
  );
}

async function responseErrorDetail(
  response,
) {
  const body =
    await response
      .text()
      .catch(
        () => "",
      );

  return body
    .replace(
      /\s+/g,
      " ",
    )
    .trim()
    .slice(
      0,
      1000,
    );
}


function mirrorFetchSignal(
  timeoutMs,
) {
  if (
    typeof AbortSignal
      ?.timeout
    === "function"
  ) {
    return AbortSignal.timeout(
      timeoutMs,
    );
  }

  return undefined;
}


export async function runLineMirrorDestinationWorker({
  supabase,
  destinationLineGroupId,
  leaseToken,
  lineChannelAccessToken,
  fetchImpl = fetch,
  sleepImpl = sleepMirrorWorker,
  logger = console,
  retryDelaysMs =
    LINE_MIRROR_RETRY_DELAYS_MS,
  fetchTimeoutMs =
    LINE_MIRROR_FETCH_TIMEOUT_MS,
  maxBatches =
    LINE_MIRROR_MAX_BATCHES_PER_RUN,
}) {
  const destination =
    String(
      destinationLineGroupId
        ?? "",
    ).trim();

  const channelAccessToken =
    String(
      lineChannelAccessToken
        ?? "",
    );

  if (!destination) {
    throw new Error(
      "MIRROR_DESTINATION_REQUIRED",
    );
  }

  if (!leaseToken) {
    throw new Error(
      "MIRROR_LEASE_TOKEN_REQUIRED",
    );
  }

  if (!channelAccessToken) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
    );
  }

  let currentLeaseToken =
    leaseToken;

  let releaseOnExit =
    true;

  let batchesHandled =
    0;

  const getLeaseToken =
    () =>
      currentLeaseToken;

  try {
    while (
      batchesHandled
      < maxBatches
    ) {
      let claim =
        await callMirrorRpc(
          supabase,
          "claim_line_message_mirror_destination_batch",
          {
            p_destination_line_group_id:
              destination,

            p_lease_token:
              currentLeaseToken,
          },
        );

      if (
        claim?.state
        === "LEASE_NOT_OWNED"
      ) {
        const reservation =
          await callMirrorRpc(
            supabase,
            "reserve_line_message_mirror_destination_worker",
            {
              p_destination_line_group_id:
                destination,

              p_lease_seconds:
                LINE_MIRROR_LEASE_SECONDS,
            },
          );

        if (
          !reservation
            ?.reserved
        ) {
          return {
            status:
              "LEASE_LOST",

            reason:
              reservation?.reason
              ?? null,

            batches_handled:
              batchesHandled,
          };
        }

        currentLeaseToken =
          reservation
            .lease_token;

        claim =
          await callMirrorRpc(
            supabase,
            "claim_line_message_mirror_destination_batch",
            {
              p_destination_line_group_id:
                destination,

              p_lease_token:
                currentLeaseToken,
            },
          );
      }

      if (
        claim?.state
        === "EMPTY"
      ) {
        return {
          status: "DRAINED",
          batches_handled:
            batchesHandled,
        };
      }

      if (
        claim?.state
        === "WAIT"
      ) {
        const leaseAlive =
          await waitWithMirrorLease({
            supabase,
            destination,
            getLeaseToken,
            waitMs:
              claim.wait_ms,
            sleepImpl,
          });

        if (!leaseAlive) {
          return {
            status:
              "LEASE_LOST",

            batches_handled:
              batchesHandled,
          };
        }

        continue;
      }

      if (
        claim?.state
          !== "CLAIMED"
        && claim?.state
          !== "EXISTING"
      ) {
        throw new Error(
          `MIRROR_CLAIM_STATE_UNEXPECTED:${
            claim?.state
            ?? "NULL"
          }`,
        );
      }

      const batchId =
        claim.batch_id;

      const retryKey =
        claim.retry_key;

      const items =
        Array.isArray(
          claim.items,
        )
          ? claim.items
          : [];

      if (
        !batchId
        || !retryKey
      ) {
        throw new Error(
          "MIRROR_BATCH_IDENTITY_MISSING",
        );
      }

      const nonText =
        items.find(
          (item) =>
            item
              ?.message_type
            !== "text",
        );

      if (nonText) {
        const failed =
          await callMirrorRpc(
            supabase,
            "fail_line_message_mirror_batch",
            {
              p_batch_id:
                batchId,

              p_lease_token:
                currentLeaseToken,

              p_error:
                "MIR2C_C_TEXT_ONLY_BLOCKED_NON_TEXT_BATCH",
            },
          );

        if (failed !== true) {
          throw new Error(
            "MIRROR_NON_TEXT_FAIL_TRANSITION_REJECTED",
          );
        }

        return {
          status:
            "BLOCKED_NON_TEXT",

          batch_id:
            batchId,

          batches_handled:
            batchesHandled,
        };
      }

      const pushPayload =
        buildLineMirrorTextPayload(
          destination,
          items,
        );

      // Construct exactly once.
      // All network retries reuse this same body string,
      // destination and persisted retry key.
      const requestBody =
        JSON.stringify(
          pushPayload,
        );

      let terminal =
        false;

      const retrySchedule =
        Array.isArray(
          retryDelaysMs,
        )
          ? retryDelaysMs
          : [];

      const attempts =
        retrySchedule.length
        + 1;

      for (
        let attempt = 0;
        attempt < attempts;
        attempt += 1
      ) {
        let leaseReady =
          await renewMirrorLease(
            supabase,
            destination,
            currentLeaseToken,
            LINE_MIRROR_LEASE_SECONDS,
          );

        if (!leaseReady) {
          const reservation =
            await callMirrorRpc(
              supabase,
              "reserve_line_message_mirror_destination_worker",
              {
                p_destination_line_group_id:
                  destination,

                p_lease_seconds:
                  LINE_MIRROR_LEASE_SECONDS,
              },
            );

          if (
            !reservation
              ?.reserved
            || !reservation
              ?.lease_token
          ) {
            return {
              status:
                "LEASE_LOST",

              reason:
                reservation?.reason
                ?? null,

              batch_id:
                batchId,

              batches_handled:
                batchesHandled,
            };
          }

          currentLeaseToken =
            reservation
              .lease_token;

          leaseReady =
            true;
        }

        if (!leaseReady) {
          return {
            status:
              "LEASE_LOST",

            batch_id:
              batchId,

            batches_handled:
              batchesHandled,
          };
        }

        const begin =
          await callMirrorRpc(
            supabase,
            "begin_line_message_mirror_batch_attempt",
            {
              p_batch_id:
                batchId,

              p_lease_token:
                currentLeaseToken,
            },
          );

        if (!begin?.ok) {
          throw new Error(
            `MIRROR_BEGIN_ATTEMPT_REJECTED:${
              begin?.reason
              ?? "UNKNOWN"
            }`,
          );
        }

        let response;

        try {
          response =
            await fetchImpl(
              LINE_MIRROR_PUSH_URL,
              {
                method: "POST",

                headers: {
                  authorization:
                    `Bearer ${channelAccessToken}`,

                  "content-type":
                    "application/json",

                  "x-line-retry-key":
                    String(
                      retryKey,
                    ),
                },

                body:
                  requestBody,

                signal:
                  mirrorFetchSignal(
                    fetchTimeoutMs,
                  ),
              },
            );
        } catch (error) {
          const reason =
            `LINE_PUSH_NETWORK_ERROR:${
              error?.message
              ?? String(error)
            }`.slice(
              0,
              1800,
            );

          const failed =
            await callMirrorRpc(
              supabase,
              "fail_line_message_mirror_batch",
              {
                p_batch_id:
                  batchId,

                p_lease_token:
                  currentLeaseToken,

                p_error:
                  reason,
              },
            );

          if (failed !== true) {
            throw new Error(
              "MIRROR_FAIL_TRANSITION_REJECTED",
            );
          }

          if (
            attempt
            < retrySchedule.length
          ) {
            await sleepImpl(
              Math.max(
                0,
                Number(
                  retrySchedule[
                    attempt
                  ],
                )
                || 0,
              ),
            );

            continue;
          }

          const renewed =
            await renewMirrorLease(
              supabase,
              destination,
              currentLeaseToken,
              LINE_MIRROR_RETRY_LEASE_SECONDS,
            );

          if (renewed) {
            releaseOnExit =
              false;
          }

          throw new Error(
            "LINE_MIRROR_RETRYABLE_NETWORK_EXHAUSTED",
          );
        }

        const classification =
          classifyLineMirrorPushStatus(
            response.status,
          );

        if (
          classification
            === "ACCEPTED"
          || classification
            === "ALREADY_ACCEPTED"
        ) {
          const requestId =
            getLineMirrorRequestId(
              response,
              response.status,
            );

          const completed =
            await callMirrorRpc(
              supabase,
              "complete_line_message_mirror_batch",
              {
                p_batch_id:
                  batchId,

                p_lease_token:
                  currentLeaseToken,

                p_line_request_id:
                  requestId,
              },
            );

          if (
            completed
            !== true
          ) {
            throw new Error(
              "MIRROR_COMPLETE_TRANSITION_REJECTED",
            );
          }

          terminal =
            true;

          break;
        }

        const detail =
          await responseErrorDetail(
            response,
          );

        if (
          classification
          === "PERMANENT"
        ) {
          const cancelled =
            await callMirrorRpc(
              supabase,
              "cancel_line_message_mirror_batch",
              {
                p_batch_id:
                  batchId,

                p_lease_token:
                  currentLeaseToken,

                p_reason:
                  `LINE_NON_RETRYABLE_HTTP_${response.status}:${
                    detail
                    || "NO_DETAIL"
                  }`,
              },
            );

          if (
            cancelled
            !== true
          ) {
            throw new Error(
              "MIRROR_CANCEL_TRANSITION_REJECTED",
            );
          }

          terminal =
            true;

          break;
        }

        const failed =
          await callMirrorRpc(
            supabase,
            "fail_line_message_mirror_batch",
            {
              p_batch_id:
                batchId,

              p_lease_token:
                currentLeaseToken,

              p_error:
                `LINE_RETRYABLE_HTTP_${response.status}:${
                  detail
                  || "NO_DETAIL"
                }`,
            },
          );

        if (failed !== true) {
          throw new Error(
            "MIRROR_FAIL_TRANSITION_REJECTED",
          );
        }

        if (
          attempt
          < retrySchedule.length
        ) {
          await sleepImpl(
            Math.max(
              0,
              Number(
                retrySchedule[
                  attempt
                ],
              )
              || 0,
            ),
          );

          continue;
        }

        const renewed =
          await renewMirrorLease(
            supabase,
            destination,
            currentLeaseToken,
            LINE_MIRROR_RETRY_LEASE_SECONDS,
          );

        if (renewed) {
          releaseOnExit =
            false;
        }

        throw new Error(
          `LINE_MIRROR_RETRYABLE_HTTP_EXHAUSTED:${response.status}`,
        );
      }

      if (!terminal) {
        throw new Error(
          "MIRROR_BATCH_NOT_TERMINAL",
        );
      }

      batchesHandled += 1;
    }

    return {
      status:
        "BATCH_LIMIT_REACHED",

      batches_handled:
        batchesHandled,
    };
  } finally {
    if (releaseOnExit) {
      await releaseMirrorLeaseBestEffort({
        supabase,
        destinationLineGroupId:
          destination,

        leaseToken:
          currentLeaseToken,

        logger,
      });
    }
  }
}
