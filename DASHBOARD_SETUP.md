# Dashboard MVP Setup

## What this patch adds

- Static dashboard served by Netlify at the site root `/`
- `/api/dashboard` summary + allocation snapshot
- `/api/confirm-transfer` safe server-side confirmation
- `/api/reviews` read-only review queue
- `/api/unsends` unsend audit list
- `DASHBOARD_ACCESS_KEY` protection for all dashboard APIs
- `allocation_confirmation_events` audit trail

## 1. Run the Supabase migration

Run:

`supabase/migrations/202608240003_add_dashboard_foundation.sql`

This adds indexes, `allocation_confirmation_events`, and the transactional RPC `confirm_allocation_transfer`.

## 2. Netlify environment variables

Add:

- `DASHBOARD_ACCESS_KEY` — long random secret used only by the dashboard user
- `DASHBOARD_OPERATOR_NAME` — optional label such as `ADMIN`

Generate a strong access key locally:

```bash
openssl rand -hex 24
```

Copy the output into Netlify as `DASHBOARD_ACCESS_KEY`. Do not commit it to Git.

## 3. Deploy

After applying the patch:

```bash
npm test
node --check netlify/functions/dashboard.mjs
node --check netlify/functions/confirm-transfer.mjs
node --check netlify/functions/reviews.mjs
node --check netlify/functions/unsends.mjs
node --check public/app.js
git diff --check
```

Then commit and push. Netlify will publish the site from `public/`.

## 4. Open the dashboard

Open your Netlify site root, for example:

`https://YOUR-SITE.netlify.app/`

Enter the same value you configured as `DASHBOARD_ACCESS_KEY`.

The key is kept only in browser `sessionStorage`, so closing the browser tab/session clears it.

## 5. Confirm transfer behavior

The browser never decides the new cumulative confirmed amount. It sends only:

- business date
- summary group
- category
- code

The server calls the PostgreSQL RPC, reads the latest `allocation_state`, sets `confirmed_transfer = should_transfer`, and writes an audit event. This prevents stale-page double confirmation.

## Security scope

This is a single-operator MVP gate, not full user authentication. Supabase secret keys remain server-side only. Before multi-user rollout, replace this access key with Supabase Auth and role-based permissions.
