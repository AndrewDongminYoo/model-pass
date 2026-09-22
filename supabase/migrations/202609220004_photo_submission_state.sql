alter table public.applications
  add column submission_state text not null default 'submitted'
  check (submission_state in ('pending_photo', 'submitted'));

create index applications_submitted_opportunity_created_idx
  on public.applications(opportunity_id, created_at, id)
  where submission_state = 'submitted';

create or replace function public.application_requires_photo(
  p_rules_snapshot jsonb,
  p_evaluation_snapshot jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from jsonb_array_elements(p_rules_snapshot) as rule
    join jsonb_array_elements(p_evaluation_snapshot -> 'reviews') as outcome
      on outcome ->> 'ruleId' = rule ->> 'id'
    where lower(rule ->> 'field') like '%photo%'
      and rule ->> 'effect' = 'needs_review'
      and outcome ->> 'effect' = 'needs_review'
  );
$$;

revoke all on function public.application_requires_photo(jsonb, jsonb)
from public, anon, authenticated;

create or replace function public.set_application_submission_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.submission_state := case
    when public.application_requires_photo(
      new.rules_snapshot,
      new.evaluation_snapshot
    ) then 'pending_photo'
    else 'submitted'
  end;
  return new;
end;
$$;

revoke all on function public.set_application_submission_state()
from public, anon, authenticated;

create trigger set_application_submission_state_before_insert
before insert on public.applications
for each row execute function public.set_application_submission_state();

create or replace function public.finalize_application_photo(
  p_photo_id uuid,
  p_application_id uuid,
  p_opportunity_id uuid,
  p_submission_attempt_id uuid,
  p_storage_path text,
  p_content_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application public.applications%rowtype;
  target_opportunity public.opportunities%rowtype;
  target_reservation public.application_photo_upload_reservations%rowtype;
  existing_photo public.application_photos%rowtype;
begin
  select *
  into target_application
  from public.applications
  where id = p_application_id
    and opportunity_id = p_opportunity_id
    and submission_attempt_id = p_submission_attempt_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Application not found.';
  end if;

  if not public.application_requires_photo(
    target_application.rules_snapshot,
    target_application.evaluation_snapshot
  ) then
    raise exception using
      errcode = '22023',
      message = 'This application does not require a photo.';
  end if;

  if target_application.submission_state = 'submitted' then
    select *
    into existing_photo
    from public.application_photos
    where id = p_photo_id
      and application_id = p_application_id
      and storage_path = p_storage_path
      and content_type = p_content_type
      and byte_size = p_byte_size;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'Application photo finalization does not match the completed upload.';
    end if;

    return jsonb_build_object(
      'applicationId', p_application_id,
      'photoId', p_photo_id,
      'submissionState', 'submitted'
    );
  end if;

  select *
  into target_opportunity
  from public.opportunities
  where id = p_opportunity_id
    and status = 'published'
  for share;

  if not found
    or target_opportunity.closed_at is not null
    or target_opportunity.closes_at <= now() then
    raise exception using errcode = '22023', message = 'Photo uploads are closed.';
  end if;

  select *
  into target_reservation
  from public.application_photo_upload_reservations
  where id = p_photo_id
    and application_id = p_application_id
    and storage_path = p_storage_path
    and content_type = p_content_type
    and byte_size = p_byte_size
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Photo upload reservation does not match.';
  end if;

  insert into public.application_photos (
    id,
    application_id,
    storage_path,
    content_type,
    byte_size,
    expires_at
  ) values (
    p_photo_id,
    p_application_id,
    p_storage_path,
    p_content_type,
    p_byte_size,
    target_opportunity.closes_at + interval '30 days'
  );

  delete from public.application_photo_upload_reservations
  where id = p_photo_id;

  update public.applications
  set submission_state = 'submitted'
  where id = p_application_id;

  return jsonb_build_object(
    'applicationId', p_application_id,
    'photoId', p_photo_id,
    'submissionState', 'submitted'
  );
end;
$$;

revoke all on function public.finalize_application_photo(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) from public, anon, authenticated;

grant execute on function public.finalize_application_photo(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) to service_role;

create or replace function public.reset_photo_retention_after_closure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.closed_at is not null and new.closed_at is distinct from old.closed_at then
    update public.application_photos
    set expires_at = new.closed_at + interval '30 days'
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

create trigger reset_photo_retention_after_closure
after update of closed_at on public.opportunities
for each row execute function public.reset_photo_retention_after_closure();

drop policy "Recruiters can read applications for owned opportunities"
on public.applications;
create policy "Recruiters can read applications for owned opportunities"
on public.applications
for select
to authenticated
using (
  submission_state = 'submitted'
  and exists (
    select 1
    from public.opportunities
    where opportunities.id = applications.opportunity_id
      and opportunities.recruiter_id = (select auth.uid())
  )
);

drop policy "Recruiters can read answers for owned opportunities"
on public.application_answers;
create policy "Recruiters can read answers for owned opportunities"
on public.application_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = application_answers.application_id
      and applications.submission_state = 'submitted'
      and opportunities.recruiter_id = (select auth.uid())
  )
);

drop policy "Recruiters can read photos for owned opportunities"
on public.application_photos;
create policy "Recruiters can read photos for owned opportunities"
on public.application_photos
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = application_photos.application_id
      and applications.submission_state = 'submitted'
      and opportunities.recruiter_id = (select auth.uid())
  )
);

drop policy "Recruiters can read attendance for owned opportunities"
on public.attendance_events;
create policy "Recruiters can read attendance for owned opportunities"
on public.attendance_events
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = attendance_events.application_id
      and applications.submission_state = 'submitted'
      and opportunities.recruiter_id = (select auth.uid())
  )
);

drop policy "Recruiters can read consents for owned opportunities"
on public.consent_events;
create policy "Recruiters can read consents for owned opportunities"
on public.consent_events
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = consent_events.application_id
      and applications.submission_state = 'submitted'
      and opportunities.recruiter_id = (select auth.uid())
      and consent_events.consent_type = 'current_application'
  )
);
