"use strict";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  authorizeLineMirrorImageCapability,
  LINE_MIRROR_IMAGE_BUCKET,
} from "../../src/lib/line-message-mirror-image.mjs";

function createMirrorImageClient(
  env,
) {
  const url =
    env.SUPABASE_URL;

  const secretKey =
    env.SUPABASE_SECRET_KEY;

  if (
    !url
    || !secretKey
  ) {
    throw new Error(
      "MIRROR_IMAGE_SUPABASE_ENV_MISSING",
    );
  }

  return createClient(
    url,
    secretKey,
    {
      auth: {
        autoRefreshToken:
          false,
        persistSession:
          false,
        detectSessionInUrl:
          false,
      },
    },
  );
}

function notFound() {
  return new Response(
    "Not found",
    {
      status: 404,
      headers: {
        "content-type":
          "text/plain; charset=utf-8",
        "cache-control":
          "private, no-store, max-age=0",
        "x-content-type-options":
          "nosniff",
      },
    },
  );
}

export async function handleLineMessageMirrorImage(
  req,
  {
    env = process.env,
    supabase = null,
    nowMs = Date.now(),
    logger = console,
  } = {},
) {
  if (
    req.method !== "GET"
    && req.method !== "HEAD"
  ) {
    return new Response(
      "Method not allowed",
      {
        status: 405,
        headers: {
          allow:
            "GET, HEAD",
          "content-type":
            "text/plain; charset=utf-8",
        },
      },
    );
  }

  const client =
    supabase
    ?? createMirrorImageClient(
      env,
    );

  const access =
    await authorizeLineMirrorImageCapability({
      supabase:
        client,
      requestUrl:
        req.url,
      nowMs,
    });

  if (!access.ok) {
    return notFound();
  }

  const headers = {
    "content-type":
      access.mimeType,
    "content-length":
      String(
        access.sizeBytes,
      ),
    "cache-control":
      "private, no-store, max-age=0",
    "x-content-type-options":
      "nosniff",
  };

  if (req.method === "HEAD") {
    return new Response(
      null,
      {
        status: 200,
        headers,
      },
    );
  }

  const {
    data,
    error,
  } =
    await client.storage
      .from(
        LINE_MIRROR_IMAGE_BUCKET,
      )
      .download(
        access.storagePath,
      );

  if (
    error
    || !data
  ) {
    logger?.error?.(
      "LINE mirror image Storage download failed",
      {
        asset_id:
          access.assetId,
        kind:
          access.kind,
        error:
          error?.message
          ?? "STORAGE_OBJECT_MISSING",
      },
    );

    return notFound();
  }

  if (
    Number(
      data.size,
    )
    !== access.sizeBytes
  ) {
    logger?.error?.(
      "LINE mirror image Storage size mismatch",
      {
        asset_id:
          access.assetId,
        kind:
          access.kind,
        expected:
          access.sizeBytes,
        actual:
          Number(
            data.size,
          ),
      },
    );

    return new Response(
      "Upstream image mismatch",
      {
        status: 502,
        headers: {
          "content-type":
            "text/plain; charset=utf-8",
          "cache-control":
            "private, no-store, max-age=0",
        },
      },
    );
  }

  if (
    typeof data.stream
      !== "function"
  ) {
    throw new Error(
      "MIRROR_IMAGE_STORAGE_BLOB_NOT_STREAMABLE",
    );
  }

  return new Response(
    data.stream(),
    {
      status: 200,
      headers,
    },
  );
}

export default async (
  req,
) =>
  handleLineMessageMirrorImage(
    req,
  );

export const config = {
  path:
    "/api/line-message-mirror-image",
  region:
    "sin",
};
