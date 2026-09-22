revoke select on table public.applications from authenticated;
revoke select (submission_attempt_id, submission_fingerprint)
on table public.applications from authenticated;
grant select (
  id,
  opportunity_id,
  created_at,
  applicant_display_name,
  applicant_phone,
  evaluation_snapshot,
  submission_state
) on table public.applications to authenticated;

create unique index attendance_confirmation_once_idx
  on public.attendance_events(application_id, event_type)
  where event_type in ('recruiter_confirmed', 'applicant_confirmed');

create unique index attendance_final_outcome_once_idx
  on public.attendance_events(application_id, party)
  where event_type in (
    'completed',
    'recruiter_cancelled',
    'applicant_cancelled',
    'recruiter_no_show',
    'applicant_no_show'
  );

create or replace function public.record_attendance_event(
  p_application_id uuid,
  p_actor_party text,
  p_recorded_by uuid,
  p_event_type text,
  p_party text,
  p_related_event_id uuid default null,
  p_resolution text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application public.applications%rowtype;
  target_opportunity public.opportunities%rowtype;
  related_event public.attendance_events%rowtype;
  inserted_event public.attendance_events%rowtype;
begin
  select * into target_application
  from public.applications
  where id = p_application_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Application not found.';
  end if;
  if target_application.submission_state <> 'submitted' then
    raise exception using
      errcode = '22023',
      message = 'Attendance cannot be recorded for a pending-photo application.';
  end if;

  select * into target_opportunity
  from public.opportunities
  where id = target_application.opportunity_id
  for share;

  if p_actor_party not in ('recruiter', 'applicant', 'operator')
    or p_party not in ('recruiter', 'applicant') then
    raise exception using errcode = '22023', message = 'Invalid attendance actor or party.';
  end if;
  if p_actor_party = 'recruiter'
    and (p_recorded_by is null or p_recorded_by <> target_opportunity.recruiter_id) then
    raise exception using errcode = '42501', message = 'Recruiter does not own this opportunity.';
  end if;
  if p_actor_party = 'applicant' and p_recorded_by is not null then
    raise exception using errcode = '42501', message = 'Applicant capability cannot identify another actor.';
  end if;

  if p_event_type = 'dispute_resolved' then
    if p_actor_party <> 'operator' then
      raise exception using errcode = '42501', message = 'Operator authorization is required.';
    end if;
  elsif p_actor_party = 'operator' then
    raise exception using errcode = '42501', message = 'Operators may only resolve disputes.';
  elsif p_event_type = 'dispute_opened' then
    if p_actor_party <> p_party then
      raise exception using
        errcode = '42501',
        message = 'A participant may only dispute an event for its own party.';
    end if;
  elsif not (
    (p_actor_party = 'recruiter' and p_event_type in (
      'recruiter_confirmed', 'recruiter_cancelled', 'completed', 'applicant_no_show'
    ))
    or (p_actor_party = 'applicant' and p_event_type in (
      'applicant_confirmed', 'applicant_cancelled', 'completed', 'recruiter_no_show'
    ))
  ) then
    raise exception using
      errcode = '42501',
      message = 'This actor cannot record that attendance event.';
  end if;

  if (p_event_type like 'recruiter\_%' escape '\' and p_party <> 'recruiter')
    or (p_event_type like 'applicant\_%' escape '\' and p_party <> 'applicant')
    or (p_event_type = 'completed' and p_party <> p_actor_party) then
    raise exception using errcode = '42501', message = 'Attendance party does not match the event.';
  end if;

  if p_event_type = 'dispute_opened' then
    perform pg_advisory_xact_lock(
      hashtextextended('photo-cleanup:' || p_application_id::text, 0)
    );
    if exists (
      select 1
      from public.application_photos photo
      where photo.application_id = p_application_id
        and photo.deleted_at is null
        and photo.cleanup_claim_invocation_id is not null
    ) then
      raise exception using
        errcode = '40001',
        message = 'Photo cleanup is active; retry the dispute.';
    end if;
    select * into related_event
    from public.attendance_events
    where id = p_related_event_id
      and application_id = p_application_id
      and event_type in ('recruiter_no_show', 'applicant_no_show')
    for share;
    if not found or related_event.party <> p_party then
      raise exception using errcode = '22023', message = 'Dispute target is not a relevant no-show event.';
    end if;
  elsif p_event_type = 'dispute_resolved' then
    select * into related_event
    from public.attendance_events
    where id = p_related_event_id
      and application_id = p_application_id
      and event_type = 'dispute_opened'
    for share;
    if not found or related_event.party <> p_party or p_resolution not in ('confirmed', 'rejected') then
      raise exception using errcode = '22023', message = 'Resolution target is not an open dispute.';
    end if;
  elsif p_related_event_id is not null or p_resolution is not null then
    raise exception using errcode = '22023', message = 'Attendance relationship fields are invalid.';
  end if;

  if p_event_type in ('recruiter_confirmed', 'applicant_confirmed')
    and exists (
      select 1 from public.attendance_events
      where application_id = p_application_id and event_type = p_event_type
    ) then
    raise exception using errcode = '23505', message = 'Attendance confirmation already exists.';
  end if;

  if p_event_type in (
    'completed', 'recruiter_cancelled', 'applicant_cancelled',
    'recruiter_no_show', 'applicant_no_show'
  ) and exists (
    select 1
    from public.attendance_events
    where application_id = p_application_id
      and party = p_party
      and event_type in (
        'completed', 'recruiter_cancelled', 'applicant_cancelled',
        'recruiter_no_show', 'applicant_no_show'
      )
  ) then
    raise exception using errcode = '23505', message = 'Attendance outcome already exists for this party.';
  end if;

  insert into public.attendance_events (
    application_id,
    recorded_by,
    actor_party,
    party,
    event_type,
    related_event_id,
    resolution,
    occurred_at
  ) values (
    p_application_id,
    p_recorded_by,
    p_actor_party,
    p_party,
    p_event_type,
    p_related_event_id,
    p_resolution,
    coalesce(p_occurred_at, now())
  ) returning * into inserted_event;

  if p_event_type = 'dispute_opened' then
    insert into public.retention_holds (application_id, source_event_id, reason)
    values (p_application_id, inserted_event.id, 'attendance_dispute');
  elsif p_event_type = 'dispute_resolved' then
    update public.retention_holds
    set released_at = inserted_event.created_at
    where source_event_id = p_related_event_id
      and released_at is null;
    if not found then
      raise exception using errcode = '22023', message = 'Resolution target is not an open dispute.';
    end if;
  end if;

  return jsonb_build_object(
    'id', inserted_event.id,
    'applicationId', inserted_event.application_id,
    'eventType', inserted_event.event_type,
    'party', inserted_event.party,
    'occurredAt', inserted_event.occurred_at,
    'relatedEventId', inserted_event.related_event_id,
    'resolution', inserted_event.resolution
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Attendance event already exists.';
end;
$$;

alter table public.application_photo_upload_reservations
  add column cleanup_claim_invocation_id uuid,
  add column cleanup_claimed_at timestamptz,
  add constraint application_photo_reservation_cleanup_claim_check check (
    (
      cleanup_claim_invocation_id is null
      and cleanup_claimed_at is null
    )
    or (
      cleanup_claim_invocation_id is not null
      and cleanup_claimed_at is not null
    )
  );

create or replace function public.prevent_photo_finalization_during_reservation_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform 1
  from public.applications
  where id = new.application_id
  for update;

  if exists (
    select 1
    from public.application_photo_upload_reservations reservation
    where reservation.id = new.id
      and reservation.application_id = new.application_id
      and reservation.storage_path = new.storage_path
      and reservation.cleanup_claim_invocation_id is not null
  ) then
    raise exception using
      errcode = '40001',
      message = 'Photo reservation cleanup is active; retry finalization.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_photo_finalization_during_reservation_cleanup()
from public, anon, authenticated, service_role;

create trigger prevent_photo_finalization_during_reservation_cleanup
before insert on public.application_photos
for each row execute function public.prevent_photo_finalization_during_reservation_cleanup();

create or replace function public.claim_photo_upload_reservation_cleanup(
  p_reservation_id uuid,
  p_application_id uuid,
  p_storage_path text,
  p_invocation_id uuid,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed_rows integer;
begin
  perform 1
  from public.applications
  where id = p_application_id
  for update;
  if not found then
    return false;
  end if;

  perform 1
  from public.application_photo_upload_reservations reservation
  where reservation.id = p_reservation_id
    and reservation.application_id = p_application_id
    and reservation.storage_path = p_storage_path
  for update;
  if not found then
    return false;
  end if;

  if exists (
    select 1
    from public.application_photos photo
    where photo.id = p_reservation_id
      and photo.application_id = p_application_id
      and photo.storage_path = p_storage_path
  ) then
    return false;
  end if;

  update public.application_photo_upload_reservations reservation
  set
    cleanup_claim_invocation_id = p_invocation_id,
    cleanup_claimed_at = p_claimed_at
  where reservation.id = p_reservation_id
    and reservation.application_id = p_application_id
    and reservation.storage_path = p_storage_path
    and reservation.created_at <= p_claimed_at - interval '10 minutes'
    and (
      reservation.cleanup_claim_invocation_id is null
      or reservation.cleanup_claimed_at <= p_claimed_at - interval '15 minutes'
    );
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.claim_photo_upload_reservation_cleanup(
  uuid, uuid, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_photo_upload_reservation_cleanup(
  uuid, uuid, text, uuid, timestamptz
) to service_role;

create or replace function public.release_photo_upload_reservation_cleanup_claim(
  p_reservation_id uuid,
  p_application_id uuid,
  p_storage_path text,
  p_invocation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed_rows integer;
begin
  perform 1
  from public.applications
  where id = p_application_id
  for update;
  if not found then
    return false;
  end if;

  update public.application_photo_upload_reservations reservation
  set cleanup_claim_invocation_id = null, cleanup_claimed_at = null
  where reservation.id = p_reservation_id
    and reservation.application_id = p_application_id
    and reservation.storage_path = p_storage_path
    and reservation.cleanup_claim_invocation_id = p_invocation_id;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.release_photo_upload_reservation_cleanup_claim(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.release_photo_upload_reservation_cleanup_claim(
  uuid, uuid, text, uuid
) to service_role;

create or replace function public.delete_claimed_photo_upload_reservation(
  p_reservation_id uuid,
  p_application_id uuid,
  p_storage_path text,
  p_invocation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed_rows integer;
begin
  perform 1
  from public.applications
  where id = p_application_id
  for update;
  if not found then
    return false;
  end if;

  delete from public.application_photo_upload_reservations reservation
  where reservation.id = p_reservation_id
    and reservation.application_id = p_application_id
    and reservation.storage_path = p_storage_path
    and reservation.cleanup_claim_invocation_id = p_invocation_id
    and not exists (
      select 1
      from public.application_photos photo
      where photo.id = p_reservation_id
        and photo.application_id = p_application_id
        and photo.storage_path = p_storage_path
    );
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.delete_claimed_photo_upload_reservation(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.delete_claimed_photo_upload_reservation(
  uuid, uuid, text, uuid
) to service_role;

create or replace function public.count_projected_abandoned_pending_photo_drafts(
  p_now timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)
  from public.applications application
  join public.opportunities opportunity on opportunity.id = application.opportunity_id
  where application.submission_state = 'pending_photo'
    and (
      opportunity.status = 'closed'
      or opportunity.closed_at is not null
      or opportunity.closes_at <= p_now
    )
    and not exists (
      select 1
      from public.application_photo_upload_reservations reservation
      where reservation.application_id = application.id
        and (
          reservation.created_at > p_now - interval '10 minutes'
          or (
            reservation.cleanup_claim_invocation_id is not null
            and reservation.cleanup_claimed_at > p_now - interval '15 minutes'
          )
        )
    )
    and not exists (
      select 1
      from public.application_photos photo
      where photo.application_id = application.id
    );
$$;

revoke all on function public.count_projected_abandoned_pending_photo_drafts(timestamptz)
from public, anon, authenticated;
grant execute on function public.count_projected_abandoned_pending_photo_drafts(timestamptz)
to service_role;
