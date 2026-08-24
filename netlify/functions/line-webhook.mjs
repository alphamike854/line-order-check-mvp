import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseOrder } from "../../src/lib/order-parser.mjs";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.warn("Missing one or more required environment variables");
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
  if (error.code === "23505") return false; // already processed / reserved
  throw error;
}

async function markWebhookProcessed(webhookEventId) {
  const { error } = await supabase
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("webhook_event_id", webhookEventId);
  if (error) throw error;
}

async function createMessage({ destination, event, group, messageType, rawText = null, parseStatus = "PENDING" }) {
  const timestamp = new Date(event.timestamp).toISOString();
  const row = {
    destination,
    webhook_event_id: event.webhookEventId,
    message_id: event.message?.id ?? null,
    business_date: bangkokBusinessDate(event.timestamp),
    event_timestamp: timestamp,
    line_group_id: event.source.groupId,
    summary_group_id: group?.summary_group_id ?? null,
    user_id: event.source?.userId ?? null,
    message_type: messageType,
    raw_text: rawText,
    parse_status: parseStatus,
  };

  const { data, error } = await supabase.from("messages").insert(row).select("id").single();
  if (error) throw error;
  return { id: data.id, ...row };
}

async function handleTextMessage(destination, event, group) {
  const text = event.message.text ?? "";
  const message = await createMessage({ destination, event, group, messageType: "text", rawText: text });

  if (!group) {
    await supabase.from("messages").update({ parse_status: "REVIEW" }).eq("id", message.id);
    await supabase.from("review_items").insert({
      message_record_id: message.id,
      reason_codes: [{ code: "GROUP_NOT_CONFIGURED", detail: event.source.groupId }],
      warnings: [],
    });
    return { status: "REVIEW", reason: "GROUP_NOT_CONFIGURED" };
  }

  const config = await loadParserConfig();
  const result = parseOrder(text, config);

  const { error: updateError } = await supabase
    .from("messages")
    .update({
      normalized_text: result.normalized_text,
      parse_status: result.status,
      parser_version: result.parser_version,
    })
    .eq("id", message.id);
  if (updateError) throw updateError;

  if (result.items.length) {
    const rows = result.items.map((item) => ({
      message_record_id: message.id,
      business_date: message.business_date,
      line_group_id: message.line_group_id,
      summary_group_id: group.summary_group_id,
      category: item.category,
      code: item.code,
      quantity: item.quantity,
      unsent_flag: false,
      parser_version: result.parser_version,
    }));

    const { error: itemError } = await supabase.from("order_items").insert(rows);
    if (itemError) throw itemError;
  }

  if (["REVIEW", "PARTIAL"].includes(result.status)) {
    const { error: reviewError } = await supabase.from("review_items").insert({
      message_record_id: message.id,
      reason_codes: result.errors,
      warnings: result.warnings,
    });
    if (reviewError) throw reviewError;
  }

  return {
    status: result.status,
    items: result.items.length,
    parser_version: result.parser_version,
  };
}

async function handleImageMessage(destination, event, group) {
  const message = await createMessage({
    destination,
    event,
    group,
    messageType: "image",
    parseStatus: "REVIEW",
  });

  await supabase.from("review_items").insert({
    message_record_id: message.id,
    reason_codes: [{ code: "IMAGE_OCR_NOT_IMPLEMENTED", detail: "Phase 2" }],
    warnings: [],
  });

  return { status: "REVIEW", reason: "IMAGE_OCR_NOT_IMPLEMENTED" };
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
      .update({ unsent: true, unsent_at: unsentAt, raw_text: null, normalized_text: null })
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

    const group = await resolveLineGroup(event.source.groupId);
    let result;

    if (event.type === "message" && event.message?.type === "text") {
      result = await handleTextMessage(destination, event, group);
    } else if (event.type === "message" && event.message?.type === "image") {
      result = await handleImageMessage(destination, event, group);
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
