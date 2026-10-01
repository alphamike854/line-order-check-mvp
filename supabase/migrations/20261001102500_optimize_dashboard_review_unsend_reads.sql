-- Dashboard Read Fanout Optimization V1
--
-- Replace Dashboard-side message-ID fanout for:
--   1. OPEN Review count
--   2. current-Round UNSEND feed
--
-- Both functions are read-only and preserve immutable
-- summary_group_round_id ownership.

begin;

create or replace function
  public.dashboard_open_review_count(
    p_round_ids uuid[],
    p_summary_group_id text default null,
    p_settlement_session_id uuid default null
  )
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint
  from
    public.review_items review
  join
    public.messages message
      on message.id =
        review.message_record_id
  where
    review.status = 'OPEN'

    and message.summary_group_round_id =
      any(
        coalesce(
          p_round_ids,
          array[]::uuid[]
        )
      )

    and (
      p_settlement_session_id is null
      or message.settlement_session_id =
        p_settlement_session_id
    )

    and (
      nullif(
        trim(
          coalesce(
            p_summary_group_id,
            ''
          )
        ),
        ''
      ) is null

      or message.summary_group_id =
        trim(p_summary_group_id)
    );
$$;


create or replace function
  public.dashboard_round_unsends(
    p_round_ids uuid[],
    p_summary_group_id text default null,
    p_limit integer default 500
  )
returns table (
  id uuid,
  message_id text,
  line_group_id text,
  user_id text,
  matched_message_record_id uuid,
  derived_qty_total integer,
  unsent_at timestamptz,
  created_at timestamptz,
  line_group_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    unsend.id,
    unsend.message_id,
    unsend.line_group_id,
    unsend.user_id,
    unsend.matched_message_record_id,
    unsend.derived_qty_total,
    unsend.unsent_at,
    unsend.created_at,

    coalesce(
      line_group.line_group_name,
      unsend.line_group_id
    )::text
      as line_group_name

  from
    public.unsend_events unsend

  join
    public.messages message
      on message.id =
        unsend.matched_message_record_id

  left join
    public.line_groups line_group
      on line_group.line_group_id =
        unsend.line_group_id

  where
    message.summary_group_round_id =
      any(
        coalesce(
          p_round_ids,
          array[]::uuid[]
        )
      )

    and (
      nullif(
        trim(
          coalesce(
            p_summary_group_id,
            ''
          )
        ),
        ''
      ) is null

      or message.summary_group_id =
        trim(p_summary_group_id)
    )

  order by
    coalesce(
      unsend.unsent_at,
      unsend.created_at
    ) desc,
    unsend.id desc

  limit greatest(
    1,
    least(
      coalesce(
        p_limit,
        500
      ),
      500
    )
  );
$$;


revoke all
on function
  public.dashboard_open_review_count(
    uuid[],
    text,
    uuid
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.dashboard_open_review_count(
    uuid[],
    text,
    uuid
  )
to
  service_role;


revoke all
on function
  public.dashboard_round_unsends(
    uuid[],
    text,
    integer
  )
from
  public,
  anon,
  authenticated;

grant execute
on function
  public.dashboard_round_unsends(
    uuid[],
    text,
    integer
  )
to
  service_role;

commit;
