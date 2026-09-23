create function public.delete_expired_anonymous_request_quota(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  deleted_count integer;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'Invalid cleanup time.';
  end if;

  delete from public.anonymous_request_quota
  where bucket_start <= date_trunc('hour', p_now) - interval '24 hours';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_anonymous_request_quota(timestamptz)
from public, anon, authenticated;
grant execute on function public.delete_expired_anonymous_request_quota(timestamptz)
to service_role;
