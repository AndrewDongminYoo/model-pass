alter table public.anonymous_request_quota
  add column submission_attempt_ids uuid[] not null default '{}'::uuid[];

create function public.consume_anonymous_submission_quota(
  p_opportunity_id uuid,
  p_source_hash text,
  p_limit integer,
  p_submission_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  accepted_count integer;
begin
  if p_opportunity_id is null or p_submission_attempt_id is null
    or p_source_hash is null or p_limit is null
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Invalid quota request.';
  end if;

  delete from public.anonymous_request_quota
  where bucket_start < date_trunc('hour', now()) - interval '24 hours';

  insert into public.anonymous_request_quota (
    opportunity_id, action, source_hash, bucket_start, request_count,
    submission_attempt_ids
  ) values (
    p_opportunity_id, 'submit_application', p_source_hash,
    date_trunc('hour', now()), 1, array[p_submission_attempt_id]
  )
  on conflict (opportunity_id, action, source_hash, bucket_start)
  do update set
    request_count = case
      when p_submission_attempt_id = any(public.anonymous_request_quota.submission_attempt_ids)
        then public.anonymous_request_quota.request_count
      else public.anonymous_request_quota.request_count + 1
    end,
    submission_attempt_ids = case
      when p_submission_attempt_id = any(public.anonymous_request_quota.submission_attempt_ids)
        then public.anonymous_request_quota.submission_attempt_ids
      else array_append(public.anonymous_request_quota.submission_attempt_ids, p_submission_attempt_id)
    end
  where p_submission_attempt_id = any(public.anonymous_request_quota.submission_attempt_ids)
    or public.anonymous_request_quota.request_count < p_limit
  returning request_count into accepted_count;

  return accepted_count is not null;
end;
$$;

revoke all on function public.consume_anonymous_submission_quota(uuid, text, integer, uuid)
from public, anon, authenticated;
grant execute on function public.consume_anonymous_submission_quota(uuid, text, integer, uuid)
to service_role;
