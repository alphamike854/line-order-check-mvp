import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseOrder } from "../../src/lib/order-parser.mjs";
import { firstLedgerCode } from "../../src/lib/report-ledger.mjs";
import {
  downloadLineImage,
  isRetryableGeminiOcrError,
  transcribeOrderImage,
} from "../../src/lib/image-ocr.mjs";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
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

async function findMessageByWebhookEvent(webhookEventId) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id,destination,webhook_event_id,message_id,business_date,settlement_session_id,event_timestamp,line_group_id,summary_group_id,user_id,message_type,raw_text,normalized_text,parse_status,parser_version,unsent"
    )
    .eq("webhook_event_id", webhookEventId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function isExistingMessageComplete(message) {
  if (!message) return false;

  if (message.parse_status === "IGNORE") {
    return true;
  }

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

  if (["REVIEW", "PARTIAL"].includes(message.parse_status)) {
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

async function createMessage({ destination, event, group, session, messageType, rawText = null, parseStatus = "PENDING" }) {
  const timestamp = new Date(event.timestamp).toISOString();
  const row = {
    destination,
    webhook_event_id: event.webhookEventId,
    message_id: event.message?.id ?? null,
    business_date: session?.business_date ?? bangkokBusinessDate(event.timestamp),
    settlement_session_id: session?.id ?? null,
    event_timestamp: timestamp,
    line_group_id: event.source.groupId,
    summary_group_id: group?.summary_group_id ?? null,
    user_id: event.source?.userId ?? null,
    message_type: messageType,
    raw_text: rawText,
    parse_status: parseStatus,
  };

  const { data, error } = await supabase.from("messages").insert(row).select("id,settlement_session_id,business_date,summary_group_id").single();
  if (error) throw error;
  // A DB trigger owns the OPEN/CLOSE boundary atomically. Returned values may
  // therefore differ from the session snapshot read a few milliseconds earlier.
  return { ...row, ...data };
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
      "persist_parsed_message_atomic",
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

  if (["REVIEW", "PARTIAL"].includes(result.status)) {
    await saveReview(
      message.id,
      result.errors ?? [],
      result.warnings ?? [],
    );
  }

  return {
    status: result.status,
    items: 0,
    parser_version: result.parser_version,
  };
}

async function handleTextMessage(destination, event, group, session, existingMessage = null) {
  const text = event.message.text ?? "";
  const message = existingMessage ?? await createMessage({
    destination,
    event,
    group,
    session,
    messageType: "text",
    rawText: text,
  });

  if (!message.settlement_session_id) {
    await supabase.from("messages").update({ parse_status: "REVIEW" }).eq("id", message.id);
    await saveReview(message.id, [{ code: "SETTLEMENT_NOT_OPEN", detail: "ยังไม่ได้เปิดยอด" }], []);
    return { status: "REVIEW", reason: "SETTLEMENT_NOT_OPEN" };
  }

  const effectiveGroup = message.settlement_session_id === session?.id
    ? group
    : await resolveSettlementLineGroup(message.settlement_session_id, message.line_group_id);

  if (!effectiveGroup) {
    await supabase.from("messages").update({ parse_status: "REVIEW" }).eq("id", message.id);
    await saveReview(
      message.id,
      [{ code: "GROUP_NOT_CONFIGURED", detail: event.source.groupId }],
      [],
    );
    return { status: "REVIEW", reason: "GROUP_NOT_CONFIGURED" };
  }

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

  const config = await loadParserConfig();
  const result = parseOrder(text, config);
  return persistParsedResult(message, effectiveGroup, result, { first_order_code: firstLedgerCode(result.items, text) || null });
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

async function handleImageMessage(
  destination,
  event,
  group,
  session,
  existingMessage = null,
  processingAttempt = 1,
) {
  const message = existingMessage ?? await createMessage({
    destination,
    event,
    group,
    session,
    messageType: "image",
    parseStatus: "PENDING",
  });

  if (!message.settlement_session_id) {
    await supabase.from("messages").update({ parse_status: "REVIEW" }).eq("id", message.id);
    await saveReview(message.id, [{ code: "SETTLEMENT_NOT_OPEN", detail: "ยังไม่ได้เปิดยอด" }], []);
    return { status: "REVIEW", reason: "SETTLEMENT_NOT_OPEN" };
  }

  const effectiveGroup = message.settlement_session_id === session?.id
    ? group
    : await resolveSettlementLineGroup(message.settlement_session_id, message.line_group_id);

  if (!effectiveGroup) {
    await supabase.from("messages").update({ parse_status: "REVIEW" }).eq("id", message.id);
    await saveReview(
      message.id,
      [{ code: "GROUP_NOT_CONFIGURED", detail: event.source.groupId }],
      [],
    );
    return { status: "REVIEW", reason: "GROUP_NOT_CONFIGURED" };
  }

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

  let image;
  let ocr;

  // Only LINE image download / Gemini transcription errors belong to
  // IMAGE_OCR_FAILED. Parser or database persistence failures must escape
  // to processEvent so the webhook claim is released and LINE receives 500.
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

  const baseUpdate = {
    ocr_text: ocr.text,
    ocr_provider: ocr.provider,
    ocr_model: ocr.model,
    ocr_status: ocr.uncertain ? "UNCERTAIN" : "DONE",
    ocr_error: null,
    image_content_type: image.mimeType,
    image_size_bytes: image.sizeBytes,
  };

  if (ocr.uncertain) {
    await storeImageReviewEvidence(
      message,
      image,
    );

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

  const parserNeedsHumanReview =
    ["REVIEW", "PARTIAL"].includes(result.status)
    || (
      result.status === "PARSED"
      && !(result.items ?? []).length
    );

  if (parserNeedsHumanReview) {
    await storeImageReviewEvidence(
      message,
      image,
    );
  }

  // Intentionally outside the OCR try/catch:
  // persistence failures must propagate to processEvent -> markWebhookFailed
  // -> HTTP 500 -> safe redelivery/resume.
  return persistParsedResult(
    message,
    effectiveGroup,
    result,
    {
      ...baseUpdate,
      first_order_code:
        firstLedgerCode(result.items, ocr.text) || null,
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

export async function processEvent(destination, event) {
  if (!event.webhookEventId) {
    return { skipped: "NO_WEBHOOK_EVENT_ID" };
  }

  const claim = await claimWebhookEvent(destination, event);

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
        Number(claim?.attempt_count ?? 1),
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
