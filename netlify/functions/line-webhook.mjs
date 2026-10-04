import { Client } from "@upstash/qstash";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseOrder } from "../../src/lib/order-parser.mjs";
import { firstLedgerCode } from "../../src/lib/report-ledger.mjs";
import {
  downloadLineImage,
  isRetryableGeminiOcrError,
  shouldReviewOcrParseResult,
  transcribeOrderImage,
} from "../../src/lib/image-ocr.mjs";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
import {
  normalizeMirrorDestinations,
  wakeLineMirrorDestinationBestEffort,
} from "../../src/lib/line-message-mirror-transport.mjs";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const REVIEW_IMAGE_BUCKET = "review-images";

if (!LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.warn("Missing one or more required core environment variables");
}

const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_SECRET_KEY ?? "", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function verifyLineSignature(rawBody, signature) {
  if (!signature || !LINE_CHANNEL_SECRET) return false;
  const expected = createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bangkokBusinessDate(timestampMs) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));

  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

async function loadParserConfig() {
  const { data, error } = await supabase
    .from("category_aliases")
    .select("alias,canonical_category")
    .eq("enabled", true);
  if (error) throw error;

  const aliases = {};
  for (const row of data ?? []) aliases[row.alias] = row.canonical_category;

  return {
    aliases,
    defaultCategoryByCodeLength: { 2: "A", 3: "E" },
  };
}


async function resolveOpenSettlementSession() {
  const { data, error } = await supabase
    .from("settlement_sessions")
    .select("id,business_date,status")
    .eq("status", "OPEN")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveLineGroup(lineGroupId) {
  const { data, error } = await supabase
    .from("line_groups")
    .select("line_group_id,line_group_name,summary_group_id")
    .eq("line_group_id", lineGroupId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}


async function resolveSettlementLineGroup(sessionId, lineGroupId) {
  if (!sessionId) return resolveLineGroup(lineGroupId);
  const { data, error } = await supabase
    .from("settlement_line_group_config")
    .select("line_group_id,line_group_name,summary_group_id,reduction_pct,enabled")
    .eq("settlement_session_id", sessionId)
    .eq("line_group_id", lineGroupId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function isSettlementSummaryGroupAccepting(
  sessionId,
  summaryGroupId,
) {
  if (!sessionId || !summaryGroupId) return true;

  const { data, error } = await supabase
    .from("settlement_summary_group_controls")
    .select("accepting_orders")
    .eq("settlement_session_id", sessionId)
    .eq("summary_group_id", summaryGroupId)
    .maybeSingle();

  if (error) throw error;

  return data?.accepting_orders !== false;
}

async function markSummaryGroupClosedReview(
  message,
  summaryGroupId,
) {
  await supabase
    .from("messages")
    .update({ parse_status: "REVIEW" })
    .eq("id", message.id);

  await saveReview(
    message.id,
    [{
      code: "SUMMARY_GROUP_CLOSED",
      detail: summaryGroupId,
    }],
    [],
  );

  return {
    status: "REVIEW",
    reason: "SUMMARY_GROUP_CLOSED",
  };
}


const LINE_WEBHOOK_INGRESS_ADMISSION_TIMEOUT_MS =
  1500;

// Q1A temporal admission v2.
// Admission belongs to the original LINE event timestamp,
// never to the later QStash consumer execution time.
function normalizeLineEventTimestamp(eventTimestamp) {
  const epochMs =
    Number(eventTimestamp);

  if (
    !Number.isFinite(epochMs)
    || epochMs <= 0
  ) {
    return null;
  }

  const date =
    new Date(epochMs);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return {
    epoch_ms:
      epochMs,
    iso:
      date.toISOString(),
  };
}

function isQStashIngressEnabledForAdmission() {
  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(
    String(
      process.env.LINE_WEBHOOK_QSTASH_ENABLED
        ?? "",
    )
      .trim()
      .toLowerCase(),
  );
}

function isLineOrderIngressMessage(event) {
  return (
    event?.source?.type === "group"
    && event?.type === "message"
    && (
      event?.message?.type === "text"
      || event?.message?.type === "image"
    )
  );
}

function isLineUnsendIngressEvent(event) {
  return (
    event?.source?.type === "group"
    && event?.type === "unsend"
  );
}

function validTemporalAdmissionHint(
  admissionHint,
  event,
) {
  const roundId =
    String(
      admissionHint?.round_id
      ?? "",
    ).trim();

  const hintTimestamp =
    Number(
      admissionHint?.event_timestamp,
    );

  const eventTimestamp =
    Number(
      event?.timestamp,
    );

  const hintLineGroupId =
    String(
      admissionHint?.line_group_id
      ?? "",
    );

  const eventLineGroupId =
    String(
      event?.source?.groupId
      ?? "",
    );

  const hintWebhookEventId =
    String(
      admissionHint?.webhook_event_id
      ?? "",
    );

  const eventWebhookEventId =
    String(
      event?.webhookEventId
      ?? "",
    );

  if (
    !roundId
    || !Number.isFinite(
      hintTimestamp,
    )
    || !Number.isFinite(
      eventTimestamp,
    )
    || hintTimestamp
      !== eventTimestamp
    || !hintLineGroupId
    || hintLineGroupId
      !== eventLineGroupId
    || !hintWebhookEventId
    || hintWebhookEventId
      !== eventWebhookEventId
  ) {
    return null;
  }

  return {
    admitted: true,
    reason:
      "PUBLISHER_TEMPORAL_ADMISSION",
    round_id:
      roundId,
    resumed: false,
    carried: true,
  };
}

export async function readLineWebhookIngressAdmission(
  lineGroupId,
  eventTimestamp,
  webhookEventId = null,
) {
  const normalized =
    normalizeLineEventTimestamp(
      eventTimestamp,
    );

  if (!normalized) {
    return {
      admitted: false,
      reason:
        "INVALID_EVENT_TIMESTAMP",
      round_id: null,
      resumed: false,
    };
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      LINE_WEBHOOK_INGRESS_ADMISSION_TIMEOUT_MS,
    );

  try {
    const {
      data,
      error,
    } = await supabase
      .rpc(
        "line_webhook_ingress_admission",
        {
          p_line_group_id:
            lineGroupId,
          p_event_timestamp:
            normalized.iso,
          p_webhook_event_id:
            webhookEventId,
        },
      )
      .abortSignal(
        controller.signal,
      );

    if (error) {
      throw new Error(
        "LINE_WEBHOOK_INGRESS_ADMISSION_UNAVAILABLE: "
        + (
          error.message
          ?? String(error)
        ),
      );
    }

    return {
      admitted:
        data?.admitted === true,
      reason:
        String(
          data?.reason
          ?? "UNKNOWN",
        ),
      resumed:
        data?.resumed === true,
      round_id:
        data?.round_id
        ?? null,
      settlement_session_id:
        data?.settlement_session_id
        ?? null,
      summary_group_id:
        data?.summary_group_id
        ?? null,
      event_timestamp:
        normalized.epoch_ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function selectQStashIngressEvents(
  events,
  admissionHints,
) {
  const selected = [];

  for (const event of events ?? []) {
    if (!event?.webhookEventId) {
      continue;
    }

    if (
      event?.source?.type
      !== "group"
    ) {
      continue;
    }

    // UNSEND must survive independently of current Round state.
    if (
      isLineUnsendIngressEvent(
        event,
      )
    ) {
      selected.push(event);
      continue;
    }

    if (
      !isLineOrderIngressMessage(
        event,
      )
    ) {
      continue;
    }

    const lineGroupId =
      String(
        event?.source?.groupId
        ?? "",
      ).trim();

    if (!lineGroupId) {
      continue;
    }

    try {
      const admission =
        await readLineWebhookIngressAdmission(
          lineGroupId,
          event.timestamp,
          null,
        );

      if (
        admission.admitted
        && admission.round_id
      ) {
        selected.push(event);

        admissionHints.set(
          event.webhookEventId,
          {
            round_id:
              admission.round_id,
            event_timestamp:
              Number(
                event.timestamp,
              ),
            line_group_id:
              lineGroupId,
            webhook_event_id:
              event.webhookEventId,
          },
        );

        continue;
      }

      console.info(
        "LINE QStash temporal ingress skipped",
        {
          webhookEventId:
            event.webhookEventId,
          lineGroupId,
          eventTimestamp:
            event.timestamp
            ?? null,
          reason:
            admission.reason,
        },
      );
    } catch (error) {
      // Public gateway fails OPEN into QStash when DB state
      // cannot be determined. The consumer will retry temporal
      // admission before touching claim_webhook_event.
      console.warn(
        "LINE QStash temporal admission unavailable; fail-open",
        {
          webhookEventId:
            event.webhookEventId,
          lineGroupId,
          error:
            error?.message
            ?? String(error),
        },
      );

      selected.push(event);
    }
  }

  return selected;
}

async function claimWebhookEvent(destination, event) {
  const { data, error } = await supabase.rpc(
    "claim_webhook_event",
    {
      p_webhook_event_id: event.webhookEventId,
      p_destination: destination,
      p_event_type: event.type,
      p_line_group_id: event.source?.groupId ?? null,
      p_user_id: event.source?.userId ?? null,
      p_is_redelivery: Boolean(event.deliveryContext?.isRedelivery),
      p_payload: event,
    },
  );

  if (error) throw error;
  return data;
}

async function markWebhookProcessed(webhookEventId) {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_started_at: null,
      last_error: null,
    })
    .eq("webhook_event_id", webhookEventId);

  if (error) throw error;
}

async function markWebhookFailed(webhookEventId, error) {
  const detail = (error?.message ?? String(error)).slice(0, 1000);

  const { error: updateError } = await supabase
    .from("webhook_events")
    .update({
      processing_started_at: null,
      last_error: detail,
    })
    .eq("webhook_event_id", webhookEventId);

  if (updateError) {
    console.error(
      "Failed to release webhook claim",
      webhookEventId,
      updateError,
    );
  }
}


async function enqueueLineMessageMirrorBestEffort(message) {
  const mirrorEnabled =
    String(
      process.env.LINE_MESSAGE_MIRROR_ENABLED
        ?? "",
    )
      .trim()
      .toLowerCase()
      === "true";

  if (!mirrorEnabled) {
    return {
      queued: false,
      skipped: "MIRROR_DISABLED",
    };
  }

  if (
    !message?.id
    || !message?.summary_group_round_id
  ) {
    return {
      queued: false,
      skipped: "NOT_ADMITTED_TO_WORKING_ROUND",
    };
  }

  if (
    message.message_type !== "text"
    && message.message_type !== "image"
  ) {
    return {
      queued: false,
      skipped: "UNSUPPORTED_MESSAGE_TYPE",
    };
  }

  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "enqueue_line_message_mirror",
      {
        p_message_record_id:
          message.id,
      },
    );

    if (error) {
      console.error(
        "LINE mirror enqueue failed",
        message.webhook_event_id
          ?? message.id,
        error,
      );

      return {
        queued: false,
        error:
          error.message
          ?? String(error),
      };
    }

    const result =
      data ?? null;

    const destinations =
      normalizeMirrorDestinations(
        result,
      );

    // Destinations are independent serialization boundaries.
    // Wake them concurrently so one slow Netlify invocation cannot
    // multiply Parser/OCR delay across multiple destinations.
    const wakeResults =
      await Promise.all(
        destinations.map(
          async (
            destinationLineGroupId,
          ) => {
            try {
              const wakeResult =
                await wakeLineMirrorDestinationBestEffort({
                  supabase,

                  destinationLineGroupId,

                  // Netlify runtime main-site URL.
                  // Mirror stays disabled unless the global kill switch
                  // above is explicitly true.
                  baseUrl:
                    process.env.URL,

                  workerSecret:
                    process.env.LINE_MESSAGE_MIRROR_WORKER_SECRET,

                  logger:
                    console,
                });

              return {
                destination_line_group_id:
                  destinationLineGroupId,

                ...wakeResult,
              };
            } catch (wakeError) {
              // Enqueue already succeeded. Wake failure is secondary
              // and must never become Parser/OCR/Review failure.
              console.error(
                "LINE mirror wake exception",
                destinationLineGroupId,
                wakeError,
              );

              return {
                destination_line_group_id:
                  destinationLineGroupId,

                woken:
                  false,

                error:
                  wakeError?.message
                  ?? String(
                    wakeError,
                  ),
              };
            }
          },
        ),
      );
    return {
      queued: true,
      result,
      wake_results:
        wakeResults,
    };
  } catch (error) {
    // Mirror transport is deliberately secondary.
    // Never make Parser/OCR/Review fail because mirror enqueue failed.
    console.error(
      "LINE mirror enqueue exception",
      message.webhook_event_id
        ?? message.id,
      error,
    );

    return {
      queued: false,
      error:
        error?.message
        ?? String(error),
    };
  }
}

async function findMessageByWebhookEvent(webhookEventId) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id,destination,webhook_event_id,message_id,business_date,settlement_session_id,summary_group_round_id,event_timestamp,line_group_id,summary_group_id,user_id,message_type,raw_text,normalized_text,parse_status,parser_version,unsent"
    )
    .eq("webhook_event_id", webhookEventId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function isExistingMessageComplete(message) {
  if (!message) return false;

  if (message.parse_status === "PARSED") {
    const { count, error } = await supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("message_record_id", message.id);

    if (error) throw error;

    // Critical invariant:
    // PARSED + zero canonical items is NOT complete.
    return Number(count ?? 0) > 0;
  }

  if (
    ["REVIEW", "PARTIAL", "IGNORE"].includes(
      message.parse_status,
    )
  ) {
    const { data, error } = await supabase
      .from("review_items")
      .select("id")
      .eq("message_record_id", message.id)
      .maybeSingle();

    if (error) throw error;
    return Boolean(data);
  }

  return false;
}

function lineMessageAdmissionFailureReason(error) {
  const detail = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ]
    .filter(Boolean)
    .join(" ");

  for (const reason of [
    "SETTLEMENT_NOT_OPEN",
    "GROUP_NOT_CONFIGURED",
    "SUMMARY_GROUP_NOT_OPEN",
    "MESSAGE_EVENT_OUTSIDE_ROUND",
    "MESSAGE_LINE_GROUP_CONFIG_MISMATCH",
  ]) {
    if (detail.includes(reason)) return reason;
  }

  return null;
}

async function createMessage({
  destination,
  event,
  messageType,
  rawText = null,
  parseStatus = "PENDING",
  summaryGroupRoundId = null,
}) {
  const timestamp =
    new Date(event.timestamp).toISOString();

  const row = {
    destination,
    webhook_event_id:
      event.webhookEventId,
    message_id:
      event.message?.id ?? null,
    event_timestamp:
      timestamp,
    line_group_id:
      event.source.groupId,
    user_id:
      event.source?.userId ?? null,
    message_type:
      messageType,
    raw_text:
      rawText,
    parse_status:
      parseStatus,
    summary_group_round_id:
      summaryGroupRoundId,
  };

  const {
    data,
    error,
  } = await supabase
    .from("messages")
    .insert(row)
    .select(
      "id,settlement_session_id,business_date,summary_group_id,summary_group_round_id",
    )
    .maybeSingle();

  if (error) {
    const reason =
      lineMessageAdmissionFailureReason(
        error,
      );

    if (reason) {
      return {
        ignored: true,
        reason,
      };
    }

    throw error;
  }

  if (!data) {
    throw new Error(
      "MESSAGE_ADMISSION_RETURNED_NO_ROW",
    );
  }

  return {
    ...row,
    ...data,
  };
}

async function saveReview(messageRecordId, reasonCodes, warnings = []) {
  const { error } = await supabase.from("review_items").insert({
    message_record_id: messageRecordId,
    reason_codes: reasonCodes,
    warnings,
  });
  if (error) throw error;
}

async function persistParsedResult(message, group, result, extraMessageUpdate = {}) {
  // Safety invariant:
  // PARSED must always have at least one canonical order item.
  if (result.status === "PARSED" && !result.items.length) {
    const errors = [
      ...(result.errors ?? []),
      {
        code: "PARSED_WITHOUT_ITEMS",
        detail: "Parser returned PARSED without canonical items",
      },
    ];

    const { error: updateError } = await supabase
      .from("messages")
      .update({
        normalized_text: result.normalized_text,
        parse_status: "REVIEW",
        parser_version: result.parser_version,
        ...extraMessageUpdate,
      })
      .eq("id", message.id);

    if (updateError) throw updateError;

    await saveReview(message.id, errors, result.warnings ?? []);

    return {
      status: "REVIEW",
      items: 0,
      parser_version: result.parser_version,
    };
  }

  if (result.status === "PARSED") {
    const summaryGroupId =
      message.summary_group_id ?? group?.summary_group_id ?? null;

    const { data, error } = await supabase.rpc(
      "persist_parsed_message_atomic_admitted",
      {
        p_message_id: message.id,
        p_normalized_text: result.normalized_text,
        p_parser_version: result.parser_version,
        p_items: result.items,
        p_summary_group_id: summaryGroupId,
        p_message_patch: extraMessageUpdate,
      },
    );

    if (error) throw error;

    return {
      status: "PARSED",
      items: Number(data?.items_count ?? result.items.length),
      parser_version: result.parser_version,
    };
  }

  // REVIEW / PARTIAL / IGNORE remain non-canonical.
  // Tentative PARTIAL items must never affect accounting totals.
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      normalized_text: result.normalized_text,
      parse_status: result.status,
      parser_version: result.parser_version,
      ...extraMessageUpdate,
    })
    .eq("id", message.id);

  if (updateError) throw updateError;

  if (
    ["REVIEW", "PARTIAL", "IGNORE"].includes(
      result.status,
    )
  ) {
    const reviewErrors =
      result.status === "IGNORE"
      && !(result.errors ?? []).length
        ? [
            {
              code:
                "PARSER_IGNORE_REQUIRES_HUMAN",

              detail:
                "Parser returned IGNORE for an in-round message; human interpretation is required",
            },
          ]
        : result.errors ?? [];

    await saveReview(
      message.id,
      reviewErrors,
      result.warnings ?? [],
    );
  }

  return {
    status: result.status,
    items: 0,
    parser_version: result.parser_version,
  };
}

async function handleTextMessage(
  destination,
  event,
  group,
  session,
  existingMessage = null,
  summaryGroupRoundId = null,
) {
  const text =
    event.message.text ?? "";

  const message =
    existingMessage
    ?? await createMessage({
      destination,
      event,
      messageType: "text",
      rawText: text,
      summaryGroupRoundId,
    });

  if (message?.ignored) {
    return {
      status: "IGNORED",
      reason: message.reason,
    };
  }

  // Mirror follows the same authoritative Round admission boundary
  // as the order system. A message that reached this point owns an
  // immutable summary_group_round_id assigned at DB admission time.
  //
  // Mirror failure remains isolated from Parser/OCR/Review.
  await enqueueLineMessageMirrorBestEffort(
    message,
  );

  // Legacy pre-cutover rows without Round ownership retain
  // their historical Review fallback.
  if (
    !message.summary_group_round_id
    && !message.settlement_session_id
  ) {
    await supabase
      .from("messages")
      .update({
        parse_status: "REVIEW",
      })
      .eq(
        "id",
        message.id,
      );

    await saveReview(
      message.id,
      [{
        code: "SETTLEMENT_NOT_OPEN",
        detail: "ยังไม่ได้เปิดยอด",
      }],
      [],
    );

    return {
      status: "REVIEW",
      reason: "SETTLEMENT_NOT_OPEN",
    };
  }

  // Once Round ownership exists, that immutable snapshot is
  // authoritative even if the group closes while processing.
  const effectiveGroup =
    message.summary_group_round_id
      && message.summary_group_id
      ? {
          summary_group_id:
            message.summary_group_id,
        }
      : message.settlement_session_id
          === session?.id
        ? group
        : await resolveSettlementLineGroup(
            message.settlement_session_id,
            message.line_group_id,
          );

  if (!effectiveGroup) {
    await supabase
      .from("messages")
      .update({
        parse_status: "REVIEW",
      })
      .eq(
        "id",
        message.id,
      );

    await saveReview(
      message.id,
      [{
        code: "GROUP_NOT_CONFIGURED",
        detail:
          event.source.groupId,
      }],
      [],
    );

    return {
      status: "REVIEW",
      reason: "GROUP_NOT_CONFIGURED",
    };
  }

  // Current accepting state is consulted only for historical
  // messages that predate Round-owned admission.
  if (!message.summary_group_round_id) {
    const groupAccepting =
      await isSettlementSummaryGroupAccepting(
        message.settlement_session_id,
        effectiveGroup.summary_group_id,
      );

    if (!groupAccepting) {
      return markSummaryGroupClosedReview(
        message,
        effectiveGroup.summary_group_id,
      );
    }
  }

  const config =
    await loadParserConfig();

  const result =
    parseOrder(
      text,
      config,
    );

  return persistParsedResult(
    message,
    effectiveGroup,
    result,
    {
      first_order_code:
        firstLedgerCode(
          result.items,
          text,
        ) || null,
    },
  );
}

async function storeImageReviewEvidence(message, image) {
  if (!image?.bytes?.length) {
    throw new Error(
      "IMAGE_REVIEW_EVIDENCE_BYTES_MISSING",
    );
  }

  const storagePath = String(message.id);
  const storedAt = new Date().toISOString();

  const { error: uploadError } =
    await supabase.storage
      .from(REVIEW_IMAGE_BUCKET)
      .upload(
        storagePath,
        image.bytes,
        {
          contentType: image.mimeType,
          upsert: true,
        },
      );

  if (uploadError) {
    throw new Error(
      `IMAGE_REVIEW_EVIDENCE_STORE_FAILED: ${
        uploadError.message ?? String(uploadError)
      }`,
    );
  }

  const { error: metadataError } =
    await supabase
      .from("messages")
      .update({
        image_storage_path: storagePath,
        image_stored_at: storedAt,
        image_deleted_at: null,
        image_content_type: image.mimeType,
        image_size_bytes: image.sizeBytes,
      })
      .eq("id", message.id);

  if (metadataError) {
    // Best-effort orphan cleanup.
    await supabase.storage
      .from(REVIEW_IMAGE_BUCKET)
      .remove([storagePath])
      .catch(() => null);

    throw new Error(
      `IMAGE_REVIEW_EVIDENCE_METADATA_FAILED: ${
        metadataError.message ?? String(metadataError)
      }`,
    );
  }

  return storagePath;
}


// Q2B image-media isolation foundation.
// Default OFF: production behavior remains inline until explicitly enabled.
function isLineImageMediaQStashEnabled() {
  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(
    String(
      process.env.LINE_IMAGE_MEDIA_QSTASH_ENABLED
        ?? "",
    )
      .trim()
      .toLowerCase(),
  );
}

async function enqueueLineImageMediaQStash({
  destination,
  event,
  message,
  mediaQueueUrl,
}) {
  const token =
    String(
      process.env.QSTASH_TOKEN
        ?? "",
    ).trim();

  if (!token) {
    throw new Error(
      "IMAGE_MEDIA_QSTASH_TOKEN_MISSING",
    );
  }

  if (!mediaQueueUrl) {
    throw new Error(
      "IMAGE_MEDIA_QSTASH_URL_MISSING",
    );
  }

  const client =
    new Client({
      token,
    });

  const published =
    await client.publishJSON({
      url:
        mediaQueueUrl,
      body: {
        destination,
        event,
        message_id:
          message.id,
        summary_group_round_id:
          message.summary_group_round_id,
      },
      retries: 5,
      deduplicationId:
        `line-image-media-${event.webhookEventId}`,
      flowControl: {
        key:
          "line-image-media-v1",
        parallelism: 1,
        rate: 2,
        period: "1s",
      },
    });

  return {
    queued: true,
    qstash_message_id:
      published?.messageId
      ?? null,
  };
}

export async function processImageMediaJob({
  destination,
  event,
  messageId,
  processingAttempt = 1,
}) {
  if (
    !destination
    || !event?.webhookEventId
    || event?.type !== "message"
    || event?.message?.type !== "image"
    || !messageId
  ) {
    throw new Error(
      "INVALID_IMAGE_MEDIA_JOB",
    );
  }

  const message =
    await findMessageByWebhookEvent(
      event.webhookEventId,
    );

  if (!message) {
    throw new Error(
      "IMAGE_MEDIA_MESSAGE_NOT_FOUND",
    );
  }

  if (
    String(message.id)
    !== String(messageId)
  ) {
    throw new Error(
      "IMAGE_MEDIA_MESSAGE_ID_MISMATCH",
    );
  }

  if (!message.summary_group_round_id) {
    throw new Error(
      "IMAGE_MEDIA_MESSAGE_NOT_ADMITTED",
    );
  }

  if (
    await isExistingMessageComplete(
      message,
    )
  ) {
    return {
      skipped:
        "MESSAGE_ALREADY_COMPLETE",
    };
  }

  return handleImageMessage(
    destination,
    event,
    null,
    null,
    message,
    null,
    processingAttempt,
    null,
    true,
  );
}

async function loadImageOcrCheckpoint(
  messageRecordId,
) {
  const {
    data,
    error,
  } = await supabase
    .from("messages")
    .select(
      [
        "ocr_text",
        "ocr_provider",
        "ocr_model",
        "ocr_status",
        "image_content_type",
        "image_size_bytes",
        "image_storage_path",
      ].join(","),
    )
    .eq(
      "id",
      messageRecordId,
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (
    !data
    || !["DONE", "UNCERTAIN"].includes(
      data.ocr_status,
    )
    || !String(
      data.ocr_text
      ?? "",
    ).trim()
  ) {
    return null;
  }

  return data;
}

async function handleImageMessage(
  destination,
  event,
  group,
  session,
  existingMessage = null,
  summaryGroupRoundId = null,
  processingAttempt = 1,
  mediaQueueUrl = null,
  mediaWorker = false,
) {
  const message =
    existingMessage
    ?? await createMessage({
      destination,
      event,
      messageType: "image",
      parseStatus: "PENDING",
      summaryGroupRoundId,
    });

  if (message?.ignored) {
    return {
      status: "IGNORED",
      reason: message.reason,
    };
  }

  // Mirror follows the same authoritative Round admission boundary
  // as the order system. A message that reached this point owns an
  // immutable summary_group_round_id assigned at DB admission time.
  //
  // Mirror failure remains isolated from Parser/OCR/Review.
  if (!mediaWorker) {
    await enqueueLineMessageMirrorBestEffort(
      message,
    );
  }

  // Legacy pre-cutover rows without Round ownership retain
  // historical Review behavior.
  if (
    !message.summary_group_round_id
    && !message.settlement_session_id
  ) {
    await supabase
      .from("messages")
      .update({
        parse_status: "REVIEW",
      })
      .eq(
        "id",
        message.id,
      );

    await saveReview(
      message.id,
      [{
        code: "SETTLEMENT_NOT_OPEN",
        detail: "ยังไม่ได้เปิดยอด",
      }],
      [],
    );

    return {
      status: "REVIEW",
      reason: "SETTLEMENT_NOT_OPEN",
    };
  }

  const effectiveGroup =
    message.summary_group_round_id
      && message.summary_group_id
      ? {
          summary_group_id:
            message.summary_group_id,
        }
      : message.settlement_session_id
          === session?.id
        ? group
        : await resolveSettlementLineGroup(
            message.settlement_session_id,
            message.line_group_id,
          );

  if (!effectiveGroup) {
    await supabase
      .from("messages")
      .update({
        parse_status: "REVIEW",
      })
      .eq(
        "id",
        message.id,
      );

    await saveReview(
      message.id,
      [{
        code: "GROUP_NOT_CONFIGURED",
        detail:
          event.source.groupId,
      }],
      [],
    );

    return {
      status: "REVIEW",
      reason: "GROUP_NOT_CONFIGURED",
    };
  }

  if (!message.summary_group_round_id) {
    const groupAccepting =
      await isSettlementSummaryGroupAccepting(
        message.settlement_session_id,
        effectiveGroup.summary_group_id,
      );

    if (!groupAccepting) {
      return markSummaryGroupClosedReview(
        message,
        effectiveGroup.summary_group_id,
      );
    }
  }

  if (event.message?.contentProvider?.type && event.message.contentProvider.type !== "line") {
    await supabase
      .from("messages")
      .update({ parse_status: "REVIEW", ocr_status: "ERROR", ocr_error: "IMAGE_EXTERNAL_CONTENT_UNSUPPORTED" })
      .eq("id", message.id);
    await saveReview(
      message.id,
      [{ code: "IMAGE_EXTERNAL_CONTENT_UNSUPPORTED", detail: event.message.contentProvider.type }],
      [],
    );
    return { status: "REVIEW", reason: "IMAGE_EXTERNAL_CONTENT_UNSUPPORTED" };
  }

  if (!LINE_CHANNEL_ACCESS_TOKEN || !GEMINI_API_KEY) {
    const missing = [
      !LINE_CHANNEL_ACCESS_TOKEN ? "LINE_CHANNEL_ACCESS_TOKEN" : null,
      !GEMINI_API_KEY ? "GEMINI_API_KEY" : null,
    ].filter(Boolean);

    await supabase
      .from("messages")
      .update({ parse_status: "REVIEW", ocr_status: "ERROR", ocr_error: `MISSING_ENV: ${missing.join(",")}` })
      .eq("id", message.id);
    await saveReview(
      message.id,
      [{ code: "IMAGE_OCR_CONFIG_MISSING", detail: missing.join(",") }],
      [],
    );
    return { status: "REVIEW", reason: "IMAGE_OCR_CONFIG_MISSING" };
  }

  if (
    !mediaWorker
    && message.summary_group_round_id
    && isLineImageMediaQStashEnabled()
    && mediaQueueUrl
  ) {
    const queued =
      await enqueueLineImageMediaQStash({
        destination,
        event,
        message,
        mediaQueueUrl,
      });

    return {
      status: "PENDING",
      queued:
        "IMAGE_MEDIA_QSTASH",
      message_id:
        message.id,
      qstash_message_id:
        queued.qstash_message_id,
    };
  }

  let image;
  let ocr;
  let ocrCheckpoint = null;

  if (mediaWorker) {
    ocrCheckpoint =
      await loadImageOcrCheckpoint(
        message.id,
      );

    if (ocrCheckpoint) {
      ocr = {
        text:
          ocrCheckpoint.ocr_text,
        provider:
          ocrCheckpoint.ocr_provider,
        model:
          ocrCheckpoint.ocr_model,
        uncertain:
          ocrCheckpoint.ocr_status
          === "UNCERTAIN",
      };
    }
  }

  // Only LINE image download / Gemini transcription errors belong to
  // IMAGE_OCR_FAILED. Parser or database persistence failures must escape
  // to processEvent so the webhook claim is released and LINE receives 500.
  if (!ocr) {
    try {
    image = await downloadLineImage(
      event.message.id,
      LINE_CHANNEL_ACCESS_TOKEN,
    );

    ocr = await transcribeOrderImage({
      bytes: image.bytes,
      mimeType: image.mimeType,
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    });
  } catch (error) {
    const detail = error?.message ?? String(error);

    const retryableProviderFailure =
      isRetryableGeminiOcrError(error);

    /*
     * One webhook/background attempt already contains the bounded
     * Gemini retry sequence in transcribeOrderImage().
     *
     * For provider-capacity failures, keep the message incomplete
     * for the first two webhook attempts so processEvent can release
     * the claim and the Netlify background function can retry later.
     *
     * On the third webhook attempt, convert the failure to REVIEW so
     * an unavailable provider cannot leave the message PENDING forever.
     */
    if (
      retryableProviderFailure
      && Number(processingAttempt || 1) < 3
    ) {
      const { error: retryStateError } =
        await supabase
          .from("messages")
          .update({
            parse_status: "PENDING",
            ocr_status: "ERROR",
            ocr_error: detail.slice(0, 1000),
          })
          .eq("id", message.id);

      if (retryStateError) {
        throw retryStateError;
      }

      throw error;
    }

    // At this point provider retry is exhausted or the OCR failure
    // is non-retryable. Preserve the downloaded image only when it
    // is about to become a Human Review item.
    if (image) {
      await storeImageReviewEvidence(
        message,
        image,
      );
    }

    await supabase
      .from("messages")
      .update({
        parse_status: "REVIEW",
        ocr_status: "ERROR",
        ocr_error: detail.slice(0, 1000),
      })
      .eq("id", message.id);

    await saveReview(
      message.id,
      [
        {
          code: "IMAGE_OCR_FAILED",
          detail: detail.slice(0, 500),
        },
      ],
      [],
    );

    return {
      status: "REVIEW",
      reason: "IMAGE_OCR_FAILED",
    };
  }

  }

  const baseUpdate = {
    ocr_text:
      ocr.text,
    ocr_provider:
      ocr.provider,
    ocr_model:
      ocr.model,
    ocr_status:
      ocr.uncertain
        ? "UNCERTAIN"
        : "DONE",
    ocr_error:
      null,
    image_content_type:
      image?.mimeType
      ?? ocrCheckpoint?.image_content_type
      ?? null,
    image_size_bytes:
      image?.sizeBytes
      ?? ocrCheckpoint?.image_size_bytes
      ?? null,
  };

  /*
   * Q2C durable OCR checkpoint:
   *
   * Once LINE download + Gemini succeeded, persist the OCR result
   * before deterministic parsing / canonical persistence.
   *
   * If anything after this point fails, a QStash redelivery can
   * resume from messages.ocr_* without paying for Gemini again.
   */
  if (!ocrCheckpoint) {
    const {
      error: checkpointError,
    } = await supabase
      .from("messages")
      .update(
        baseUpdate,
      )
      .eq(
        "id",
        message.id,
      );

    if (checkpointError) {
      throw checkpointError;
    }
  }

  /*
   * Every successfully OCR'd accepted LINE image keeps its original
   * private evidence for operator verification.
   *
   * Q2C resume safety:
   * - an existing OCR checkpoint is reused;
   * - Gemini is never called again here;
   * - LINE image bytes are downloaded only when Storage evidence
   *   is still missing.
   */
  const imageEvidenceStored =
    Boolean(
      ocrCheckpoint?.image_storage_path
      ?? message.image_storage_path
    );

  if (!imageEvidenceStored) {
    if (!image) {
      image =
        await downloadLineImage(
          event.message.id,
          LINE_CHANNEL_ACCESS_TOKEN,
        );
    }

    await storeImageReviewEvidence(
      message,
      image,
    );
  }


  if (ocr.uncertain) {
    await supabase
      .from("messages")
      .update({
        ...baseUpdate,
        normalized_text: ocr.text,
        parse_status: "REVIEW",
      })
      .eq("id", message.id);

    await saveReview(
      message.id,
      [
        {
          code: "OCR_UNCERTAIN",
          detail:
            "OCR output contains one or more uncertain characters marked with ?",
        },
      ],
      [],
    );

    return {
      status: "REVIEW",
      reason: "OCR_UNCERTAIN",
    };
  }

  const config = await loadParserConfig();
  const result = parseOrder(ocr.text, config);

  const ocrParseNeedsHumanReview =
    shouldReviewOcrParseResult(
      ocr.text,
      result,
    );

  const effectiveResult =
    ocrParseNeedsHumanReview
      ? {
          ...result,
          status: "REVIEW",
          items: [],
          errors: [
            ...(result.errors ?? []),
            {
              code:
                "OCR_PARSE_LOW_CONFIDENCE",
              detail:
                "OCR structure is more complex than the deterministic parse result; inspect the original image",
            },
          ],
        }
      : result;

  // Intentionally outside the OCR try/catch:
  // persistence failures must propagate to processEvent -> markWebhookFailed
  // -> HTTP 500 -> safe redelivery/resume.
  return persistParsedResult(
    message,
    effectiveGroup,
    effectiveResult,
    {
      ...baseUpdate,
      first_order_code:
        firstLedgerCode(effectiveResult.items, ocr.text) || null,
    },
  );

}

async function handleUnsend(destination, event) {
  const originalMessageId = event.unsend?.messageId;
  const unsentAt = new Date(event.timestamp).toISOString();

  const { data: message, error: findError } = await supabase
    .from("messages")
    .select("id,line_group_id,image_storage_path,image_deleted_at")
    .eq("destination", destination)
    .eq("message_id", originalMessageId)
    .maybeSingle();
  if (findError) throw findError;

  let derivedQtyTotal = 0;

  if (message) {
    const { data: items, error: itemFindError } = await supabase
      .from("order_items")
      .select("quantity")
      .eq("message_record_id", message.id);
    if (itemFindError) throw itemFindError;
    derivedQtyTotal = (items ?? []).reduce((sum, x) => sum + Number(x.quantity || 0), 0);

    if (message.image_storage_path) {
      const { error: imageDeleteError } =
        await supabase.storage
          .from(REVIEW_IMAGE_BUCKET)
          .remove([
            message.image_storage_path,
          ]);

      if (imageDeleteError) {
        throw imageDeleteError;
      }
    }

    const { error: messageUpdateError } = await supabase
      .from("messages")
      .update({
        unsent: true,
        unsent_at: unsentAt,
        raw_text: null,
        normalized_text: null,
        ocr_text: null,
        ocr_error: null,
        image_storage_path: null,
        image_deleted_at:
          message.image_storage_path
            ? unsentAt
            : message.image_deleted_at ?? null,
      })
      .eq("id", message.id);
    if (messageUpdateError) throw messageUpdateError;

    const { error: itemUpdateError } = await supabase
      .from("order_items")
      .update({ unsent_flag: true })
      .eq("message_record_id", message.id);
    if (itemUpdateError) throw itemUpdateError;
  }

  const { error: unsendError } = await supabase.from("unsend_events").insert({
    webhook_event_id: event.webhookEventId,
    destination,
    message_id: originalMessageId,
    line_group_id: event.source?.groupId ?? message?.line_group_id ?? null,
    user_id: event.source?.userId ?? null,
    matched_message_record_id: message?.id ?? null,
    derived_qty_total: derivedQtyTotal,
    unsent_at: unsentAt,
  });
  // Redelivery after a successful UNSEND write but before processed_at
  // must remain idempotent.
  if (unsendError && unsendError.code !== "23505") {
    throw unsendError;
  }

  return {
    status: "UNSEND",
    matched: Boolean(message),
    derived_qty_total: derivedQtyTotal,
  };
}

export async function processEvent(destination, event, admissionHint = null, options = null) {
  if (!event.webhookEventId) {
    return { skipped: "NO_WEBHOOK_EVENT_ID" };
  }


  // Q1A temporal consumer boundary.
  //
  // Healthy publisher path already resolved Round ownership and
  // carries a signed QStash admission hint, avoiding a second DB read.
  //
  // Fail-open publisher path has no hint, so consumer resolves the
  // event-time Round here BEFORE claim_webhook_event.
  if (
    event?.source?.type
    !== "group"
  ) {
    return {
      skipped: "NOT_GROUP",
    };
  }

  const ingressMessage =
    isLineOrderIngressMessage(
      event,
    );

  const ingressUnsend =
    isLineUnsendIngressEvent(
      event,
    );

  if (
    !ingressMessage
    && !ingressUnsend
  ) {
    return {
      skipped:
        "UNSUPPORTED_EVENT",
    };
  }

  let temporalAdmission =
    null;

  if (ingressMessage) {
    temporalAdmission =
      validTemporalAdmissionHint(
        admissionHint,
        event,
      );

    if (!temporalAdmission) {
      temporalAdmission =
        await readLineWebhookIngressAdmission(
          event.source.groupId,
          event.timestamp,
          event.webhookEventId,
        );
    }

    if (
      !temporalAdmission?.admitted
      || !temporalAdmission?.round_id
    ) {
      return {
        skipped:
          "INGRESS_NOT_OPEN_AT_EVENT_TIME",
        reason:
          temporalAdmission?.reason
          ?? "NO_ROUND_AT_EVENT_TIME",
      };
    }
  }

  const admissionRoundId =
    temporalAdmission?.round_id
    ?? null;

  const claim = await claimWebhookEvent(destination, event);

  if (claim?.state === "DENIED") {
    return {
      skipped:
        "MIRROR_DESTINATION_INGESTION_DENIED",
    };
  }

  if (claim?.state === "DONE") {
    return { skipped: "DUPLICATE_EVENT" };
  }

  if (claim?.state === "IN_FLIGHT") {
    return { skipped: "EVENT_IN_FLIGHT" };
  }

  if (claim?.state !== "CLAIMED") {
    throw new Error(`INVALID_WEBHOOK_CLAIM_STATE: ${claim?.state ?? "NULL"}`);
  }

  try {
    if (event.source?.type !== "group") {
      await markWebhookProcessed(event.webhookEventId);
      return { skipped: "NOT_GROUP" };
    }

    const existingMessage =
      event.type === "message"
        ? await findMessageByWebhookEvent(event.webhookEventId)
        : null;

    // A prior invocation may have completed the business write but failed only
    // while setting webhook_events.processed_at. Do not apply the order twice.
    if (
      existingMessage &&
      await isExistingMessageComplete(existingMessage)
    ) {
      await markWebhookProcessed(event.webhookEventId);

      return {
        status: existingMessage.parse_status,
        resumed: true,
        skipped: "MESSAGE_ALREADY_COMPLETE",
      };
    }

    const session = await resolveOpenSettlementSession();

    const group = await resolveSettlementLineGroup(
      existingMessage?.settlement_session_id ?? session?.id,
      event.source.groupId,
    );

    let result;

    if (event.type === "message" && event.message?.type === "text") {
      result = await handleTextMessage(
        destination,
        event,
        group,
        session,
        existingMessage,
        admissionRoundId,
      );
    } else if (
      event.type === "message" &&
      event.message?.type === "image"
    ) {
      result = await handleImageMessage(
        destination,
        event,
        group,
        session,
        existingMessage,
        admissionRoundId,
        Number(claim?.attempt_count ?? 1),
        options?.mediaQueueUrl ?? null,
        false,
      );
    } else if (event.type === "unsend") {
      result = await handleUnsend(destination, event);
    } else {
      result = { skipped: "UNSUPPORTED_EVENT" };
    }

    await markWebhookProcessed(event.webhookEventId);
    return result;
  } catch (error) {
    await markWebhookFailed(event.webhookEventId, error);

    console.error(
      "LINE event processing failed",
      event.webhookEventId,
      error,
    );

    throw error;
  }
}

export default async (req) => {
  if (req.method === "GET") {
    return json({
      ok: true,
      service: "line-order-webhook",
      mode: "ASYNC_GATEWAY",
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return json(
      {
        ok: false,
        error: "INVALID_LINE_SIGNATURE",
      },
      401,
    );
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(
      {
        ok: false,
        error: "INVALID_JSON",
      },
      400,
    );
  }

  const events =
    Array.isArray(payload.events)
      ? payload.events
      : [];

  const qstashAdmissionHints =
    new Map();

  // Q1A public ingress pre-filter.
  //
  // Confirmed CLOSED / NOT_STARTED TEXT and IMAGE traffic
  // does not enter QStash.
  //
  // A DB timeout/error fails open into QStash so LINE events
  // are not lost during a Supabase incident.
  if (
    isQStashIngressEnabledForAdmission()
  ) {
    const originalEventCount =
      events.length;

    const admittedEvents =
      await selectQStashIngressEvents(
        events,
        qstashAdmissionHints,
      );

    if (!admittedEvents.length) {
      return json({
        ok: true,
        queued: false,
        received:
          originalEventCount,
        admitted: 0,
        skipped:
          "NO_ADMITTED_EVENTS",
      });
    }

    events.splice(
      0,
      events.length,
      ...admittedEvents,
    );
  }


  const qstashEnabled =
    [
      "1",
      "true",
      "yes",
      "on",
    ].includes(
      String(
        process.env
          .LINE_WEBHOOK_QSTASH_ENABLED
        ?? "",
      )
        .trim()
        .toLowerCase(),
    );

  if (qstashEnabled) {
    const qstashToken =
      String(
        process.env.QSTASH_TOKEN
        ?? "",
      ).trim();

    if (!qstashToken) {
      console.error(
        "QStash ingress enabled but token missing",
      );

      return json(
        {
          ok: false,
          error: "QSTASH_NOT_CONFIGURED",
        },
        503,
      );
    }

    const consumerUrl =
      new URL(
        "/api/line-webhook-qstash",
        req.url,
      ).toString();

    /*
     * Events without webhookEventId are already
     * ignored by processEvent(), so preserve that
     * behavior rather than failing the webhook.
     */
    const queueableEvents =
      events.filter(
        (event) =>
          Boolean(
            event?.webhookEventId,
          ),
      );

    try {
      const {
        Client,
      } = await import(
        "@upstash/qstash"
      );

      const qstash =
        new Client({
          token: qstashToken,
          enableTelemetry: false,

          // Retry only the publish-to-QStash
          // request itself.
          retry: {
            retries: 2,
            backoff:
              (retryCount) =>
                Math.min(
                  1000,
                  50
                  * (2 ** retryCount),
                ),
          },
        });

      await Promise.all(
        queueableEvents.map(
          (event) =>
            qstash.publishJSON({
              url: consumerUrl,

              body: {
                destination:
                  payload.destination,
                event,
                admission:
                  qstashAdmissionHints.get(
                    event.webhookEventId,
                  )
                  ?? null,
              },

              /*
               * LINE redelivery uses the same
               * webhookEventId. QStash dedupe
               * absorbs short-window duplicate
               * publishes; claim_webhook_event
               * remains authoritative idempotency.
               */
              deduplicationId:
                `line-webhook-${
                  event.webhookEventId
                }`,

              /*
               * Global ingress backpressure:
               * max 2 active consumers and
               * max 5 dispatches/second.
               */
              flowControl: {
                key:
                  "line-webhook-ingress-v1",
                parallelism: 2,
                rate: 5,
                period: "1s",
              },

              /*
               * Avoid the old fast retry storm.
               * Retry delivery after 1m, 2m,
               * 3m... if Supabase is unhealthy.
               */
              retries: 5,
              retryDelay:
                "60000 * (1 + retried)",

              label:
                "line-webhook-ingress-v1",
            }),
        ),
      );
    } catch (error) {
      console.error(
        "Failed to publish LINE events to QStash",
        error,
      );

      /*
       * Return non-2xx to LINE only when
       * QStash did not durably accept the work.
       * LINE may then redeliver.
       */
      return json(
        {
          ok: false,
          error:
            "QSTASH_PUBLISH_FAILED",
        },
        503,
      );
    }

    return json({
      ok: true,
      queued: true,
      received: events.length,
    });
  }

  const workerUrl = new URL(
    "/.netlify/functions/line-webhook-background",
    req.url,
  );

  let workerResponse;

  try {
    workerResponse = await fetch(
      workerUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-signature": signature,
        },
        body: rawBody,
      },
    );
  } catch (error) {
    console.error(
      "Failed to invoke LINE webhook background worker",
      error,
    );

    return json(
      {
        ok: false,
        error: "BACKGROUND_INVOKE_FAILED",
      },
      503,
    );
  }

  if (workerResponse.status !== 202) {
    const detail =
      await workerResponse
        .text()
        .catch(() => "");

    console.error(
      "Unexpected background worker response",
      workerResponse.status,
      detail.slice(0, 500),
    );

    return json(
      {
        ok: false,
        error: "BACKGROUND_NOT_ACCEPTED",
        status: workerResponse.status,
      },
      502,
    );
  }

  // LINE receives 200 immediately after Netlify has accepted the
  // asynchronous background invocation. The background worker owns
  // claim/process/retry/persistence from this point onward.
  return json({
    ok: true,
    queued: true,
    received: events.length,
  });
};

export const config = {
  path: "/api/line-webhook",
};
