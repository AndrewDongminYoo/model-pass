create function public.reject_late_attendance_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  appointment_starts_at timestamptz;
begin
  if new.event_type not in ('recruiter_cancelled', 'applicant_cancelled') then
    return new;
  end if;

  select opportunity.starts_at into appointment_starts_at
  from public.applications application
  join public.opportunities opportunity on opportunity.id = application.opportunity_id
  where application.id = new.application_id;

  if appointment_starts_at is not null and clock_timestamp() >= appointment_starts_at then
    raise exception using
      errcode = '22023',
      message = 'Attendance cancellation is only available before the appointment.';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_late_attendance_cancellation()
from public, anon, authenticated, service_role;

create trigger reject_late_attendance_cancellation
before insert on public.attendance_events
for each row execute function public.reject_late_attendance_cancellation();

drop policy "Recruiters can create owned opportunities" on public.opportunities;
drop policy "Recruiters can update owned opportunities" on public.opportunities;

revoke insert, update on table public.opportunities from anon, authenticated;
grant select on table public.opportunities to authenticated;
grant select, insert, update on table public.opportunities to service_role;
grant select on table public.application_answers, public.application_photos,
  public.attendance_events, public.consent_events to authenticated;
grant select on table public.applications, public.application_answers,
  public.application_photos, public.attendance_events, public.consent_events
  to service_role;

alter table public.opportunities
  add constraint opportunities_closure_consistent check (
    (status = 'closed' and closed_at is not null)
    or (status in ('draft', 'published') and closed_at is null)
  );

create function public.preserve_opportunity_closure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.status = 'closed' and (
    new.status <> 'closed' or
    new.closed_at is null or
    new.closed_at > old.closed_at
  ) then
    raise exception using
      errcode = '22023',
      message = 'An opportunity closure cannot be reversed or delayed.';
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_opportunity_closure()
from public, anon, authenticated, service_role;

create trigger preserve_opportunity_closure
before update on public.opportunities
for each row execute function public.preserve_opportunity_closure();

create function public.publish_opportunity_for_recruiter(
  p_recruiter_id uuid,
  p_category text,
  p_title text,
  p_starts_at timestamptz,
  p_closes_at timestamptz,
  p_venue_district text,
  p_expected_minutes integer,
  p_benefit jsonb,
  p_ruleset_id text,
  p_ruleset_version integer,
  p_rules_snapshot jsonb,
  p_confirmed_hard_rule_ids jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  new_opportunity_id uuid;
begin
  if p_closes_at <= clock_timestamp() or p_starts_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'Opportunity dates must be in the future.';
  end if;

  insert into public.opportunities (
    recruiter_id, category, title, starts_at, closes_at,
    venue_district, expected_minutes, benefit, status, ruleset_id,
    ruleset_version, rules_snapshot, confirmed_hard_rule_ids
  ) values (
    p_recruiter_id, p_category, p_title, p_starts_at, p_closes_at,
    p_venue_district, p_expected_minutes, p_benefit, 'published', p_ruleset_id,
    p_ruleset_version, p_rules_snapshot, p_confirmed_hard_rule_ids
  ) returning id into new_opportunity_id;

  return new_opportunity_id;
end;
$$;

revoke all on function public.publish_opportunity_for_recruiter(
  uuid, text, text, timestamptz, timestamptz, text, integer, jsonb,
  text, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_opportunity_for_recruiter(
  uuid, text, text, timestamptz, timestamptz, text, integer, jsonb,
  text, integer, jsonb, jsonb
) to service_role;

create function public.close_opportunity_for_recruiter(
  p_opportunity_id uuid,
  p_recruiter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  closed_opportunity public.opportunities%rowtype;
begin
  update public.opportunities opportunity
  set status = 'closed',
      closed_at = least(clock_timestamp(), opportunity.closes_at),
      updated_at = clock_timestamp()
  where opportunity.id = p_opportunity_id
    and opportunity.recruiter_id = p_recruiter_id
    and opportunity.status = 'published'
    and opportunity.closed_at is null
  returning opportunity.* into closed_opportunity;

  if not found then
    select opportunity.* into closed_opportunity
    from public.opportunities opportunity
    where opportunity.id = p_opportunity_id
      and opportunity.recruiter_id = p_recruiter_id
      and opportunity.status = 'closed';
    if not found then
      return null;
    end if;
  end if;

  return jsonb_build_object(
    'opportunityId', closed_opportunity.id,
    'status', closed_opportunity.status,
    'closedAt', closed_opportunity.closed_at
  );
end;
$$;

revoke all on function public.close_opportunity_for_recruiter(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.close_opportunity_for_recruiter(uuid, uuid)
to service_role;

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
  target_opportunity public.opportunities%rowtype;
  selected_application public.applications%rowtype;
begin
  select opportunity.* into target_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.recruiter_id = p_recruiter_id
  for share;

  if not found then
    return null;
  end if;

  select application.* into selected_application
  from public.applications application
  where application.id = p_application_id
    and application.opportunity_id = p_opportunity_id
    and application.submission_state = 'submitted'
  for update;

  if not found or target_opportunity.status <> 'published'
    or target_opportunity.closed_at is not null
    or target_opportunity.closes_at <= clock_timestamp()
    or target_opportunity.starts_at <= clock_timestamp() then
    return null;
  end if;

  update public.applications application
  set
    selected_at = coalesce(application.selected_at, clock_timestamp()),
    selected_by = coalesce(application.selected_by, p_recruiter_id)
  where application.id = p_application_id
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

create function public.unselect_application_for_recruiter(
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

create table public.anonymous_request_quota (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  action text not null check (action in ('submit_application', 'create_photo_upload')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (opportunity_id, action, source_hash, bucket_start)
);

create index anonymous_request_quota_bucket_start_idx
on public.anonymous_request_quota (bucket_start);

alter table public.anonymous_request_quota enable row level security;
revoke all on table public.anonymous_request_quota from public, anon, authenticated, service_role;

create function public.consume_anonymous_request_quota(
  p_opportunity_id uuid,
  p_action text,
  p_source_hash text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  accepted_count integer;
begin
  if p_action is null or p_source_hash is null or p_limit is null
    or p_action not in ('submit_application', 'create_photo_upload')
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Invalid quota request.';
  end if;

  delete from public.anonymous_request_quota
  where bucket_start < date_trunc('hour', now()) - interval '24 hours';

  insert into public.anonymous_request_quota (
    opportunity_id, action, source_hash, bucket_start, request_count
  ) values (
    p_opportunity_id, p_action, p_source_hash, date_trunc('hour', now()), 1
  )
  on conflict (opportunity_id, action, source_hash, bucket_start)
  do update set request_count = public.anonymous_request_quota.request_count + 1
  where public.anonymous_request_quota.request_count < p_limit
  returning request_count into accepted_count;

  return accepted_count is not null;
end;
$$;

revoke all on function public.consume_anonymous_request_quota(uuid, text, text, integer)
from public, anon, authenticated;
grant execute on function public.consume_anonymous_request_quota(uuid, text, text, integer)
to service_role;
