import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const dashboardApi =
  fs.readFileSync(
    "src/lib/dashboard-api.mjs",
    "utf8",
  );

function section(name) {
  const match =
    new RegExp(
      `(?:async\\s+)?function\\s+${name}\\s*\\(`,
    ).exec(app);

  assert.ok(
    match,
    `missing ${name}`,
  );

  const rest =
    app.slice(
      match.index
      + match[0].length,
    );

  const next =
    /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/.exec(
      rest,
    );

  const end =
    next
      ? match.index
        + match[0].length
        + next.index
      : app.length;

  return app.slice(
    match.index,
    end,
  );
}

console.log(
  "===== Admin Review Badge Authoritative List v1 =====",
);

const helper =
  section(
    "hideReviewBadgeUntilLoaded",
  );

assert.match(
  helper,
  /#reviewBadge/,
);

assert.match(
  helper,
  /classList\.add\([\s\S]*?"hidden"/,
);

console.log(
  "PASS ARB-01: Review badge has explicit untrusted state",
);


const entry =
  section(
    "enterDashboardSession",
  );

assert.match(
  entry,
  /hideReviewBadgeUntilLoaded\(\)/,
);

assert.match(
  entry,
  /hideUnsendBadgeUntilLoaded\(\)/,
);

console.log(
  "PASS ARB-02: Dashboard entry hides non-authoritative badges",
);


const dashboard =
  section(
    "loadDashboard",
  );

assert.match(
  dashboard,
  /if\s*\(\s*!preserveReviewWorkbench\s*\)[\s\S]*?hideReviewBadgeUntilLoaded\(\)/,
);

console.log(
  "PASS ARB-03: Dashboard context change invalidates Review count",
);


const reviews =
  section(
    "loadReviews",
  );

const hide =
  reviews.indexOf(
    "reviewBadge.classList.add",
  );

const read =
  reviews.indexOf(
    "Promise.all",
  );

assert.ok(
  hide >= 0
  && read > hide,
);

console.log(
  "PASS ARB-04: Review badge hides before authoritative read",
);


const count =
  reviews.indexOf(
    "const reviewCount =",
  );

const length =
  reviews.indexOf(
    "items.length",
    count,
  );

const write =
  reviews.indexOf(
    "reviewBadge.textContent",
    count,
  );

const reveal =
  reviews.indexOf(
    "reviewBadge.classList.remove",
    count,
  );

assert.ok(
  count >= 0
  && length > count
  && write > length
  && reveal > write,
);

console.log(
  "PASS ARB-05: visible count comes from items.length",
);


const empty =
  reviews.indexOf(
    "if (!items.length)",
  );

assert.ok(
  empty > reveal,
  "authoritative zero must be written before empty-list return",
);

console.log(
  "PASS ARB-06: legitimate zero appears only after successful list load",
);


assert.match(
  reviews,
  /state\.dashboard\.metrics\.review_open\s*=\s*[\s\S]*?reviewCount/,
);

console.log(
  "PASS ARB-07: informational Dashboard state follows authoritative list",
);


assert.doesNotMatch(
  reviews,
  /state\.authMode === "STAFF"[\s\S]{0,300}?reviewBadge\.classList\.remove/,
);

console.log(
  "PASS ARB-08: Staff badge contract remains isolated",
);


// Emergency DB suppression must remain exactly in effect.
const countStart =
  dashboardApi.indexOf(
    "export async function fetchOpenReviewCount(",
  );

const countEnd =
  dashboardApi.indexOf(
    "export async function fetchUnsends(",
    countStart,
  );

assert.ok(
  countStart >= 0
  && countEnd > countStart,
);

const countPath =
  dashboardApi.slice(
    countStart,
    countEnd,
  );

assert.match(
  countPath,
  /dashboard_open_review_count/,
);

assert.match(
  countPath,
  /return 0;/,
);

assert.doesNotMatch(
  countPath,
  /\.from\("review_items"\)/,
);

console.log(
  "PASS ARB-09: optimized Review-count RPC restored while badge authority remains list-based",
);

console.log(
  "PASS: Admin Review Badge Authoritative List v1",
);
