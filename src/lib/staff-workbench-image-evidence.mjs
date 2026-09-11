const REVIEW_IMAGE_BUCKET =
  "review-images";

const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS =
  900;


async function loadScopedWorkbenchImageStoragePaths(
  client,
  messageRecordIds,
) {
  const ids = [
    ...new Set(
      (messageRecordIds ?? [])
        .filter(Boolean),
    ),
  ];

  if (!ids.length) {
    return new Map();
  }

  const {
    data,
    error,
  } = await client
    .from("messages")
    .select(
      "id,image_storage_path",
    )
    .in(
      "id",
      ids,
    );

  if (error) {
    throw error;
  }

  return new Map(
    (data ?? []).map(
      (row) => [
        row.id,
        row.image_storage_path
        ?? null,
      ],
    ),
  );
}


export async function addScopedWorkbenchImageEvidence(
  client,
  payload,
) {
  const itemKeys = [
    "work_items",
    "verification_items",
    "attention_items",
    "high_total_items",
  ];

  const allItems =
    itemKeys.flatMap(
      (key) =>
        Array.isArray(
          payload?.[key],
        )
          ? payload[key]
          : [],
    );

  // These message identities have already passed
  // Staff authentication, assignment and Workbench scope.
  const messageRecordIds = [
    ...new Set(
      allItems
        .filter(
          (item) =>
            String(
              item?.message_type
              ?? "",
            ).toLowerCase()
              === "image"
            && item?.has_image_evidence
              === true,
        )
        .map(
          (item) =>
            item.message_record_id,
        )
        .filter(Boolean),
    ),
  ];

  const nullEvidenceItem =
    (item) => ({
      ...item,

      image_evidence_url:
        null,

      image_evidence_expires_in:
        null,
    });

  if (!messageRecordIds.length) {
    return {
      ...payload,

      ...Object.fromEntries(
        itemKeys.map(
          (key) => [
            key,
            (
              Array.isArray(
                payload?.[key],
              )
                ? payload[key]
                : []
            ).map(
              nullEvidenceItem,
            ),
          ],
        ),
      ),
    };
  }

  const imagePathByMessage =
    await loadScopedWorkbenchImageStoragePaths(
      client,
      messageRecordIds,
    );

  const storagePaths = [
    ...new Set(
      messageRecordIds
        .map(
          (messageRecordId) =>
            imagePathByMessage.get(
              messageRecordId,
            ),
        )
        .filter(Boolean),
    ),
  ];

  const signedUrlByPath =
    new Map();

  await Promise.all(
    storagePaths.map(
      async (storagePath) => {
        try {
          const {
            data,
            error,
          } = await client.storage
            .from(
              REVIEW_IMAGE_BUCKET,
            )
            .createSignedUrl(
              storagePath,
              REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS,
            );

          if (
            error
            || !data?.signedUrl
          ) {
            console.warn(
              "staff workbench image signing failed",
              {
                error:
                  error?.message
                  ?? "SIGNED_URL_MISSING",
              },
            );

            signedUrlByPath.set(
              storagePath,
              null,
            );

            return;
          }

          signedUrlByPath.set(
            storagePath,
            data.signedUrl,
          );
        } catch (error) {
          // Private image evidence is optional.
          // Storage failure must not make the
          // Staff Workbench unavailable.
          console.warn(
            "staff workbench image signing failed",
            {
              error:
                error?.message
                ?? String(error),
            },
          );

          signedUrlByPath.set(
            storagePath,
            null,
          );
        }
      },
    ),
  );

  const enrichItem =
    (item) => {
      const storagePath =
        imagePathByMessage.get(
          item?.message_record_id,
        )
        ?? null;

      const signedUrl =
        storagePath
          ? (
              signedUrlByPath.get(
                storagePath,
              )
              ?? null
            )
          : null;

      return {
        ...item,

        image_evidence_url:
          signedUrl,

        image_evidence_expires_in:
          signedUrl
            ? REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS
            : null,
      };
    };

  return {
    ...payload,

    ...Object.fromEntries(
      itemKeys.map(
        (key) => [
          key,
          (
            Array.isArray(
              payload?.[key],
            )
              ? payload[key]
              : []
          ).map(
            enrichItem,
          ),
        ],
      ),
    ),
  };
}
