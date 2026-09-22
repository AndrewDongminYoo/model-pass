create table public.applicant_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  action text not null check (
    action in ('revoke_future_opportunity_consent', 'request_deletion')
  ),
  status text not null check (
    (action = 'revoke_future_opportunity_consent' and status = 'accepted')
    or (action = 'request_deletion' and status = 'pending')
  ),
  requested_at timestamptz not null default now(),
  unique (application_id, action)
);

alter table public.applicant_privacy_requests enable row level security;

revoke all on table public.applicant_privacy_requests
from public, anon, authenticated, service_role;
grant select on table public.applicant_privacy_requests to service_role;

create table public.applicant_privacy_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.applicant_privacy_requests(id) on delete restrict,
  event_type text not null check (event_type in ('pending', 'fulfilled')),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (request_id, event_type)
);

alter table public.applicant_privacy_request_events enable row level security;

revoke all on table public.applicant_privacy_request_events
from public, anon, authenticated, service_role;
grant select on table public.applicant_privacy_request_events to service_role;

alter table public.applications
  alter column applicant_display_name drop not null,
  alter column applicant_phone drop not null,
  alter column applicant_birth_date drop not null;

create or replace function public.prevent_consent_history_mutation()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' or exists (
    select 1
    from public.applications application
    where application.id = old.application_id
  ) then
    raise exception using errcode = 'P0001', message = 'Consent history is append-only.';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_consent_history_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_consent_history_mutation
before update or delete on public.consent_events
for each row execute function public.prevent_consent_history_mutation();

revoke update, delete on table public.consent_events from service_role;

create or replace function public.prevent_applicant_privacy_request_mutation()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'Applicant privacy requests are append-only.';
end;
$$;

revoke all on function public.prevent_applicant_privacy_request_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_applicant_privacy_request_mutation
before update or delete on public.applicant_privacy_requests
for each row execute function public.prevent_applicant_privacy_request_mutation();

create or replace function public.prevent_applicant_privacy_request_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'Applicant privacy request events are append-only.';
end;
$$;

revoke all on function public.prevent_applicant_privacy_request_event_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_applicant_privacy_request_event_mutation
before update or delete on public.applicant_privacy_request_events
for each row execute function public.prevent_applicant_privacy_request_event_mutation();

create or replace function public.manage_applicant_privacy(
  p_application_id uuid,
  p_opportunity_id uuid,
  p_submission_attempt_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  request_status text;
  inserted_request_id uuid;
  deletion_request_id uuid;
begin
  if p_action not in (
    'revoke_future_opportunity_consent',
    'request_deletion'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported privacy action.';
  end if;

  perform 1
  from public.applications application
  where application.id = p_application_id
    and application.opportunity_id = p_opportunity_id
    and application.submission_attempt_id = p_submission_attempt_id
    and application.submission_state = 'submitted'
  for share;

  if not found then
    return null;
  end if;

  request_status := case p_action
    when 'revoke_future_opportunity_consent' then 'accepted'
    else 'pending'
  end;

  insert into public.applicant_privacy_requests (
    application_id,
    action,
    status
  ) values (
    p_application_id,
    p_action,
    request_status
  )
  on conflict (application_id, action) do nothing
  returning id into inserted_request_id;

  if p_action = 'request_deletion' then
    select request.id into deletion_request_id
    from public.applicant_privacy_requests request
    where request.application_id = p_application_id
      and request.action = 'request_deletion';

    insert into public.applicant_privacy_request_events (
      request_id,
      event_type
    ) values (
      deletion_request_id,
      'pending'
    ) on conflict (request_id, event_type) do nothing;
  end if;

  if inserted_request_id is not null
    and p_action = 'revoke_future_opportunity_consent' then
    insert into public.consent_events (
      application_id,
      consent_type,
      granted
    ) values (
      p_application_id,
      'future_opportunity',
      false
    );
  end if;

  return jsonb_build_object('action', p_action, 'status', request_status);
end;
$$;

revoke all on function public.manage_applicant_privacy(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.manage_applicant_privacy(uuid, uuid, uuid, text)
to service_role;

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

  if target_opportunity.status <> 'closed'
    or target_opportunity.closed_at is null
    or target_opportunity.closed_at > now() - interval '30 days' then
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
begin
  if p_actor_party = 'applicant' then
    perform 1
    from public.applications application
    where application.id = p_application_id
      and application.submission_attempt_id = p_submission_attempt_id
      and application.submission_state = 'submitted'
    for update;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'Applicant attendance capability is invalid.';
    end if;
  elsif p_submission_attempt_id is not null then
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

revoke execute on function public.record_attendance_event(
  uuid, text, uuid, text, text, uuid, text, timestamptz
) from service_role;
revoke all on function public.record_attendance_event_authorized(
  uuid, text, uuid, text, text, uuid, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.record_attendance_event_authorized(
  uuid, text, uuid, text, text, uuid, text, timestamptz, uuid
) to service_role;
