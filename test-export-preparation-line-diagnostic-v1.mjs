import assert from "node:assert/strict";

import {
  readFileSync,
} from "node:fs";

import {
  buildLineGroupSummaryEndpoint,
  diagnoseExportPreparationLineDestination,
  LINE_BOT_INFO_ENDPOINT,
} from "./src/lib/export-preparation-line-diagnostic.mjs";


const functionSource =
  readFileSync(
    "netlify/functions/export-preparation-line-diagnostic.mjs",
    "utf8",
  );

const helperSource =
  readFileSync(
    "src/lib/export-preparation-line-diagnostic.mjs",
    "utf8",
  );

const packageSource =
  readFileSync(
    "package.json",
    "utf8",
  );


const DESTINATION =
  "Ca0c699bb4618d67e7382a1cfd2683175";

const TOKEN =
  "TEST_SECRET_TOKEN_MUST_NEVER_LEAK";


function response(
  status,
  body,
) {
  return {
    status,

    ok:
      status >= 200
      && status <= 299,

    async json() {
      return body;
    },
  };
}


function successFetch(
  calls,
) {
  return async (
    url,
    options,
  ) => {
    calls.push({
      url,
      options,
    });

    if (
      url ===
      LINE_BOT_INFO_ENDPOINT
    ) {
      return response(
        200,
        {
          userId:
            "Ubot-runtime-proof",
          basicId:
            "@runtimeproof",
          displayName:
            "Runtime Proof OA",
          chatMode:
            "chat",
        },
      );
    }

    if (
      url ===
      buildLineGroupSummaryEndpoint(
        DESTINATION,
      )
    ) {
      return response(
        200,
        {
          groupId:
            DESTINATION,
          groupName:
            "L-เตรียมส่งออก ป",
        },
      );
    }

    throw new Error(
      "UNEXPECTED_TEST_URL",
    );
  };
}


/*
 * EXPDIAG-01
 * Canonical LINE endpoints are GET diagnostics only.
 */
assert.equal(
  LINE_BOT_INFO_ENDPOINT,
  "https://api.line.me/v2/bot/info",
);

assert.equal(
  buildLineGroupSummaryEndpoint(
    DESTINATION,
  ),
  `https://api.line.me/v2/bot/group/${DESTINATION}/summary`,
);

console.log(
  "PASS EXPDIAG-01: canonical diagnostic endpoints",
);


/*
 * EXPDIAG-02
 * Missing credential fails before transport.
 */
await assert.rejects(
  () =>
    diagnoseExportPreparationLineDestination({
      channelAccessToken:
        "",
      destinationLineGroupId:
        DESTINATION,
      fetchImpl:
        async () => {
          throw new Error(
            "FETCH_MUST_NOT_RUN",
          );
        },
    }),
  /LINE_CHANNEL_ACCESS_TOKEN_MISSING/,
);

console.log(
  "PASS EXPDIAG-02: missing token rejected",
);


/*
 * EXPDIAG-03
 * Missing destination fails before transport.
 */
await assert.rejects(
  () =>
    diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        "",
      fetchImpl:
        async () => {
          throw new Error(
            "FETCH_MUST_NOT_RUN",
          );
        },
    }),
  /LINE_DESTINATION_MISSING/,
);

console.log(
  "PASS EXPDIAG-03: missing destination rejected",
);


/*
 * EXPDIAG-04..08
 * Successful runtime proof.
 */
{
  const calls = [];

  const result =
    await diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        DESTINATION,
      fetchImpl:
        successFetch(calls),
      timeoutMs:
        1000,
    });

  assert.equal(
    calls.length,
    2,
  );

  assert.equal(
    calls[0].url,
    LINE_BOT_INFO_ENDPOINT,
  );

  assert.equal(
    calls[1].url,
    buildLineGroupSummaryEndpoint(
      DESTINATION,
    ),
  );

  for (const call of calls) {
    assert.equal(
      call.options.method,
      "GET",
    );

    assert.equal(
      call.options.headers
        .Authorization,
      `Bearer ${TOKEN}`,
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          call.options,
          "body",
        ),
      false,
    );
  }

  assert.equal(
    result
      .bot_identity_verified,
    true,
  );

  assert.equal(
    result
      .group_membership_verified,
    true,
  );

  assert.equal(
    result
      .ready_to_consider_enable,
    true,
  );

  assert.equal(
    result.bot.user_id,
    "Ubot-runtime-proof",
  );

  assert.equal(
    result.group.group_id,
    DESTINATION,
  );

  assert.equal(
    result.group.group_name,
    "L-เตรียมส่งออก ป",
  );

  assert.equal(
    JSON.stringify(result)
      .includes(TOKEN),
    false,
  );
}

console.log(
  "PASS EXPDIAG-04: only two GET requests used",
);
console.log(
  "PASS EXPDIAG-05: Authorization stays request-only",
);
console.log(
  "PASS EXPDIAG-06: bot identity verified",
);
console.log(
  "PASS EXPDIAG-07: group membership verified",
);
console.log(
  "PASS EXPDIAG-08: token absent from diagnostic result",
);


/*
 * EXPDIAG-09
 * Invalid/expired LINE credential remains non-ready.
 */
{
  const result =
    await diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        DESTINATION,

      fetchImpl:
        async () =>
          response(
            401,
            {
              message:
                "Authentication failed",
            },
          ),
    });

  assert.equal(
    result
      .bot_identity_verified,
    false,
  );

  assert.equal(
    result
      .group_membership_verified,
    false,
  );

  assert.equal(
    result
      .ready_to_consider_enable,
    false,
  );

  assert.equal(
    result.bot.error,
    "LINE_UNAUTHORIZED",
  );

  assert.equal(
    result.group.error,
    "LINE_UNAUTHORIZED",
  );
}

console.log(
  "PASS EXPDIAG-09: LINE 401 remains non-ready",
);


/*
 * EXPDIAG-10
 * Bot identity may be valid while destination membership
 * is not established.
 */
{
  let count = 0;

  const result =
    await diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        DESTINATION,

      fetchImpl:
        async () => {
          count += 1;

          if (count === 1) {
            return response(
              200,
              {
                userId:
                  "Ubot-runtime-proof",
                basicId:
                  "@runtimeproof",
                displayName:
                  "Runtime Proof OA",
              },
            );
          }

          return response(
            404,
            {
              message:
                "Not found",
            },
          );
        },
    });

  assert.equal(
    result
      .bot_identity_verified,
    true,
  );

  assert.equal(
    result
      .group_membership_verified,
    false,
  );

  assert.equal(
    result.group.error,
    "LINE_GROUP_NOT_FOUND_OR_NOT_MEMBER",
  );

  assert.equal(
    result
      .ready_to_consider_enable,
    false,
  );
}

console.log(
  "PASS EXPDIAG-10: missing group membership blocks readiness",
);


/*
 * EXPDIAG-11
 * A 200 response for the wrong group does not count
 * as membership proof.
 */
{
  let count = 0;

  const result =
    await diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        DESTINATION,

      fetchImpl:
        async () => {
          count += 1;

          if (count === 1) {
            return response(
              200,
              {
                userId:
                  "Ubot-runtime-proof",
              },
            );
          }

          return response(
            200,
            {
              groupId:
                "Cwrong",
              groupName:
                "Wrong group",
            },
          );
        },
    });

  assert.equal(
    result.group.ok,
    false,
  );

  assert.equal(
    result.group.id_matches,
    false,
  );

  assert.equal(
    result.group.error,
    "LINE_GROUP_ID_MISMATCH",
  );

  assert.equal(
    result
      .ready_to_consider_enable,
    false,
  );
}

console.log(
  "PASS EXPDIAG-11: group ID mismatch fails closed",
);


/*
 * EXPDIAG-12
 * Timeout/network ambiguity never becomes readiness.
 */
{
  const timeout =
    new Error(
      "aborted",
    );

  timeout.name =
    "AbortError";

  const result =
    await diagnoseExportPreparationLineDestination({
      channelAccessToken:
        TOKEN,
      destinationLineGroupId:
        DESTINATION,

      fetchImpl:
        async () => {
          throw timeout;
        },
    });

  assert.equal(
    result.bot.error,
    "LINE_TIMEOUT",
  );

  assert.equal(
    result.group.error,
    "LINE_TIMEOUT",
  );

  assert.equal(
    result
      .ready_to_consider_enable,
    false,
  );
}

console.log(
  "PASS EXPDIAG-12: timeout fails closed",
);


/*
 * EXPDIAG-13
 * Server endpoint is GET-only.
 */
assert.match(
  functionSource,
  /req\.method\s*!==\s*"GET"/,
);

assert.match(
  functionSource,
  /METHOD_NOT_ALLOWED/,
);

console.log(
  "PASS EXPDIAG-13: endpoint is GET-only",
);


/*
 * EXPDIAG-14
 * Existing Dashboard authentication is mandatory.
 */
const authIndex =
  functionSource.indexOf(
    "requireDashboardAccess(req)",
  );

const registryIndex =
  functionSource.indexOf(
    '"export_destination_line_groups"',
  );

const tokenIndex =
  functionSource.indexOf(
    ".LINE_CHANNEL_ACCESS_TOKEN",
  );

assert.ok(
  authIndex >= 0,
);

assert.ok(
  registryIndex > authIndex,
);

assert.ok(
  tokenIndex > registryIndex,
);

console.log(
  "PASS EXPDIAG-14: Dashboard auth precedes registry and secret access",
);


/*
 * EXPDIAG-15
 * Destination must exist in dedicated Export registry.
 */
assert.match(
  functionSource,
  /\.from\(\s*"export_destination_line_groups"\s*,?\s*\)/s,
);

assert.match(
  functionSource,
  /EXPORT_DESTINATION_NOT_REGISTERED/,
);

console.log(
  "PASS EXPDIAG-15: dedicated Export registry required",
);


/*
 * EXPDIAG-16
 * Diagnostic endpoint must not mutate DB.
 */
assert.doesNotMatch(
  functionSource,
  /\.(insert|update|upsert|delete)\s*\(/,
);

assert.doesNotMatch(
  functionSource,
  /\.rpc\s*\(/,
);

console.log(
  "PASS EXPDIAG-16: endpoint has no DB write path",
);


/*
 * EXPDIAG-17
 * Neither source file may contain LINE push transport.
 */
assert.doesNotMatch(
  helperSource,
  /\/message\/push/,
);

assert.doesNotMatch(
  functionSource,
  /\/message\/push/,
);

assert.doesNotMatch(
  helperSource,
  /method\s*:\s*"POST"/,
);

console.log(
  "PASS EXPDIAG-17: diagnostic cannot use LINE push path",
);


/*
 * EXPDIAG-18
 * Production credential is read server-side only.
 */
assert.match(
  functionSource,
  /process\.env[\s\S]*LINE_CHANNEL_ACCESS_TOKEN/,
);

assert.doesNotMatch(
  helperSource,
  /process\.env/,
);

console.log(
  "PASS EXPDIAG-18: credential ownership remains server-side",
);


/*
 * EXPDIAG-19
 * Response explicitly reports that credential material
 * is not exposed.
 */
/*
 * Internal server code is allowed to pass the credential
 * into the diagnostic helper. The security boundary that
 * matters here is the HTTP response surface.
 */
const successResponseStart =
  functionSource.indexOf(
    "return json({",
    functionSource.indexOf(
      "const diagnostic =",
    ),
  );

const successResponseEnd =
  functionSource.indexOf(
    "});",
    successResponseStart,
  );

assert.ok(
  successResponseStart >= 0,
);

assert.ok(
  successResponseEnd >
    successResponseStart,
);

const successResponseSource =
  functionSource.slice(
    successResponseStart,
    successResponseEnd + 3,
  );

assert.match(
  successResponseSource,
  /token_exposed:\s*false/,
);

assert.doesNotMatch(
  successResponseSource,
  /\bchannelAccessToken\b/,
);

console.log(
  "PASS EXPDIAG-19: token is not serialized",
);


/*
 * EXPDIAG-20
 * Route is explicit and isolated.
 */
assert.match(
  functionSource,
  /path:\s*[\r\n\s]*"\/api\/export-preparation-line-diagnostic"/,
);

console.log(
  "PASS EXPDIAG-20: dedicated diagnostic route",
);


/*
 * EXPDIAG-21
 * Diagnostic readiness is separate from destination enable.
 */
assert.match(
  functionSource,
  /ready_to_consider_enable/,
);

assert.doesNotMatch(
  functionSource,
  /enabled\s*:\s*true/,
);

console.log(
  "PASS EXPDIAG-21: diagnostic does not enable destination",
);


/*
 * EXPDIAG-22
 * Package full regression includes this test.
 */
assert.match(
  packageSource,
  /node test-export-preparation-line-diagnostic-v1\.mjs/,
);

console.log(
  "PASS EXPDIAG-22: full regression includes diagnostic test",
);


console.log();
console.log(
  "PASS: Export Preparation LINE runtime diagnostic v1",
);
