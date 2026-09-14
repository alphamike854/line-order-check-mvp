-- MIR2C-D
-- Retry-stable LINE image Mirror foundation.
--
-- This phase is intentionally transport-inert.
--
-- It provides:
--   1. private mirror-images Storage bucket
--   2. durable per-queue image asset metadata
--   3. deterministic Storage object paths
--   4. stable opaque serving-token hash + expiry metadata
--   5. immutable prepared LINE Push request body on each batch
--   6. lease-scoped service-role RPCs for preparation
--
-- It does NOT:
--   - enable LINE Message Mirror
--   - create routes
--   - download LINE images
--   - upload Storage objects
--   - expose public Storage access
--   - send LINE Push requests
--   - touch Review image lifecycle

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'mirror-images',
  'mirror-images',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types =
    array[
      'image/jpeg',
      'image/png'
    ]::text[];

alter table
  public.line_message_mirror_batches
add column if not exists
  prepared_request_body text,
add column if not exists
  prepared_request_sha256 text,
add column if not exists
  prepared_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'line_message_mirror_batches_prepared_request_all_or_none_check'
      and conrelid =
        'public.line_message_mirror_batches'::regclass
  ) then
    alter table
      public.line_message_mirror_batches
    add constraint
      line_message_mirror_batches_prepared_request_all_or_none_check
    check (
      (
        prepared_request_body is null
        and prepared_request_sha256 is null
        and prepared_at is null
      )
      or
      (
        prepared_request_body is not null
        and prepared_request_sha256 is not null
        and prepared_at is not null
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname =
      'line_message_mirror_batches_prepared_request_body_size_check'
      and conrelid =
        'public.line_message_mirror_batches'::regclass
  ) then
    alter table
      public.line_message_mirror_batches
    add constraint
      line_message_mirror_batches_prepared_request_body_size_check
    check (
      prepared_request_body is null
      or (
        octet_length(prepared_request_body) >= 2
        and octet_length(prepared_request_body) <= 65536
      )
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname =
      'line_message_mirror_batches_prepared_request_sha256_check'
      and conrelid =
        'public.line_message_mirror_batches'::regclass
  ) then
    alter table
      public.line_message_mirror_batches
    add constraint
      line_message_mirror_batches_prepared_request_sha256_check
    check (
      prepared_request_sha256 is null
      or prepared_request_sha256
        ~ '^[0-9a-f]{64}$'
    );
  end if;
end
$$;

create table if not exists
  public.line_message_mirror_image_assets (
    id uuid primary key
      default gen_random_uuid(),

    queue_id bigint not null
      unique
      references
        public.line_message_mirror_queue(id)
      on delete cascade,

    status text not null
      default 'PENDING',

    original_storage_path text not null,

    preview_storage_path text not null,

    original_mime_type text,

    preview_mime_type text,

    original_size_bytes bigint,

    preview_size_bytes bigint,

    original_sha256 text,

    preview_sha256 text,

    serve_token_sha256 text,

    serve_expires_at timestamptz,

    prepared_at timestamptz,

    last_error text,

    created_at timestamptz not null
      default now(),

    updated_at timestamptz not null
      default now(),

    constraint
      line_message_mirror_image_assets_status_check
    check (
      status in (
        'PENDING',
        'READY',
        'FAILED',
        'DELETED'
      )
    ),

    constraint
      line_message_mirror_image_assets_paths_check
    check (
      length(trim(original_storage_path)) > 0
      and length(trim(preview_storage_path)) > 0
      and original_storage_path
        <> preview_storage_path
    ),

    constraint
      line_message_mirror_image_assets_original_mime_check
    check (
      original_mime_type is null
      or original_mime_type in (
        'image/jpeg',
        'image/png'
      )
    ),

    constraint
      line_message_mirror_image_assets_preview_mime_check
    check (
      preview_mime_type is null
      or preview_mime_type in (
        'image/jpeg',
        'image/png'
      )
    ),

    constraint
      line_message_mirror_image_assets_original_size_check
    check (
      original_size_bytes is null
      or (
        original_size_bytes >= 1
        and original_size_bytes <= 10485760
      )
    ),

    constraint
      line_message_mirror_image_assets_preview_size_check
    check (
      preview_size_bytes is null
      or (
        preview_size_bytes >= 1
        and preview_size_bytes <= 1048576
      )
    ),

    constraint
      line_message_mirror_image_assets_original_sha256_check
    check (
      original_sha256 is null
      or original_sha256
        ~ '^[0-9a-f]{64}$'
    ),

    constraint
      line_message_mirror_image_assets_preview_sha256_check
    check (
      preview_sha256 is null
      or preview_sha256
        ~ '^[0-9a-f]{64}$'
    ),

    constraint
      line_message_mirror_image_assets_serve_token_sha256_check
    check (
      serve_token_sha256 is null
      or serve_token_sha256
        ~ '^[0-9a-f]{64}$'
    ),

    constraint
      line_message_mirror_image_assets_ready_contract_check
    check (
      status <> 'READY'
      or (
        original_mime_type is not null
        and preview_mime_type is not null
        and original_size_bytes is not null
        and preview_size_bytes is not null
        and original_sha256 is not null
        and preview_sha256 is not null
        and serve_token_sha256 is not null
        and serve_expires_at is not null
        and prepared_at is not null
        and serve_expires_at > prepared_at
      )
    )
  );

create index if not exists
  line_message_mirror_image_assets_expiry_idx
on
  public.line_message_mirror_image_assets (
    serve_expires_at,
    id
  )
where
  status = 'READY';

alter table
  public.line_message_mirror_image_assets
enable row level security;

revoke all
on table
  public.line_message_mirror_image_assets
from
  public,
  anon,
  authenticated;

grant
  select,
  insert,
  update,
  delete
on table
  public.line_message_mirror_image_assets
to service_role;

create or replace function
  public.guard_line_message_mirror_prepared_request_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.prepared_request_body is not null then
    if new.prepared_request_body
         is distinct from old.prepared_request_body
       or new.prepared_request_sha256
         is distinct from old.prepared_request_sha256
       or new.prepared_at
         is distinct from old.prepared_at then
      raise exception
        'MIRROR_PREPARED_REQUEST_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$$;

revoke all
on function
  public.guard_line_message_mirror_prepared_request_immutable()
from public;

drop trigger if exists
  line_message_mirror_batches_prepared_request_immutable_trg
on
  public.line_message_mirror_batches;

create trigger
  line_message_mirror_batches_prepared_request_immutable_trg
before update of
  prepared_request_body,
  prepared_request_sha256,
  prepared_at
on
  public.line_message_mirror_batches
for each row
execute function
  public.guard_line_message_mirror_prepared_request_immutable();

create or replace function
  public.guard_line_message_mirror_image_asset_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_request_prepared boolean :=
    false;
begin
  if new.queue_id
       is distinct from old.queue_id
     or new.original_storage_path
       is distinct from old.original_storage_path
     or new.preview_storage_path
       is distinct from old.preview_storage_path then
    raise exception
      'MIRROR_IMAGE_ASSET_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'DELETED'
     and new.status <> 'DELETED' then
    raise exception
      'MIRROR_IMAGE_ASSET_DELETED_TERMINAL';
  end if;

  if old.status = 'READY'
     and new.status not in (
       'READY',
       'DELETED'
     ) then
    raise exception
      'MIRROR_IMAGE_ASSET_READY_TERMINAL';
  end if;

  if old.status = 'READY' then
    select
      b.prepared_request_body
        is not null
    into
      v_request_prepared
    from
      public.line_message_mirror_queue q
    join
      public.line_message_mirror_batches b
        on b.id =
          q.batch_id
    where q.id =
      old.queue_id;

    if coalesce(
         v_request_prepared,
         false
       ) then
      if new.original_mime_type
           is distinct from old.original_mime_type
         or new.preview_mime_type
           is distinct from old.preview_mime_type
         or new.original_size_bytes
           is distinct from old.original_size_bytes
         or new.preview_size_bytes
           is distinct from old.preview_size_bytes
         or new.original_sha256
           is distinct from old.original_sha256
         or new.preview_sha256
           is distinct from old.preview_sha256
         or new.serve_token_sha256
           is distinct from old.serve_token_sha256
         or new.serve_expires_at
           is distinct from old.serve_expires_at
         or new.prepared_at
           is distinct from old.prepared_at then
        raise exception
          'MIRROR_IMAGE_ASSET_IMMUTABLE';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all
on function
  public.guard_line_message_mirror_image_asset_immutable()
from public;

drop trigger if exists
  line_message_mirror_image_assets_immutable_trg
on
  public.line_message_mirror_image_assets;

create trigger
  line_message_mirror_image_assets_immutable_trg
before update
on
  public.line_message_mirror_image_assets
for each row
execute function
  public.guard_line_message_mirror_image_asset_immutable();

create or replace function
  public.ensure_line_message_mirror_image_asset(
    p_queue_id bigint,
    p_lease_token uuid
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue
    public.line_message_mirror_queue%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_asset
    public.line_message_mirror_image_assets%rowtype;

  v_asset_id uuid :=
    gen_random_uuid();
begin
  if p_queue_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_IMAGE_ASSET_ARGUMENT_REQUIRED';
  end if;

  select *
  into v_queue
  from
    public.line_message_mirror_queue
  where id = p_queue_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'QUEUE_NOT_FOUND'
    );
  end if;

  if v_queue.message_type <> 'image' then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'QUEUE_NOT_IMAGE'
    );
  end if;

  if v_queue.status <> 'CLAIMED'
     or v_queue.batch_id is null then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'IMAGE_QUEUE_NOT_CLAIMED'
    );
  end if;

  select *
  into v_lease
  from
    public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_queue.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
          <> p_lease_token
     or v_lease.lease_expires_at
          <= clock_timestamp() then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'LEASE_NOT_OWNED'
    );
  end if;

  select *
  into v_asset
  from
    public.line_message_mirror_image_assets
  where queue_id =
    p_queue_id
  for update;

  if not found then
    insert into
      public.line_message_mirror_image_assets (
        id,
        queue_id,
        original_storage_path,
        preview_storage_path
      )
    values (
      v_asset_id,
      p_queue_id,
      v_asset_id::text
        || '/original',
      v_asset_id::text
        || '/preview'
    )
    returning *
    into v_asset;
  end if;

  return jsonb_build_object(
    'ok',
      true,
    'asset',
      to_jsonb(v_asset)
  );
end;
$$;

create or replace function
  public.mark_line_message_mirror_image_asset_ready(
    p_asset_id uuid,
    p_lease_token uuid,
    p_original_mime_type text,
    p_original_size_bytes bigint,
    p_original_sha256 text,
    p_preview_mime_type text,
    p_preview_size_bytes bigint,
    p_preview_sha256 text,
    p_serve_token_sha256 text,
    p_serve_expires_at timestamptz
  )
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset
    public.line_message_mirror_image_assets%rowtype;

  v_queue
    public.line_message_mirror_queue%rowtype;

  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_original_mime text :=
    lower(trim(p_original_mime_type));

  v_preview_mime text :=
    lower(trim(p_preview_mime_type));

  v_original_hash text :=
    lower(trim(p_original_sha256));

  v_preview_hash text :=
    lower(trim(p_preview_sha256));

  v_token_hash text :=
    lower(trim(p_serve_token_sha256));
begin
  if p_asset_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_IMAGE_READY_ARGUMENT_REQUIRED';
  end if;

  if v_original_mime not in (
       'image/jpeg',
       'image/png'
     )
     or v_preview_mime not in (
       'image/jpeg',
       'image/png'
     ) then
    raise exception
      'MIRROR_IMAGE_MIME_INVALID';
  end if;

  if p_original_size_bytes < 1
     or p_original_size_bytes > 10485760 then
    raise exception
      'MIRROR_IMAGE_ORIGINAL_SIZE_INVALID';
  end if;

  if p_preview_size_bytes < 1
     or p_preview_size_bytes > 1048576 then
    raise exception
      'MIRROR_IMAGE_PREVIEW_SIZE_INVALID';
  end if;

  if v_original_hash
       !~ '^[0-9a-f]{64}$'
     or v_preview_hash
       !~ '^[0-9a-f]{64}$'
     or v_token_hash
       !~ '^[0-9a-f]{64}$' then
    raise exception
      'MIRROR_IMAGE_SHA256_INVALID';
  end if;

  if p_serve_expires_at is null
     or p_serve_expires_at
          < clock_timestamp()
            + interval '26 hours' then
    raise exception
      'MIRROR_IMAGE_SERVE_EXPIRY_TOO_SHORT';
  end if;

  select *
  into v_asset
  from
    public.line_message_mirror_image_assets
  where id =
    p_asset_id
  for update;

  if not found then
    return false;
  end if;

  select *
  into v_queue
  from
    public.line_message_mirror_queue
  where id =
    v_asset.queue_id
  for update;

  if not found
     or v_queue.message_type <> 'image'
     or v_queue.status <> 'CLAIMED'
     or v_queue.batch_id is null then
    return false;
  end if;

  select *
  into v_batch
  from
    public.line_message_mirror_batches
  where id =
    v_queue.batch_id
  for update;

  if not found then
    return false;
  end if;

  select *
  into v_lease
  from
    public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_queue.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
          <> p_lease_token
     or v_lease.lease_expires_at
          <= clock_timestamp() then
    return false;
  end if;

  if v_asset.status = 'DELETED' then
    return false;
  end if;

  if v_asset.status = 'READY'
     and v_batch.prepared_request_body
           is not null then
    if v_asset.original_mime_type =
         v_original_mime
       and v_asset.preview_mime_type =
         v_preview_mime
       and v_asset.original_size_bytes =
         p_original_size_bytes
       and v_asset.preview_size_bytes =
         p_preview_size_bytes
       and v_asset.original_sha256 =
         v_original_hash
       and v_asset.preview_sha256 =
         v_preview_hash
       and v_asset.serve_token_sha256 =
         v_token_hash
       and v_asset.serve_expires_at =
         p_serve_expires_at then
      return true;
    end if;

    raise exception
      'MIRROR_IMAGE_ASSET_READY_IMMUTABLE';
  end if;

  update
    public.line_message_mirror_image_assets
  set
    status =
      'READY',
    original_mime_type =
      v_original_mime,
    original_size_bytes =
      p_original_size_bytes,
    original_sha256 =
      v_original_hash,
    preview_mime_type =
      v_preview_mime,
    preview_size_bytes =
      p_preview_size_bytes,
    preview_sha256 =
      v_preview_hash,
    serve_token_sha256 =
      v_token_hash,
    serve_expires_at =
      p_serve_expires_at,
    prepared_at =
      clock_timestamp(),
    last_error =
      null,
    updated_at =
      clock_timestamp()
  where id =
    p_asset_id;

  return found;
end;
$$;

create or replace function
  public.prepare_line_message_mirror_batch_request(
    p_batch_id uuid,
    p_lease_token uuid,
    p_request_body text,
    p_request_sha256 text
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;

  v_body text :=
    p_request_body;

  v_hash text :=
    lower(trim(p_request_sha256));

  v_actual_hash text;

  v_payload jsonb;

  v_claimed_count integer := 0;

  v_image_count integer := 0;

  v_ready_image_count integer := 0;
begin
  if p_batch_id is null
     or p_lease_token is null
     or v_body is null
     or octet_length(v_body) < 2
     or octet_length(v_body) > 65536
     or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception
      'MIRROR_PREPARE_REQUEST_ARGUMENT_INVALID';
  end if;

  v_actual_hash :=
    encode(
      extensions.digest(
        convert_to(
          v_body,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

  if v_actual_hash <> v_hash then
    raise exception
      'MIRROR_PREPARED_REQUEST_SHA256_MISMATCH';
  end if;

  begin
    v_payload :=
      v_body::jsonb;
  exception
    when others then
      raise exception
        'MIRROR_PREPARED_REQUEST_JSON_INVALID';
  end;

  if jsonb_typeof(v_payload)
       <> 'object'
     or jsonb_typeof(
          v_payload -> 'messages'
        ) <> 'array' then
    raise exception
      'MIRROR_PREPARED_REQUEST_SHAPE_INVALID';
  end if;

  select *
  into v_batch
  from
    public.line_message_mirror_batches
  where id =
    p_batch_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'BATCH_NOT_FOUND'
    );
  end if;

  select *
  into v_lease
  from
    public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_batch.destination_line_group_id
  for update;

  if not found
     or v_lease.lease_token
          <> p_lease_token
     or v_lease.lease_expires_at
          <= clock_timestamp() then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'LEASE_NOT_OWNED'
    );
  end if;

  if v_payload ->> 'to'
       is distinct from
         v_batch.destination_line_group_id then
    raise exception
      'MIRROR_PREPARED_REQUEST_DESTINATION_MISMATCH';
  end if;

  if jsonb_array_length(
       v_payload -> 'messages'
     ) <> v_batch.item_count then
    raise exception
      'MIRROR_PREPARED_REQUEST_ITEM_COUNT_MISMATCH';
  end if;

  if v_batch.prepared_request_body
       is not null then
    if v_batch.prepared_request_body =
         v_body
       and v_batch.prepared_request_sha256 =
         v_hash then
      return jsonb_build_object(
        'ok',
          true,
        'already_prepared',
          true,
        'batch_id',
          v_batch.id,
        'request_body',
          v_batch.prepared_request_body,
        'request_sha256',
          v_batch.prepared_request_sha256,
        'prepared_at',
          v_batch.prepared_at
      );
    end if;

    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'PREPARED_REQUEST_MISMATCH'
    );
  end if;

  if v_batch.status not in (
       'PREPARING',
       'FAILED'
     ) then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'INVALID_BATCH_STATE'
    );
  end if;

  select
    count(*)::integer
  into
    v_claimed_count
  from
    public.line_message_mirror_queue q
  where q.batch_id =
      p_batch_id
    and q.status =
      'CLAIMED';

  if v_claimed_count
       <> v_batch.item_count then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'BATCH_ITEM_STATE_MISMATCH',
      'expected_item_count',
        v_batch.item_count,
      'claimed_item_count',
        v_claimed_count
    );
  end if;

  select
    count(*)::integer
  into
    v_image_count
  from
    public.line_message_mirror_queue q
  where q.batch_id =
      p_batch_id
    and q.status =
      'CLAIMED'
    and q.message_type =
      'image';

  select
    count(*)::integer
  into
    v_ready_image_count
  from
    public.line_message_mirror_queue q
  join
    public.line_message_mirror_image_assets a
      on a.queue_id =
        q.id
  where q.batch_id =
      p_batch_id
    and q.status =
      'CLAIMED'
    and q.message_type =
      'image'
    and a.status =
      'READY'
    and a.serve_expires_at >
      clock_timestamp()
        + interval '25 hours';

  if v_ready_image_count
       <> v_image_count then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'IMAGE_ASSET_NOT_READY',
      'image_count',
        v_image_count,
      'ready_image_count',
        v_ready_image_count
    );
  end if;

  update
    public.line_message_mirror_batches
  set
    prepared_request_body =
      v_body,
    prepared_request_sha256 =
      v_hash,
    prepared_at =
      clock_timestamp()
  where id =
    p_batch_id
    and prepared_request_body
      is null
  returning *
  into v_batch;

  if not found then
    raise exception
      'MIRROR_PREPARED_REQUEST_STATE_CHANGED';
  end if;

  return jsonb_build_object(
    'ok',
      true,
    'already_prepared',
      false,
    'batch_id',
      v_batch.id,
    'request_body',
      v_batch.prepared_request_body,
    'request_sha256',
      v_batch.prepared_request_sha256,
    'prepared_at',
      v_batch.prepared_at
  );
end;
$$;

create or replace function
  public.get_line_message_mirror_prepared_request(
    p_batch_id uuid,
    p_lease_token uuid
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch
    public.line_message_mirror_batches%rowtype;

  v_lease
    public.line_message_mirror_destination_leases%rowtype;
begin
  if p_batch_id is null
     or p_lease_token is null then
    raise exception
      'MIRROR_PREPARED_REQUEST_ARGUMENT_REQUIRED';
  end if;

  select *
  into v_batch
  from
    public.line_message_mirror_batches
  where id =
    p_batch_id;

  if not found then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'BATCH_NOT_FOUND'
    );
  end if;

  select *
  into v_lease
  from
    public.line_message_mirror_destination_leases
  where destination_line_group_id =
    v_batch.destination_line_group_id;

  if not found
     or v_lease.lease_token
          <> p_lease_token
     or v_lease.lease_expires_at
          <= clock_timestamp() then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'LEASE_NOT_OWNED'
    );
  end if;

  if v_batch.prepared_request_body
       is null then
    return jsonb_build_object(
      'ok',
        false,
      'reason',
        'REQUEST_NOT_PREPARED'
    );
  end if;

  return jsonb_build_object(
    'ok',
      true,
    'batch_id',
      v_batch.id,
    'request_body',
      v_batch.prepared_request_body,
    'request_sha256',
      v_batch.prepared_request_sha256,
    'prepared_at',
      v_batch.prepared_at,
    'retry_key',
      v_batch.retry_key
  );
end;
$$;

revoke all
on function
  public.ensure_line_message_mirror_image_asset(
    bigint,
    uuid
  )
from
  public,
  anon,
  authenticated;

revoke all
on function
  public.mark_line_message_mirror_image_asset_ready(
    uuid,
    uuid,
    text,
    bigint,
    text,
    text,
    bigint,
    text,
    text,
    timestamptz
  )
from
  public,
  anon,
  authenticated;

revoke all
on function
  public.prepare_line_message_mirror_batch_request(
    uuid,
    uuid,
    text,
    text
  )
from
  public,
  anon,
  authenticated;

revoke all
on function
  public.get_line_message_mirror_prepared_request(
    uuid,
    uuid
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.ensure_line_message_mirror_image_asset(
    bigint,
    uuid
  )
to service_role;

grant execute
on function
  public.mark_line_message_mirror_image_asset_ready(
    uuid,
    uuid,
    text,
    bigint,
    text,
    text,
    bigint,
    text,
    text,
    timestamptz
  )
to service_role;

grant execute
on function
  public.prepare_line_message_mirror_batch_request(
    uuid,
    uuid,
    text,
    text
  )
to service_role;

grant execute
on function
  public.get_line_message_mirror_prepared_request(
    uuid,
    uuid
  )
to service_role;

comment on table
  public.line_message_mirror_image_assets
is
  'Private retry-stable image assets for LINE Message Mirror. Separate from Review image lifecycle.';

comment on column
  public.line_message_mirror_batches.prepared_request_body
is
  'Exact immutable LINE Push JSON body reused across every retry for this batch.';

comment on column
  public.line_message_mirror_batches.prepared_request_sha256
is
  'Lowercase SHA-256 of the exact persisted LINE Push request body.';

comment on column
  public.line_message_mirror_image_assets.serve_token_sha256
is
  'SHA-256 of the opaque capability token embedded in the persisted image URLs. Plain token is not stored here.';

comment on column
  public.line_message_mirror_image_assets.serve_expires_at
is
  'Stable serving horizon for original and preview image URLs; must cover the LINE retry window.';
