"use strict";

import fs from "node:fs";
import assert from "node:assert/strict";

import {
  authorizeLineMirrorImageCapability,
  buildLineMirrorImageCapabilityUrl,
  cleanupLineMirrorImageItems,
  downloadLineMirrorImageVariant,
  LINE_MIRROR_IMAGE_BUCKET,
  prepareLineMirrorImageItem,
  safeMirrorSha256Equal,
  sha256MirrorValue,
} from "./src/lib/line-message-mirror-image.mjs";

import {
  handleLineMessageMirrorImage,
} from "./netlify/functions/line-message-mirror-image.mjs";

const ASSET_ID =
  "123e4567-e89b-42d3-a456-426614174000";

const QUEUE_ID =
  101;

const LEASE_TOKEN =
  "223e4567-e89b-42d3-a456-426614174000";

const SOURCE_MESSAGE_ID =
  "LINE_IMAGE_MESSAGE_001";

const FIXED_RANDOM =
  Buffer.alloc(
    32,
    7,
  );

const CAPABILITY_TOKEN =
  FIXED_RANDOM.toString(
    "base64url",
  );

const TOKEN_SHA =
  sha256MirrorValue(
    CAPABILITY_TOKEN,
  );

const ORIGINAL_BYTES =
  Buffer.from(
    "original-image-bytes",
  );

const PREVIEW_BYTES =
  Buffer.from(
    "preview-image",
  );

function pass(
  label,
) {
  console.log(
    `PASS ${label}`,
  );
}

function makeHeaders(
  values,
) {
  return new Headers(
    values,
  );
}

function makePendingPreparationSupabase() {
  const rpcCalls = [];
  const uploads = [];

  const supabase = {
    async rpc(
      name,
      args,
    ) {
      rpcCalls.push({
        name,
        args,
      });

      if (
        name
        === "ensure_line_message_mirror_image_asset"
      ) {
        return {
          data: {
            ok: true,
            asset: {
              id:
                ASSET_ID,
              queue_id:
                QUEUE_ID,
              status:
                "PENDING",
              original_storage_path:
                `${ASSET_ID}/original`,
              preview_storage_path:
                `${ASSET_ID}/preview`,
            },
          },
          error: null,
        };
      }

      if (
        name
        === "mark_line_message_mirror_image_asset_ready"
      ) {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(
        `UNEXPECTED_RPC:${name}`,
      );
    },

    storage: {
      from(
        bucket,
      ) {
        assert.equal(
          bucket,
          LINE_MIRROR_IMAGE_BUCKET,
        );

        return {
          async upload(
            path,
            bytes,
            options,
          ) {
            uploads.push({
              path,
              bytes:
                Buffer.from(
                  bytes,
                ),
              options,
            });

            return {
              data: {
                path,
              },
              error: null,
            };
          },
        };
      },
    },
  };

  return {
    supabase,
    rpcCalls,
    uploads,
  };
}

function makeReadyPreparationSupabase() {
  const rpcCalls = [];
  let uploadCalled =
    false;

  const originalSha =
    sha256MirrorValue(
      ORIGINAL_BYTES,
    );

  const previewSha =
    sha256MirrorValue(
      PREVIEW_BYTES,
    );

  const supabase = {
    async rpc(
      name,
      args,
    ) {
      rpcCalls.push({
        name,
        args,
      });

      if (
        name
        === "ensure_line_message_mirror_image_asset"
      ) {
        return {
          data: {
            ok: true,
            asset: {
              id:
                ASSET_ID,
              queue_id:
                QUEUE_ID,
              status:
                "READY",
              original_storage_path:
                `${ASSET_ID}/original`,
              preview_storage_path:
                `${ASSET_ID}/preview`,
              original_mime_type:
                "image/jpeg",
              preview_mime_type:
                "image/png",
              original_size_bytes:
                ORIGINAL_BYTES.length,
              preview_size_bytes:
                PREVIEW_BYTES.length,
              original_sha256:
                originalSha,
              preview_sha256:
                previewSha,
              serve_token_sha256:
                "a".repeat(
                  64,
                ),
              serve_expires_at:
                "2026-09-14T00:00:00.000Z",
            },
          },
          error: null,
        };
      }

      if (
        name
        === "mark_line_message_mirror_image_asset_ready"
      ) {
        assert.equal(
          args.p_original_sha256,
          originalSha,
        );

        assert.equal(
          args.p_preview_sha256,
          previewSha,
        );

        return {
          data: true,
          error: null,
        };
      }

      throw new Error(
        `UNEXPECTED_RPC:${name}`,
      );
    },

    storage: {
      from() {
        return {
          async upload() {
            uploadCalled =
              true;

            throw new Error(
              "READY_ASSET_SHOULD_NOT_UPLOAD",
            );
          },
        };
      },
    },
  };

  return {
    supabase,
    rpcCalls,
    get uploadCalled() {
      return uploadCalled;
    },
  };
}

function makeCapabilitySupabase({
  tokenSha =
    TOKEN_SHA,
  expiresAt =
    "2026-09-16T00:00:00.000Z",
  blob =
    new Blob(
      [
        ORIGINAL_BYTES,
      ],
      {
        type:
          "image/jpeg",
      },
    ),
} = {}) {
  let storageDownloads =
    0;

  const row = {
    id:
      ASSET_ID,
    status:
      "READY",
    original_storage_path:
      `${ASSET_ID}/original`,
    preview_storage_path:
      `${ASSET_ID}/preview`,
    original_mime_type:
      "image/jpeg",
    preview_mime_type:
      "image/png",
    original_size_bytes:
      ORIGINAL_BYTES.length,
    preview_size_bytes:
      PREVIEW_BYTES.length,
    serve_token_sha256:
      tokenSha,
    serve_expires_at:
      expiresAt,
  };

  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async maybeSingle() {
      return {
        data:
          row,
        error:
          null,
      };
    },
  };

  const supabase = {
    from(
      table,
    ) {
      assert.equal(
        table,
        "line_message_mirror_image_assets",
      );

      return query;
    },

    storage: {
      from(
        bucket,
      ) {
        assert.equal(
          bucket,
          LINE_MIRROR_IMAGE_BUCKET,
        );

        return {
          async download(
            path,
          ) {
            storageDownloads +=
              1;

            assert.equal(
              path,
              `${ASSET_ID}/original`,
            );

            return {
              data:
                blob,
              error:
                null,
            };
          },
        };
      },
    },
  };

  return {
    supabase,
    get storageDownloads() {
      return storageDownloads;
    },
  };
}

{
  const url =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        CAPABILITY_TOKEN,
    });

  const parsed =
    new URL(
      url,
    );

  assert.equal(
    parsed.protocol,
    "https:",
  );

  assert.equal(
    parsed.pathname,
    "/api/line-message-mirror-image",
  );

  assert.equal(
    parsed.searchParams.get(
      "asset",
    ),
    ASSET_ID,
  );

  assert.equal(
    parsed.searchParams.get(
      "kind",
    ),
    "original",
  );

  assert.equal(
    parsed.searchParams.get(
      "token",
    ),
    CAPABILITY_TOKEN,
  );

  pass(
    "MIR2C-D-C2A-01: stable capability URL is HTTPS and asset-scoped",
  );
}

{
  assert.equal(
    safeMirrorSha256Equal(
      TOKEN_SHA,
      TOKEN_SHA,
    ),
    true,
  );

  assert.equal(
    safeMirrorSha256Equal(
      TOKEN_SHA,
      "b".repeat(
        64,
      ),
    ),
    false,
  );

  pass(
    "MIR2C-D-C2A-02: capability hash comparison is constant-time bounded",
  );
}

{
  const urls = [];

  const fetchImpl =
    async (
      url,
    ) => {
      urls.push(
        String(url),
      );

      if (
        String(url)
          .endsWith(
            "/content/preview",
          )
      ) {
        return new Response(
          PREVIEW_BYTES,
          {
            status: 200,
            headers:
              makeHeaders({
                "content-type":
                  "image/png",
                "content-length":
                  String(
                    PREVIEW_BYTES.length,
                  ),
              }),
          },
        );
      }

      return new Response(
        ORIGINAL_BYTES,
        {
          status: 200,
          headers:
            makeHeaders({
              "content-type":
                "image/jpeg",
              "content-length":
                String(
                  ORIGINAL_BYTES.length,
                ),
            }),
        },
      );
    };

  const original =
    await downloadLineMirrorImageVariant({
      messageId:
        SOURCE_MESSAGE_ID,
      channelAccessToken:
        "LINE_TOKEN",
      variant:
        "original",
      fetchImpl,
    });

  const preview =
    await downloadLineMirrorImageVariant({
      messageId:
        SOURCE_MESSAGE_ID,
      channelAccessToken:
        "LINE_TOKEN",
      variant:
        "preview",
      fetchImpl,
    });

  assert.equal(
    original.mimeType,
    "image/jpeg",
  );

  assert.equal(
    preview.mimeType,
    "image/png",
  );

  assert.equal(
    urls.length,
    2,
  );

  assert.match(
    urls[0],
    /\/content$/,
  );

  assert.match(
    urls[1],
    /\/content\/preview$/,
  );

  pass(
    "MIR2C-D-C2A-03: original + LINE preview endpoints are distinct and bounded",
  );
}

{
  const {
    supabase,
    uploads,
    rpcCalls,
  } =
    makePendingPreparationSupabase();

  const fetchImpl =
    async (
      url,
    ) => {
      if (
        String(url)
          .endsWith(
            "/preview",
          )
      ) {
        return new Response(
          PREVIEW_BYTES,
          {
            status: 200,
            headers: {
              "content-type":
                "image/png",
            },
          },
        );
      }

      return new Response(
        ORIGINAL_BYTES,
        {
          status: 200,
          headers: {
            "content-type":
              "image/jpeg",
          },
        },
      );
    };

  const result =
    await prepareLineMirrorImageItem({
      supabase,
      queueId:
        QUEUE_ID,
      leaseToken:
        LEASE_TOKEN,
      sourceMessageId:
        SOURCE_MESSAGE_ID,
      destinationBaseUrl:
        "https://example.netlify.app",
      lineChannelAccessToken:
        "LINE_TOKEN",
      fetchImpl,
      randomBytesImpl:
        () =>
          FIXED_RANDOM,
      nowMs:
        Date.parse(
          "2026-09-14T00:00:00.000Z",
        ),
    });

  assert.equal(
    uploads.length,
    2,
  );

  assert.equal(
    uploads[0].options.upsert,
    true,
  );

  assert.equal(
    uploads[1].options.upsert,
    true,
  );

  assert.equal(
    result.message.type,
    "image",
  );

  assert.equal(
    rpcCalls.at(-1).name,
    "mark_line_message_mirror_image_asset_ready",
  );

  assert.equal(
    rpcCalls.at(-1).args
      .p_serve_token_sha256,
    TOKEN_SHA,
  );

  assert.match(
    result.originalContentUrl,
    /kind=original/,
  );

  assert.match(
    result.previewImageUrl,
    /kind=preview/,
  );

  pass(
    "MIR2C-D-C2A-04: PENDING asset downloads, uploads, marks READY, then returns stable URLs",
  );
}

{
  const state =
    makeReadyPreparationSupabase();

  let fetchCalled =
    false;

  const result =
    await prepareLineMirrorImageItem({
      supabase:
        state.supabase,
      queueId:
        QUEUE_ID,
      leaseToken:
        LEASE_TOKEN,
      sourceMessageId:
        SOURCE_MESSAGE_ID,
      destinationBaseUrl:
        "https://example.netlify.app",
      lineChannelAccessToken:
        "LINE_TOKEN",
      fetchImpl:
        async () => {
          fetchCalled =
            true;

          throw new Error(
            "READY_ASSET_SHOULD_NOT_DOWNLOAD",
          );
        },
      randomBytesImpl:
        () =>
          FIXED_RANDOM,
      nowMs:
        Date.parse(
          "2026-09-14T00:00:00.000Z",
        ),
    });

  assert.equal(
    fetchCalled,
    false,
  );

  assert.equal(
    state.uploadCalled,
    false,
  );

  assert.equal(
    result.message.type,
    "image",
  );

  assert.equal(
    state.rpcCalls.at(-1).name,
    "mark_line_message_mirror_image_asset_ready",
  );

  pass(
    "MIR2C-D-C2A-05: READY pre-freeze asset refreshes capability without LINE re-download",
  );
}

{
  const state =
    makeCapabilitySupabase();

  const url =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        CAPABILITY_TOKEN,
    });

  const access =
    await authorizeLineMirrorImageCapability({
      supabase:
        state.supabase,
      requestUrl:
        url,
      nowMs:
        Date.parse(
          "2026-09-14T12:00:00.000Z",
        ),
    });

  assert.equal(
    access.ok,
    true,
  );

  assert.equal(
    access.storagePath,
    `${ASSET_ID}/original`,
  );

  pass(
    "MIR2C-D-C2A-06: valid token authorizes only READY unexpired asset",
  );
}

{
  const state =
    makeCapabilitySupabase();

  const wrongUrl =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        Buffer.alloc(
          32,
          9,
        ).toString(
          "base64url",
        ),
    });

  const access =
    await authorizeLineMirrorImageCapability({
      supabase:
        state.supabase,
      requestUrl:
        wrongUrl,
      nowMs:
        Date.parse(
          "2026-09-14T12:00:00.000Z",
        ),
    });

  assert.equal(
    access.ok,
    false,
  );

  pass(
    "MIR2C-D-C2A-07: wrong capability token fails closed",
  );
}

{
  const state =
    makeCapabilitySupabase({
      expiresAt:
        "2026-09-14T11:00:00.000Z",
    });

  const url =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        CAPABILITY_TOKEN,
    });

  const access =
    await authorizeLineMirrorImageCapability({
      supabase:
        state.supabase,
      requestUrl:
        url,
      nowMs:
        Date.parse(
          "2026-09-14T12:00:00.000Z",
        ),
    });

  assert.equal(
    access.ok,
    false,
  );

  pass(
    "MIR2C-D-C2A-08: expired capability fails closed",
  );
}

{
  const state =
    makeCapabilitySupabase();

  const url =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        CAPABILITY_TOKEN,
    });

  const response =
    await handleLineMessageMirrorImage(
      new Request(
        url,
        {
          method:
            "GET",
        },
      ),
      {
        supabase:
          state.supabase,
        nowMs:
          Date.parse(
            "2026-09-14T12:00:00.000Z",
          ),
      },
    );

  assert.equal(
    response.status,
    200,
  );

  assert.equal(
    response.headers.get(
      "content-type",
    ),
    "image/jpeg",
  );

  assert.equal(
    response.body
      instanceof ReadableStream,
    true,
  );

  assert.equal(
    state.storageDownloads,
    1,
  );

  const bytes =
    Buffer.from(
      await response.arrayBuffer(),
    );

  assert.deepEqual(
    bytes,
    ORIGINAL_BYTES,
  );

  pass(
    "MIR2C-D-C2A-09: authorized GET returns streamed private Storage image",
  );
}

{
  const state =
    makeCapabilitySupabase();

  const url =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        CAPABILITY_TOKEN,
    });

  const response =
    await handleLineMessageMirrorImage(
      new Request(
        url,
        {
          method:
            "HEAD",
        },
      ),
      {
        supabase:
          state.supabase,
        nowMs:
          Date.parse(
            "2026-09-14T12:00:00.000Z",
          ),
      },
    );

  assert.equal(
    response.status,
    200,
  );

  assert.equal(
    state.storageDownloads,
    0,
  );

  pass(
    "MIR2C-D-C2A-10: authorized HEAD exposes metadata without Storage download",
  );
}

{
  const state =
    makeCapabilitySupabase();

  const wrongUrl =
    buildLineMirrorImageCapabilityUrl({
      baseUrl:
        "https://example.netlify.app",
      assetId:
        ASSET_ID,
      kind:
        "original",
      token:
        Buffer.alloc(
          32,
          4,
        ).toString(
          "base64url",
        ),
    });

  const response =
    await handleLineMessageMirrorImage(
      new Request(
        wrongUrl,
      ),
      {
        supabase:
          state.supabase,
      },
    );

  assert.equal(
    response.status,
    404,
  );

  assert.equal(
    state.storageDownloads,
    0,
  );

  pass(
    "MIR2C-D-C2A-11: invalid capability never reaches private Storage",
  );
}

{
  const source =
    fs.readFileSync(
      "./netlify/functions/line-message-mirror-image.mjs",
      "utf8",
    );

  assert.match(
    source,
    /new Response\(\s*data\.stream\(\)/s,
  );

  assert.match(
    source,
    /path:\s*"\/api\/line-message-mirror-image"/s,
  );

  assert.match(
    source,
    /region:\s*"sin"/s,
  );

  assert.doesNotMatch(
    source,
    /LINE_MESSAGE_MIRROR_ENABLED/,
  );

  assert.doesNotMatch(
    source,
    /createSignedUrl|getPublicUrl/,
  );

  pass(
    "MIR2C-D-C2A-12: endpoint is streamed, stable, private, and independent of transport kill switch",
  );
}

console.log(
  "PASS: LINE Mirror image preparation + capability endpoint v1",
);


{
  const removedPaths = [];
  const updates = [];

  const assets = [
    {
      id:
        "323e4567-e89b-42d3-a456-426614174001",
      queue_id:
        901,
      status:
        "READY",
      original_storage_path:
        "asset-one/original",
      preview_storage_path:
        "asset-one/preview",
    },
    {
      id:
        "323e4567-e89b-42d3-a456-426614174002",
      queue_id:
        902,
      status:
        "PENDING",
      original_storage_path:
        "asset-two/original",
      preview_storage_path:
        "asset-two/preview",
    },
    {
      id:
        "323e4567-e89b-42d3-a456-426614174003",
      queue_id:
        903,
      status:
        "DELETED",
      original_storage_path:
        "asset-three/original",
      preview_storage_path:
        "asset-three/preview",
    },
  ];

  const supabase = {
    from(
      table,
    ) {
      assert.equal(
        table,
        "line_message_mirror_image_assets",
      );

      return {
        select() {
          return {
            async in(
              column,
              values,
            ) {
              assert.equal(
                column,
                "queue_id",
              );

              assert.deepEqual(
                values,
                [
                  "901",
                  "902",
                  "903",
                ],
              );

              return {
                data:
                  assets,
                error:
                  null,
              };
            },
          };
        },

        update(
          payload,
        ) {
          updates.push(
            payload,
          );

          return {
            async in(
              column,
              values,
            ) {
              assert.equal(
                column,
                "id",
              );

              assert.deepEqual(
                values,
                [
                  "323e4567-e89b-42d3-a456-426614174001",
                  "323e4567-e89b-42d3-a456-426614174002",
                ],
              );

              return {
                data:
                  null,
                error:
                  null,
              };
            },
          };
        },
      };
    },

    storage: {
      from(
        bucket,
      ) {
        assert.equal(
          bucket,
          LINE_MIRROR_IMAGE_BUCKET,
        );

        return {
          async remove(
            paths,
          ) {
            removedPaths.push(
              ...paths,
            );

            return {
              data: [],
              error: null,
            };
          },
        };
      },
    },
  };

  const result =
    await cleanupLineMirrorImageItems({
      supabase,
      queueIds: [
        901,
        902,
        903,
        901,
      ],
    });

  assert.equal(
    result.ok,
    true,
  );

  assert.equal(
    result.assetCount,
    2,
  );

  assert.equal(
    result.objectCount,
    4,
  );

  assert.deepEqual(
    removedPaths,
    [
      "asset-one/original",
      "asset-one/preview",
      "asset-two/original",
      "asset-two/preview",
    ],
  );

  assert.equal(
    updates.length,
    1,
  );

  assert.equal(
    updates[0].status,
    "DELETED",
  );

  console.log(
    "PASS MIR2C-D-C2D-01: terminal cleanup removes active objects and marks assets DELETED",
  );
}

{
  let updateCalls =
    0;

  const supabase = {
    from() {
      return {
        select() {
          return {
            async in() {
              return {
                data: [
                  {
                    id:
                      "423e4567-e89b-42d3-a456-426614174001",
                    queue_id:
                      904,
                    status:
                      "READY",
                    original_storage_path:
                      "asset-four/original",
                    preview_storage_path:
                      "asset-four/preview",
                  },
                ],
                error:
                  null,
              };
            },
          };
        },

        update() {
          updateCalls +=
            1;

          return {
            async in() {
              return {
                data:
                  null,
                error:
                  null,
              };
            },
          };
        },
      };
    },

    storage: {
      from() {
        return {
          async remove() {
            return {
              data:
                null,
              error: {
                message:
                  "temporary storage failure",
              },
            };
          },
        };
      },
    },
  };

  const result =
    await cleanupLineMirrorImageItems({
      supabase,
      queueIds: [
        904,
      ],
      logger: {
        error() {},
      },
    });

  assert.equal(
    result.ok,
    false,
  );

  assert.match(
    result.error,
    /MIRROR_IMAGE_CLEANUP_STORAGE_FAILED/,
  );

  assert.equal(
    updateCalls,
    0,
  );

  console.log(
    "PASS MIR2C-D-C2D-02: failed Storage deletion does not falsely mark asset DELETED",
  );
}

console.log(
  "PASS: LINE Mirror terminal image cleanup helper v1",
);
