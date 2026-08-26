import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseOrder } from "../../src/lib/order-parser.mjs";
import { firstLedgerCode } from "../../src/lib/report-ledger.mjs";
import { downloadLineImage, transcribeOrderImage } from "../../src/lib/image-ocr.mjs";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";

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

function verifyLineSignature(rawBody, signature) {
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
    .select("line_group_id,line_group_name,summary_group_id,reduction_pct")
    .eq("settlement_session_id", sessionId)
    .eq("line_group_id", lineGroupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function reserveWebhookEvent(destination, event) {
  const row = {
    webhook_event_id: event.webhookEventId,
    destination,
    event_type: event.type,
    line_group_id: event.source?.groupId ?? null,
    user_id: event.source?.userId ?? null,
    is_redelivery: Boolean(event.deliveryContext?.isRedelivery),
    payload: event,
  };

  const { error } = await supabase.from("webhook_events").insert(row);
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

async function markWebhookProcessed(webhookEventId) {
  const { error } = await supabase
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("webhook_event_id", webhookEventId);
  if (error) throw error;
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

  // order_items is canonical accounting data.
  // Tentative PARTIAL parser output stays in Review and must not affect totals,
  // risk, allocation, accounting reports or settlement snapshots.
  if (result.status === "PARSED" && result.items.length) {
    const rows = result.items.map((item) => ({
      message_record_id: message.id,
      business_date: message.business_date,
      line_group_id: message.line_group_id,
      // The database trigger snapshots the Summary Group for the OPEN settlement.
      // Use that returned value as the source of truth so Order Board/Risk views and
      // the accounting report cannot diverge if live group settings change mid-session.
      summary_group_id: message.summary_group_id ?? group.summary_group_id,
      category: item.category,
      code: item.code,
      quantity: item.quantity,
      unsent_flag: false,
      parser_version: result.parser_version,
      settlement_session_id: message.settlement_session_id,
    }));

    const { error: itemError } = await supabase.from("order_items").insert(rows);
    if (itemError) throw itemError;
  }

  if (["REVIEW", "PARTIAL"].includes(result.status)) {
    await saveReview(message.id, result.errors, result.warnings);
  }

  return {
    status: result.status,
    items: result.items.length,
    parser_version: result.parser_version,
  };
}

async function handleTextMessage(destination, event, group, session) {
  const text = event.message.text ?? "";
  const message = await createMessage({ destination, event, group, session, messageType: "text", rawText: text });

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

  const config = await loadParserConfig();
  const result = parseOrder(text, config);
  return persistParsedResult(message, effectiveGroup, result, { first_order_code: firstLedgerCode(result.items, text) || null });
}

async function handleImageMessage(destination, event, group, session) {
  const message = await createMessage({
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

  try {
    const image = await downloadLineImage(event.message.id, LINE_CHANNEL_ACCESS_TOKEN);
    const ocr = await transcribeOrderImage({
      bytes: image.bytes,
      mimeType: image.mimeType,
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    });

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
        [{ code: "OCR_UNCERTAIN", detail: "OCR output contains one or more uncertain characters marked with ?" }],
        [],
      );
      return { status: "REVIEW", reason: "OCR_UNCERTAIN" };
    }

    const config = await loadParserConfig();
    const result = parseOrder(ocr.text, config);
    return persistParsedResult(message, effectiveGroup, result, {
      ...baseUpdate,
      first_order_code: firstLedgerCode(result.items, ocr.text) || null,
    });
  } catch (error) {
    const detail = error?.message ?? String(error);
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
      [{ code: "IMAGE_OCR_FAILED", detail: detail.slice(0, 500) }],
      [],
    );
    return { status: "REVIEW", reason: "IMAGE_OCR_FAILED" };
  }
}

async function handleUnsend(destination, event) {
  const originalMessageId = event.unsend?.messageId;
  const unsentAt = new Date(event.timestamp).toISOString();

  const { data: message, error: findError } = await supabase
    .from("messages")
    .select("id,line_group_id")
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

    const { error: messageUpdateError } = await supabase
      .from("messages")
      .update({
        unsent: true,
        unsent_at: unsentAt,
        raw_text: null,
        normalized_text: null,
        ocr_text: null,
        ocr_error: null,
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
  if (unsendError) throw unsendError;

  return { status: "UNSEND", matched: Boolean(message), derived_qty_total: derivedQtyTotal };
}

async function processEvent(destination, event) {
  if (!event.webhookEventId) return { skipped: "NO_WEBHOOK_EVENT_ID" };

  const reserved = await reserveWebhookEvent(destination, event);
  if (!reserved) return { skipped: "DUPLICATE_EVENT" };

  try {
    if (event.source?.type !== "group") {
      await markWebhookProcessed(event.webhookEventId);
      return { skipped: "NOT_GROUP" };
    }

    const session = await resolveOpenSettlementSession();
    const group = await resolveSettlementLineGroup(session?.id, event.source.groupId);
    let result;

    if (event.type === "message" && event.message?.type === "text") {
      result = await handleTextMessage(destination, event, group, session);
    } else if (event.type === "message" && event.message?.type === "image") {
      result = await handleImageMessage(destination, event, group, session);
    } else if (event.type === "unsend") {
      result = await handleUnsend(destination, event);
    } else {
      result = { skipped: "UNSUPPORTED_EVENT" };
    }

    await markWebhookProcessed(event.webhookEventId);
    return result;
  } catch (error) {
    console.error("LINE event processing failed", event.webhookEventId, error);
    throw error;
  }
}

export default async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "line-order-webhook" });
  }

  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return json({ ok: false, error: "INVALID_LINE_SIGNATURE" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const destination = payload.destination;
  const events = Array.isArray(payload.events) ? payload.events : [];
  const results = [];

  for (const event of events) {
    try {
      results.push(await processEvent(destination, event));
    } catch (error) {
      results.push({ error: "PROCESSING_FAILED", detail: error?.message ?? String(error) });
    }
  }

  return json({ ok: true, received: events.length, results });
};

export const config = {
  path: "/api/line-webhook",
};
