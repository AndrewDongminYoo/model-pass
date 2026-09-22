alter table public.applications
  add column selected_at timestamptz,
  add column selected_by uuid references auth.users(id) on delete restrict,
  add constraint applications_selection_complete check (
    (selected_at is null and selected_by is null)
    or (selected_at is not null and selected_by is not null)
  );

create or replace function public.select_application_for_recruiter(
  p_application_id uuid,
  p_opportunity_id uuid,
  p_recruiter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  selected_application public.applications%rowtype;
begin
  update public.applications application
  set
    selected_at = coalesce(application.selected_at, now()),
    selected_by = coalesce(application.selected_by, p_recruiter_id)
  from public.opportunities opportunity
  where application.id = p_application_id
    and application.opportunity_id = p_opportunity_id
    and application.submission_state = 'submitted'
    and opportunity.id = application.opportunity_id
    and opportunity.recruiter_id = p_recruiter_id
  returning application.* into selected_application;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'applicationId', selected_application.id,
    'selectedAt', selected_application.selected_at
  );
end;
$$;

revoke all on function public.select_application_for_recruiter(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.select_application_for_recruiter(uuid, uuid, uuid)
to service_role;

create or replace function public.record_attendance_event_authorized(
  p_application_id uuid,
  p_actor_party text,
  p_recorded_by uuid,
  p_event_type text,
  p_party text,
  p_related_event_id uuid default null,
  p_resolution text default null,
  p_occurred_at timestamptz default null,
  p_submission_attempt_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application public.applications%rowtype;
begin
  select * into target_application
  from public.applications application
  where application.id = p_application_id
    and application.submission_state = 'submitted'
  for update;

  if not found or target_application.selected_at is null then
    raise exception using
      errcode = '42501',
      message = 'Attendance is unavailable until recruiter selection.';
  end if;

  if p_actor_party = 'applicant'
    and target_application.submission_attempt_id is distinct from p_submission_attempt_id then
    raise exception using
      errcode = '42501',
      message = 'Applicant attendance capability is invalid.';
  elsif p_actor_party <> 'applicant' and p_submission_attempt_id is not null then
    raise exception using
      errcode = '22023',
      message = 'Attendance capability is valid only for an applicant.';
  end if;

  return public.record_attendance_event(
    p_application_id,
    p_actor_party,
    p_recorded_by,
    p_event_type,
    p_party,
    p_related_event_id,
    p_resolution,
    p_occurred_at
  );
end;
$$;

revoke all on function public.record_attendance_event_authorized(
  uuid, text, uuid, text, text, uuid, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.record_attendance_event_authorized(
  uuid, text, uuid, text, text, uuid, text, timestamptz, uuid
) to service_role;
