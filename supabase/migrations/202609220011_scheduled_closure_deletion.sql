create or replace function public.fulfill_applicant_deletion_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_request public.applicant_privacy_requests%rowtype;
  target_application public.applications%rowtype;
  target_opportunity public.opportunities%rowtype;
  effective_closed_at timestamptz;
  fulfilled_event public.applicant_privacy_request_events%rowtype;
begin
  select * into target_request
  from public.applicant_privacy_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Deletion request not found.';
  end if;
  if target_request.action <> 'request_deletion' then
    raise exception using errcode = '22023', message = 'Request is not a deletion request.';
  end if;

  select * into fulfilled_event
  from public.applicant_privacy_request_events event
  where event.request_id = target_request.id
    and event.event_type = 'fulfilled';

  if found then
    return jsonb_build_object(
      'requestId', target_request.id,
      'applicationId', target_request.application_id,
      'eventId', fulfilled_event.id,
      'status', 'fulfilled'
    );
  end if;

  select * into target_application
  from public.applications application
  where application.id = target_request.application_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Application not found.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('photo-cleanup:' || target_application.id::text, 0)
  );

  select * into target_opportunity
  from public.opportunities opportunity
  where opportunity.id = target_application.opportunity_id
  for share;

  effective_closed_at := case
    when target_opportunity.closed_at is not null then target_opportunity.closed_at
    when target_opportunity.status = 'published'
      and target_opportunity.closes_at <= now() then target_opportunity.closes_at
    else null
  end;

  if effective_closed_at is null
    or effective_closed_at > now() - interval '30 days' then
    raise exception using
      errcode = '55000',
      message = 'Deletion request is not eligible until 30 days after closure.';
  end if;

  if exists (
    select 1
    from public.retention_holds hold
    where hold.application_id = target_application.id
      and hold.released_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'Deletion request is blocked by an active retention hold.';
  end if;

  if exists (
    select 1
    from public.application_photos photo
    where photo.application_id = target_application.id
      and photo.deleted_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'Deletion request is blocked until all application photos are deleted.';
  end if;

  delete from public.application_answers answer
  where answer.application_id = target_application.id;

  update public.applications application
  set
    submission_attempt_id = gen_random_uuid(),
    submission_fingerprint = encode(extensions.gen_random_bytes(32), 'hex'),
    applicant_display_name = null,
    applicant_phone = null,
    applicant_birth_date = null,
    evaluation_snapshot = jsonb_build_object(
      'rulesetId', target_application.ruleset_id,
      'rulesetVersion', target_application.ruleset_version,
      'eligible', target_application.evaluation_snapshot -> 'eligible',
      'failures', '[]'::jsonb,
      'reviews', '[]'::jsonb,
      'reminders', '[]'::jsonb
    )
  where application.id = target_application.id;

  insert into public.applicant_privacy_request_events (
    request_id,
    event_type
  ) values (
    target_request.id,
    'fulfilled'
  ) returning * into fulfilled_event;

  return jsonb_build_object(
    'requestId', target_request.id,
    'applicationId', target_request.application_id,
    'eventId', fulfilled_event.id,
    'status', 'fulfilled'
  );
end;
$$;

revoke all on function public.fulfill_applicant_deletion_request(uuid)
from public, anon, authenticated;
grant execute on function public.fulfill_applicant_deletion_request(uuid)
to service_role;
