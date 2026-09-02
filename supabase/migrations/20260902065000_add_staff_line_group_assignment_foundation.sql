-- R2D1A
-- Staff Identity + Multi-Staff LINE Group Assignment Foundation
--
-- Additive-only foundation:
--   1. Staff identities with hashed per-user access keys.
--   2. Many-to-many Staff <-> LINE Group assignments.
--   3. No Review/Parser/Round behavior changes yet.
--
-- Security:
--   - Never store plaintext staff access keys.
--   - Staff access keys are SHA-256 hashed by the server before lookup.
--   - Existing DASHBOARD_ACCESS_KEY remains available for Admin compatibility.

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),

  staff_code text not null,
  display_name text not null,

  role text not null default 'STAFF'
    check (
      role in (
        'ADMIN',
        'SUPERVISOR',
        'STAFF'
      )
    ),

  access_key_hash text,

  enabled boolean not null default true,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    btrim(staff_code) <> ''
  ),

  check (
    btrim(display_name) <> ''
  ),

  check (
    access_key_hash is null
    or access_key_hash ~ '^[0-9a-f]{64}$'
  ),

  check (
    enabled = false
    or access_key_hash is not null
  )
);

create unique index if not exists staff_accounts_code_unique_idx
  on public.staff_accounts (
    lower(btrim(staff_code))
  );

create unique index if not exists staff_accounts_access_key_hash_unique_idx
  on public.staff_accounts (
    access_key_hash
  )
  where access_key_hash is not null;

create index if not exists staff_accounts_enabled_role_idx
  on public.staff_accounts (
    enabled,
    role
  );

comment on table public.staff_accounts is
  'R2D staff identities for the real-time verification workbench. Plaintext access keys must never be persisted.';

comment on column public.staff_accounts.access_key_hash is
  'Lowercase SHA-256 hex digest of the per-staff workbench access key.';


create table if not exists public.line_group_staff_assignments (
  line_group_id text not null
    references public.line_groups(line_group_id)
    on delete cascade,

  staff_id uuid not null
    references public.staff_accounts(id)
    on delete cascade,

  assignment_role text not null default 'REVIEWER'
    check (
      assignment_role in (
        'REVIEWER',
        'SUPERVISOR'
      )
    ),

  enabled boolean not null default true,

  assigned_by text,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (
    line_group_id,
    staff_id
  )
);

create index if not exists line_group_staff_assignments_staff_idx
  on public.line_group_staff_assignments (
    staff_id,
    line_group_id
  )
  where enabled = true;

create index if not exists line_group_staff_assignments_line_idx
  on public.line_group_staff_assignments (
    line_group_id,
    staff_id
  )
  where enabled = true;

comment on table public.line_group_staff_assignments is
  'Many-to-many assignment of Staff to LINE Groups. Multiple Staff may review the same LINE Group concurrently.';


alter table public.staff_accounts
  enable row level security;

alter table public.line_group_staff_assignments
  enable row level security;

revoke all
  on public.staff_accounts
  from anon, authenticated;

revoke all
  on public.line_group_staff_assignments
  from anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on public.staff_accounts
to service_role;

grant
  select,
  insert,
  update,
  delete
on public.line_group_staff_assignments
to service_role;
