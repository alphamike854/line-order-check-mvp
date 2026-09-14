"use strict";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const LINE_MIRROR_IMAGE_BUCKET =
  "mirror-images";

export const LINE_MIRROR_IMAGE_ORIGINAL_MAX_BYTES =
  10 * 1024 * 1024;

export const LINE_MIRROR_IMAGE_PREVIEW_MAX_BYTES =
  1 * 1024 * 1024;

export const LINE_MIRROR_IMAGE_CAPABILITY_TTL_MS =
  27 * 60 * 60 * 1000;

const LINE_IMAGE_MIME_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
  ]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/;

function normalizeMimeType(
  value,
) {
  return String(
    value ?? "",
  )
    .split(";")[0]
    .trim()
    .toLowerCase();
}

export function sha256MirrorValue(
  value,
) {
  return createHash(
    "sha256",
  )
    .update(value)
    .digest("hex");
}

export function safeMirrorSha256Equal(
  left,
  right,
) {
  const a =
    String(
      left ?? "",
    )
      .trim()
      .toLowerCase();

  const b =
    String(
      right ?? "",
    )
      .trim()
      .toLowerCase();

  if (
    !SHA256_PATTERN.test(a)
    || !SHA256_PATTERN.test(b)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(
      a,
      "hex",
    ),
    Buffer.from(
      b,
      "hex",
    ),
  );
}

function validateImageMime(
  mimeType,
) {
  const normalized =
    normalizeMimeType(
      mimeType,
    );

  if (
    !LINE_IMAGE_MIME_TYPES.has(
      normalized,
    )
  ) {
    throw new Error(
      `MIRROR_IMAGE_UNSUPPORTED_MIME:${normalized || "EMPTY"}`,
    );
  }

  return normalized;
}

function imageVariantLimit(
  variant,
) {
  if (variant === "original") {
    return LINE_MIRROR_IMAGE_ORIGINAL_MAX_BYTES;
  }

  if (variant === "preview") {
    return LINE_MIRROR_IMAGE_PREVIEW_MAX_BYTES;
  }

  throw new Error(
    "MIRROR_IMAGE_VARIANT_INVALID",
  );
}

export function buildLineMirrorImageCapabilityUrl({
  baseUrl,
  assetId,
  kind,
  token,
}) {
  const origin =
    String(
      baseUrl ?? "",
    ).trim();

  const id =
    String(
      assetId ?? "",
    ).trim();

  const capability =
    String(
      token ?? "",
    ).trim();

  if (!origin) {
    throw new Error(
      "MIRROR_IMAGE_BASE_URL_REQUIRED",
    );
  }

  if (!UUID_PATTERN.test(id)) {
    throw new Error(
      "MIRROR_IMAGE_ASSET_ID_INVALID",
    );
  }

  if (
    kind !== "original"
    && kind !== "preview"
  ) {
    throw new Error(
      "MIRROR_IMAGE_KIND_INVALID",
    );
  }

  if (capability.length < 32) {
    throw new Error(
      "MIRROR_IMAGE_CAPABILITY_TOKEN_INVALID",
    );
  }

  const url =
    new URL(
      "/api/line-message-mirror-image",
      origin,
    );

  if (url.protocol !== "https:") {
    throw new Error(
      "MIRROR_IMAGE_CAPABILITY_URL_NOT_HTTPS",
    );
  }

  url.searchParams.set(
    "asset",
    id,
  );

  url.searchParams.set(
    "kind",
    kind,
  );

  url.searchParams.set(
    "token",
    capability,
  );

  const result =
    url.toString();

  if (result.length > 2000) {
    throw new Error(
      "MIRROR_IMAGE_CAPABILITY_URL_TOO_LONG",
    );
  }

  return result;
}

export async function downloadLineMirrorImageVariant({
  messageId,
  channelAccessToken,
  variant,
  fetchImpl = fetch,
}) {
  const id =
    String(
      messageId ?? "",
    ).trim();

  const token =
    String(
      channelAccessToken ?? "",
    );

  if (!id) {
    throw new Error(
      "MIRROR_IMAGE_MESSAGE_ID_REQUIRED",
    );
  }

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN_MISSING",
    );
  }

  const limit =
    imageVariantLimit(
      variant,
    );

  const suffix =
    variant === "preview"
      ? "/preview"
      : "";

  const response =
    await fetchImpl(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(id)}/content${suffix}`,
      {
        method: "GET",
        headers: {
          authorization:
            `Bearer ${token}`,
        },
      },
    );

  if (!response.ok) {
    const detail =
      await response
        .text()
        .catch(
          () => "",
        );

    throw new Error(
      `MIRROR_IMAGE_${variant.toUpperCase()}_DOWNLOAD_FAILED_${response.status}${
        detail
          ? `:${detail.slice(0, 200)}`
          : ""
      }`,
    );
  }

  const mimeType =
    validateImageMime(
      response.headers.get(
        "content-type",
      ),
    );

  const declaredLength =
    Number(
      response.headers.get(
        "content-length",
      )
      ?? 0,
    );

  if (
    Number.isFinite(
      declaredLength,
    )
    && declaredLength > limit
  ) {
    throw new Error(
      `MIRROR_IMAGE_${variant.toUpperCase()}_TOO_LARGE:${declaredLength}`,
    );
  }

  const bytes =
    Buffer.from(
      await response.arrayBuffer(),
    );

  if (!bytes.length) {
    throw new Error(
      `MIRROR_IMAGE_${variant.toUpperCase()}_EMPTY`,
    );
  }

  if (bytes.length > limit) {
    throw new Error(
      `MIRROR_IMAGE_${variant.toUpperCase()}_TOO_LARGE:${bytes.length}`,
    );
  }

  return {
    bytes,
    mimeType,
    sizeBytes:
      bytes.length,
    sha256:
      sha256MirrorValue(
        bytes,
      ),
  };
}

async function mirrorImageRpc(
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
      `${name}:${error.message ?? String(error)}`,
    );
  }

  return data;
}

function readyAssetMetadata(
  asset,
) {
  if (
    asset?.status !== "READY"
  ) {
    return null;
  }

  const originalMimeType =
    validateImageMime(
      asset.original_mime_type,
    );

  const previewMimeType =
    validateImageMime(
      asset.preview_mime_type,
    );

  const originalSizeBytes =
    Number(
      asset.original_size_bytes,
    );

  const previewSizeBytes =
    Number(
      asset.preview_size_bytes,
    );

  const originalSha256 =
    String(
      asset.original_sha256 ?? "",
    )
      .trim()
      .toLowerCase();

  const previewSha256 =
    String(
      asset.preview_sha256 ?? "",
    )
      .trim()
      .toLowerCase();

  if (
    !Number.isInteger(
      originalSizeBytes,
    )
    || originalSizeBytes < 1
    || originalSizeBytes
      > LINE_MIRROR_IMAGE_ORIGINAL_MAX_BYTES
    || !Number.isInteger(
      previewSizeBytes,
    )
    || previewSizeBytes < 1
    || previewSizeBytes
      > LINE_MIRROR_IMAGE_PREVIEW_MAX_BYTES
    || !SHA256_PATTERN.test(
      originalSha256,
    )
    || !SHA256_PATTERN.test(
      previewSha256,
    )
  ) {
    throw new Error(
      "MIRROR_IMAGE_READY_METADATA_INVALID",
    );
  }

  return {
    originalMimeType,
    originalSizeBytes,
    originalSha256,
    previewMimeType,
    previewSizeBytes,
    previewSha256,
  };
}

async function uploadMirrorImageObject({
  supabase,
  path,
  bytes,
  mimeType,
}) {
  const {
    error,
  } =
    await supabase.storage
      .from(
        LINE_MIRROR_IMAGE_BUCKET,
      )
      .upload(
        path,
        bytes,
        {
          contentType:
            mimeType,
          upsert: true,
          cacheControl:
            "3600",
        },
      );

  if (error) {
    throw new Error(
      `MIRROR_IMAGE_STORAGE_UPLOAD_FAILED:${error.message ?? String(error)}`,
    );
  }
}

export async function cleanupLineMirrorImageItems({
  supabase,
  queueIds,
  logger = console,
}) {
  if (!supabase) {
    throw new Error(
      "MIRROR_IMAGE_SUPABASE_REQUIRED",
    );
  }

  const normalizedQueueIds =
    [
      ...new Set(
        (
          Array.isArray(queueIds)
            ? queueIds
            : []
        )
          .map(
            (value) =>
              String(
                value ?? "",
              ).trim(),
          )
          .filter(
            (value) =>
              /^[0-9]+$/.test(
                value,
              ),
          ),
      ),
    ];

  if (
    normalizedQueueIds.length
      === 0
  ) {
    return {
      ok: true,
      assetCount: 0,
      objectCount: 0,
    };
  }

  try {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "line_message_mirror_image_assets",
        )
        .select(
          [
            "id",
            "queue_id",
            "status",
            "original_storage_path",
            "preview_storage_path",
          ].join(","),
        )
        .in(
          "queue_id",
          normalizedQueueIds,
        );

    if (error) {
      throw new Error(
        `MIRROR_IMAGE_CLEANUP_LOOKUP_FAILED:${
          error.message
          ?? String(error)
        }`,
      );
    }

    const assets =
      (
        Array.isArray(data)
          ? data
          : []
      )
        .filter(
          (asset) =>
            asset
            && asset.status
              !== "DELETED",
        );

    if (
      assets.length === 0
    ) {
      return {
        ok: true,
        assetCount: 0,
        objectCount: 0,
      };
    }

    const paths =
      [
        ...new Set(
          assets
            .flatMap(
              (asset) => [
                asset.original_storage_path,
                asset.preview_storage_path,
              ],
            )
            .map(
              (value) =>
                String(
                  value ?? "",
                ).trim(),
            )
            .filter(Boolean),
        ),
      ];

    if (paths.length > 0) {
      const {
        error:
          removeError,
      } =
        await supabase.storage
          .from(
            LINE_MIRROR_IMAGE_BUCKET,
          )
          .remove(
            paths,
          );

      if (removeError) {
        throw new Error(
          `MIRROR_IMAGE_CLEANUP_STORAGE_FAILED:${
            removeError.message
            ?? String(removeError)
          }`,
        );
      }
    }

    const assetIds =
      assets
        .map(
          (asset) =>
            String(
              asset.id ?? "",
            ).trim(),
        )
        .filter(Boolean);

    if (assetIds.length > 0) {
      const {
        error:
          updateError,
      } =
        await supabase
          .from(
            "line_message_mirror_image_assets",
          )
          .update({
            status:
              "DELETED",
            last_error:
              null,
            updated_at:
              new Date().toISOString(),
          })
          .in(
            "id",
            assetIds,
          );

      if (updateError) {
        throw new Error(
          `MIRROR_IMAGE_CLEANUP_MARK_FAILED:${
            updateError.message
            ?? String(updateError)
          }`,
        );
      }
    }

    return {
      ok: true,
      assetCount:
        assets.length,
      objectCount:
        paths.length,
    };
  } catch (error) {
    logger?.error?.(
      "LINE mirror terminal image cleanup failed",
      {
        queue_ids:
          normalizedQueueIds,
        error:
          error?.message
          ?? String(error),
      },
    );

    return {
      ok: false,
      assetCount: 0,
      objectCount: 0,
      error:
        String(
          error?.message
            ?? error,
        ),
    };
  }
}

export async function prepareLineMirrorImageItem({
  supabase,
  queueId,
  leaseToken,
  sourceMessageId,
  destinationBaseUrl,
  lineChannelAccessToken,
  fetchImpl = fetch,
  randomBytesImpl = randomBytes,
  nowMs = Date.now(),
}) {
  if (!supabase) {
    throw new Error(
      "MIRROR_IMAGE_SUPABASE_REQUIRED",
    );
  }

  const ensured =
    await mirrorImageRpc(
      supabase,
      "ensure_line_message_mirror_image_asset",
      {
        p_queue_id:
          queueId,
        p_lease_token:
          leaseToken,
      },
    );

  if (
    !ensured?.ok
    || !ensured?.asset
  ) {
    throw new Error(
      `MIRROR_IMAGE_ASSET_ENSURE_REJECTED:${ensured?.reason ?? "UNKNOWN"}`,
    );
  }

  const asset =
    ensured.asset;

  const assetId =
    String(
      asset.id ?? "",
    );

  if (!UUID_PATTERN.test(assetId)) {
    throw new Error(
      "MIRROR_IMAGE_ASSET_ID_INVALID",
    );
  }

  let media =
    null;

  if (asset.status === "READY") {
    media =
      readyAssetMetadata(
        asset,
      );
  } else {
    const [
      original,
      preview,
    ] =
      await Promise.all([
        downloadLineMirrorImageVariant({
          messageId:
            sourceMessageId,
          channelAccessToken:
            lineChannelAccessToken,
          variant:
            "original",
          fetchImpl,
        }),
        downloadLineMirrorImageVariant({
          messageId:
            sourceMessageId,
          channelAccessToken:
            lineChannelAccessToken,
          variant:
            "preview",
          fetchImpl,
        }),
      ]);

    await uploadMirrorImageObject({
      supabase,
      path:
        asset.original_storage_path,
      bytes:
        original.bytes,
      mimeType:
        original.mimeType,
    });

    await uploadMirrorImageObject({
      supabase,
      path:
        asset.preview_storage_path,
      bytes:
        preview.bytes,
      mimeType:
        preview.mimeType,
    });

    media = {
      originalMimeType:
        original.mimeType,
      originalSizeBytes:
        original.sizeBytes,
      originalSha256:
        original.sha256,
      previewMimeType:
        preview.mimeType,
      previewSizeBytes:
        preview.sizeBytes,
      previewSha256:
        preview.sha256,
    };
  }

  const tokenBytes =
    randomBytesImpl(
      32,
    );

  if (
    !tokenBytes
    || tokenBytes.length < 24
  ) {
    throw new Error(
      "MIRROR_IMAGE_CAPABILITY_RANDOM_INVALID",
    );
  }

  const capabilityToken =
    Buffer.from(
      tokenBytes,
    ).toString(
      "base64url",
    );

  const tokenSha256 =
    sha256MirrorValue(
      capabilityToken,
    );

  const serveExpiresAt =
    new Date(
      Number(nowMs)
        + LINE_MIRROR_IMAGE_CAPABILITY_TTL_MS,
    ).toISOString();

  const ready =
    await mirrorImageRpc(
      supabase,
      "mark_line_message_mirror_image_asset_ready",
      {
        p_asset_id:
          assetId,
        p_lease_token:
          leaseToken,
        p_original_mime_type:
          media.originalMimeType,
        p_original_size_bytes:
          media.originalSizeBytes,
        p_original_sha256:
          media.originalSha256,
        p_preview_mime_type:
          media.previewMimeType,
        p_preview_size_bytes:
          media.previewSizeBytes,
        p_preview_sha256:
          media.previewSha256,
        p_serve_token_sha256:
          tokenSha256,
        p_serve_expires_at:
          serveExpiresAt,
      },
    );

  if (ready !== true) {
    throw new Error(
      "MIRROR_IMAGE_READY_TRANSITION_REJECTED",
    );
  }

  const originalContentUrl =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        destinationBaseUrl,
      assetId,
      kind:
        "original",
      token:
        capabilityToken,
    });

  const previewImageUrl =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        destinationBaseUrl,
      assetId,
      kind:
        "preview",
      token:
        capabilityToken,
    });

  return {
    assetId,
    originalContentUrl,
    previewImageUrl,
    message: {
      type:
        "image",
      originalContentUrl,
      previewImageUrl,
    },
  };
}

export async function authorizeLineMirrorImageCapability({
  supabase,
  requestUrl,
  nowMs = Date.now(),
}) {
  if (!supabase) {
    throw new Error(
      "MIRROR_IMAGE_SUPABASE_REQUIRED",
    );
  }

  let url;

  try {
    url =
      new URL(
        requestUrl,
      );
  } catch {
    return {
      ok: false,
    };
  }

  const assetId =
    String(
      url.searchParams.get(
        "asset",
      )
      ?? "",
    ).trim();

  const kind =
    String(
      url.searchParams.get(
        "kind",
      )
      ?? "",
    ).trim();

  const token =
    String(
      url.searchParams.get(
        "token",
      )
      ?? "",
    ).trim();

  if (
    !UUID_PATTERN.test(
      assetId,
    )
    || (
      kind !== "original"
      && kind !== "preview"
    )
    || token.length < 32
  ) {
    return {
      ok: false,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "line_message_mirror_image_assets",
      )
      .select(
        [
          "id",
          "status",
          "original_storage_path",
          "preview_storage_path",
          "original_mime_type",
          "preview_mime_type",
          "original_size_bytes",
          "preview_size_bytes",
          "serve_token_sha256",
          "serve_expires_at",
        ].join(","),
      )
      .eq(
        "id",
        assetId,
      )
      .maybeSingle();

  if (
    error
    || !data
    || data.status !== "READY"
  ) {
    return {
      ok: false,
    };
  }

  const expiry =
    Date.parse(
      data.serve_expires_at
        ?? "",
    );

  if (
    !Number.isFinite(
      expiry,
    )
    || expiry <= Number(nowMs)
  ) {
    return {
      ok: false,
    };
  }

  const suppliedHash =
    sha256MirrorValue(
      token,
    );

  if (
    !safeMirrorSha256Equal(
      suppliedHash,
      data.serve_token_sha256,
    )
  ) {
    return {
      ok: false,
    };
  }

  const storagePath =
    kind === "original"
      ? data.original_storage_path
      : data.preview_storage_path;

  const mimeType =
    validateImageMime(
      kind === "original"
        ? data.original_mime_type
        : data.preview_mime_type,
    );

  const sizeBytes =
    Number(
      kind === "original"
        ? data.original_size_bytes
        : data.preview_size_bytes,
    );

  const limit =
    imageVariantLimit(
      kind,
    );

  if (
    !storagePath
    || !Number.isInteger(
      sizeBytes,
    )
    || sizeBytes < 1
    || sizeBytes > limit
  ) {
    return {
      ok: false,
    };
  }

  return {
    ok: true,
    assetId,
    kind,
    storagePath,
    mimeType,
    sizeBytes,
    expiresAt:
      data.serve_expires_at,
  };
}
