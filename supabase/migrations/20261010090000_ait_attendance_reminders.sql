-- Apps in Toss recipient keys and reminder claims for the attendance reminder.
-- See docs/specs/2026-10-10-ait-attendance-reminder.md.

create table public.application_toss_recipients (
  application_id uuid primary key references public.applications(id) on delete cascade,
  -- PostgreSQL regex bounds stop at 255, so the length is checked separately.
  anon_key text not null check (
    char_length(anon_key) between 1 and 512
    and anon_key ~ '^[\x21-\x7e]+$'
  ),
  created_at timestamptz not null default now()
);

alter table public.application_toss_recipients enable row level security;
revoke all on table public.application_toss_recipients from public, anon, authenticated;

create table public.attendance_reminders (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null check (kind in ('day_before')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  result text check (result in ('sent', 'failed')),
  failure_code text check (failure_code is null or char_length(failure_code) <= 200),
  unique (application_id, kind),
  check (
    (result is null and sent_at is null)
    or (result = 'sent' and sent_at is not null)
    or (result = 'failed' and sent_at is null)
  )
);

alter table public.attendance_reminders enable row level security;
revoke all on table public.attendance_reminders from public, anon, authenticated;

-- Locks the application, re-checks the reminder rule, and claims or reclaims
-- the reminder row. Only explicit failures are reclaimed, up to three attempts.
create function public.claim_attendance_reminder(
  p_application_id uuid,
  p_kind text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application public.applications%rowtype;
  target_opportunity public.opportunities%rowtype;
  recipient_key text;
  claimed public.attendance_reminders%rowtype;
begin
  if p_application_id is null or p_now is null
    or p_kind is distinct from 'day_before' then
    raise exception using errcode = '22023', message = 'Invalid reminder claim.';
  end if;

  select application.* into target_application
  from public.applications application
  where application.id = p_application_id
  for update;

  if not found
    or target_application.submission_state <> 'submitted'
    or target_application.selected_at is null then
    return null;
  end if;

  select opportunity.* into target_opportunity
  from public.opportunities opportunity
  where opportunity.id = target_application.opportunity_id;

  if target_opportunity.starts_at <= p_now
    or target_opportunity.starts_at > p_now + interval '24 hours' then
    return null;
  end if;

  select recipient.anon_key into recipient_key
  from public.application_toss_recipients recipient
  where recipient.application_id = target_application.id;

  if recipient_key is null or exists (
    select 1
    from public.attendance_events event
    where event.application_id = target_application.id
      and event.event_type in (
        'applicant_confirmed',
        'applicant_cancelled',
        'recruiter_cancelled',
        'completed',
        'applicant_no_show',
        'recruiter_no_show'
      )
  ) then
    return null;
  end if;

  insert into public.attendance_reminders (application_id, kind, claimed_at)
  values (target_application.id, p_kind, p_now)
  on conflict (application_id, kind) do update
  set
    attempt_count = public.attendance_reminders.attempt_count + 1,
    claimed_at = excluded.claimed_at,
    result = null,
    failure_code = null
  where public.attendance_reminders.result = 'failed'
    and public.attendance_reminders.attempt_count < 3
  returning * into claimed;

  if claimed.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'reminderId', claimed.id,
    'attemptCount', claimed.attempt_count,
    'anonKey', recipient_key,
    'startsAt', target_opportunity.starts_at,
    'venueDistrict', target_opportunity.venue_district
  );
end;
$$;

revoke all on function public.claim_attendance_reminder(uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_attendance_reminder(uuid, text, timestamptz)
to service_role;

-- A recipient key has no use once the appointment starts.
create function public.delete_started_toss_recipients(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  deleted_count integer;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'Invalid recipient cleanup time.';
  end if;

  delete from public.application_toss_recipients recipient
  using public.applications application, public.opportunities opportunity
  where application.id = recipient.application_id
    and opportunity.id = application.opportunity_id
    and opportunity.starts_at <= p_now;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_started_toss_recipients(timestamptz)
from public, anon, authenticated;
grant execute on function public.delete_started_toss_recipients(timestamptz)
to service_role;

-- Unselection is refused once a reminder is claimed; the recruiter records
-- recruiter_cancelled instead.
create or replace function public.unselect_application_for_recruiter(
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
  target_opportunity public.opportunities%rowtype;
  target_application public.applications%rowtype;
begin
  select opportunity.* into target_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.recruiter_id = p_recruiter_id
  for share;

  if not found then
    return null;
  end if;

  select application.* into target_application
  from public.applications application
  where application.id = p_application_id
    and application.opportunity_id = p_opportunity_id
    and application.selected_by = p_recruiter_id
  for update;

  if not found or target_opportunity.status <> 'published'
    or target_opportunity.closed_at is not null
    or target_opportunity.closes_at <= clock_timestamp()
    or target_opportunity.starts_at <= clock_timestamp()
    or exists (
    select 1 from public.attendance_events event
    where event.application_id = p_application_id
  ) or exists (
    select 1 from public.attendance_reminders reminder
    where reminder.application_id = p_application_id
  ) then
    return null;
  end if;

  update public.applications application
  set selected_at = null,
      selected_by = null
  where application.id = target_application.id;

  return jsonb_build_object('applicationId', target_application.id);
end;
$$;

revoke all on function public.unselect_application_for_recruiter(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.unselect_application_for_recruiter(uuid, uuid, uuid)
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

  delete from public.application_toss_recipients recipient
  where recipient.application_id = target_application.id;

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
