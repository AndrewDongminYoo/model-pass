create or replace function public.reset_photo_retention_after_closure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.closed_at is not null and new.closed_at is distinct from old.closed_at then
    update public.application_photos
    set expires_at = least(
      application_photos.expires_at,
      new.closed_at + interval '30 days'
    )
    where application_id in (
      select id
      from public.applications
      where opportunity_id = new.id
    );
  end if;
  return new;
end;
$$;

revoke all on function public.reset_photo_retention_after_closure()
from public, anon, authenticated;
