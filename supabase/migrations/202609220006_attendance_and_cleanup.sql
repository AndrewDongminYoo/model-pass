alter table public.attendance_events
  drop constraint attendance_events_event_type_check;

update public.attendance_events
set event_type = case event_type
  when 'cancelled' then party || '_cancelled'
  when 'no_show' then party || '_no_show'
  when 'disputed' then 'dispute_opened'
  when 'resolved' then 'dispute_resolved'
  else event_type
end;

alter table public.attendance_events
  drop constraint attendance_events_application_id_fkey,
  add constraint attendance_events_application_id_fkey
    foreign key (application_id) references public.applications(id) on delete restrict,
  add column actor_party text,
  add column related_event_id uuid references public.attendance_events(id) on delete restrict,
  add column resolution text;

update public.attendance_events
set actor_party = case when recorded_by is null then 'applicant' else 'recruiter' end;

alter table public.attendance_events
  alter column actor_party set not null,
  alter column actor_party set default 'recruiter',
  drop column details,
  add constraint attendance_events_actor_party_check
    check (actor_party in ('recruiter', 'applicant', 'operator')),
  add constraint attendance_events_event_type_check check (
    event_type in (
      'recruiter_confirmed',
      'applicant_confirmed',
      'completed',
      'recruiter_cancelled',
      'applicant_cancelled',
      'recruiter_no_show',
      'applicant_no_show',
      'dispute_opened',
      'dispute_resolved'
    )
  ),
  add constraint attendance_events_party_matches_type_check check (
    (event_type like 'recruiter\_%' escape '\' and party = 'recruiter')
    or (event_type like 'applicant\_%' escape '\' and party = 'applicant')
    or event_type in ('completed', 'dispute_opened', 'dispute_resolved')
  ),
  add constraint attendance_events_relationship_check check (
    (
      event_type in ('dispute_opened', 'dispute_resolved')
      and related_event_id is not null
    )
    or (
      event_type not in ('dispute_opened', 'dispute_resolved')
      and related_event_id is null
    )
  ),
  add constraint attendance_events_resolution_check check (
    (event_type = 'dispute_resolved' and resolution in ('confirmed', 'rejected'))
    or (event_type <> 'dispute_resolved' and resolution is null)
  );

create unique index attendance_one_dispute_per_event_idx
  on public.attendance_events(related_event_id)
  where event_type = 'dispute_opened';

create unique index attendance_one_resolution_per_dispute_idx
  on public.attendance_events(related_event_id)
  where event_type = 'dispute_resolved';

create table public.retention_holds (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete restrict,
  source_event_id uuid references public.attendance_events(id) on delete restrict,
  reason text not null check (reason in ('attendance_dispute', 'legal_obligation')),
  opened_at timestamptz not null default now(),
  released_at timestamptz,
  check (released_at is null or released_at >= opened_at)
);

create unique index retention_holds_dispute_source_idx
  on public.retention_holds(source_event_id)
  where source_event_id is not null;

alter table public.retention_holds enable row level security;
revoke all on table public.retention_holds from public, anon, authenticated;
grant select, insert, update on table public.retention_holds to service_role;

create or replace function public.prevent_hold_during_photo_cleanup()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('photo-cleanup:' || new.application_id::text, 0)
  );
  if exists (
    select 1
    from public.application_photos photo
    where photo.application_id = new.application_id
      and photo.deleted_at is null
      and photo.cleanup_claim_invocation_id is not null
  ) then
    raise exception using
      errcode = '40001',
      message = 'Photo cleanup is active; retry the dispute.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_hold_during_photo_cleanup()
from public, anon, authenticated, service_role;

create trigger prevent_hold_during_photo_cleanup
before insert on public.retention_holds
for each row execute function public.prevent_hold_during_photo_cleanup();

create or replace function public.prevent_attendance_history_mutation()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception using errcode = 'P0001', message = 'Attendance history is append-only.';
end;
$$;

revoke all on function public.prevent_attendance_history_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_attendance_history_mutation
before update or delete on public.attendance_events
for each row execute function public.prevent_attendance_history_mutation();

revoke update, delete on table public.attendance_events from service_role;

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
    null;
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

revoke all on function public.record_attendance_event(
  uuid, text, uuid, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_attendance_event(
  uuid, text, uuid, text, text, uuid, text, timestamptz
) to service_role;

alter table public.application_photos
  add column deleted_at timestamptz,
  add column deletion_reason text,
  add column deletion_invocation_id uuid,
  add column cleanup_claim_invocation_id uuid,
  add column cleanup_claimed_at timestamptz,
  add constraint application_photos_deletion_evidence_check check (
    (deleted_at is null and deletion_reason is null and deletion_invocation_id is null)
    or (
      deleted_at is not null
      and deletion_reason = 'retention_expired'
      and deletion_invocation_id is not null
    )
  ),
  add constraint application_photos_cleanup_claim_check check (
    (
      cleanup_claim_invocation_id is null
      and cleanup_claimed_at is null
    )
    or (
      cleanup_claim_invocation_id is not null
      and cleanup_claimed_at is not null
      and deleted_at is null
    )
  );

drop policy "Recruiters can read photos for owned opportunities"
on public.application_photos;
create policy "Recruiters can read photos for owned opportunities"
on public.application_photos
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = application_photos.application_id
      and applications.submission_state = 'submitted'
      and opportunities.recruiter_id = (select auth.uid())
  )
);

create or replace function public.list_expired_photo_cleanup_candidates(
  p_now timestamptz
)
returns table (id uuid, storage_path text, expires_at timestamptz, held boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    photo.id,
    photo.storage_path,
    photo.expires_at,
    exists (
      select 1
      from public.retention_holds hold
      where hold.application_id = photo.application_id
        and hold.released_at is null
    ) as held
  from public.application_photos photo
  where photo.deleted_at is null
    and photo.expires_at <= p_now
  order by photo.expires_at, photo.id;
$$;

revoke all on function public.list_expired_photo_cleanup_candidates(timestamptz)
from public, anon, authenticated;
grant execute on function public.list_expired_photo_cleanup_candidates(timestamptz)
to service_role;

create or replace function public.claim_application_photo_cleanup(
  p_photo_id uuid,
  p_invocation_id uuid,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application_id uuid;
  changed_rows integer;
begin
  select application_id into target_application_id
  from public.application_photos
  where id = p_photo_id;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('photo-cleanup:' || target_application_id::text, 0)
  );

  update public.application_photos photo
  set
    cleanup_claim_invocation_id = p_invocation_id,
    cleanup_claimed_at = p_claimed_at
  where photo.id = p_photo_id
    and photo.deleted_at is null
    and photo.expires_at <= p_claimed_at
    and (
      photo.cleanup_claim_invocation_id is null
      or photo.cleanup_claimed_at <= p_claimed_at - interval '15 minutes'
    )
    and not exists (
      select 1
      from public.retention_holds hold
      where hold.application_id = photo.application_id
        and hold.released_at is null
    );
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.claim_application_photo_cleanup(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.claim_application_photo_cleanup(uuid, uuid, timestamptz)
to service_role;

create or replace function public.release_application_photo_cleanup_claim(
  p_photo_id uuid,
  p_invocation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application_id uuid;
  changed_rows integer;
begin
  select application_id into target_application_id
  from public.application_photos
  where id = p_photo_id;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('photo-cleanup:' || target_application_id::text, 0)
  );

  update public.application_photos
  set cleanup_claim_invocation_id = null, cleanup_claimed_at = null
  where id = p_photo_id
    and deleted_at is null
    and cleanup_claim_invocation_id = p_invocation_id;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.release_application_photo_cleanup_claim(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.release_application_photo_cleanup_claim(uuid, uuid)
to service_role;

create or replace function public.finalize_application_photo_cleanup(
  p_photo_id uuid,
  p_invocation_id uuid,
  p_deleted_at timestamptz,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_application_id uuid;
  changed_rows integer;
begin
  if p_reason <> 'retention_expired' then
    raise exception using errcode = '22023', message = 'Invalid photo deletion reason.';
  end if;

  select application_id into target_application_id
  from public.application_photos
  where id = p_photo_id;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('photo-cleanup:' || target_application_id::text, 0)
  );

  update public.application_photos
  set
    deleted_at = p_deleted_at,
    deletion_reason = p_reason,
    deletion_invocation_id = p_invocation_id,
    cleanup_claim_invocation_id = null,
    cleanup_claimed_at = null
  where id = p_photo_id
    and deleted_at is null
    and cleanup_claim_invocation_id = p_invocation_id;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.finalize_application_photo_cleanup(uuid, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.finalize_application_photo_cleanup(uuid, uuid, timestamptz, text)
to service_role;

create or replace function public.list_stale_photo_reservations(p_now timestamptz)
returns table (
  id uuid,
  application_id uuid,
  storage_path text,
  metadata_exists boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    reservation.id,
    reservation.application_id,
    reservation.storage_path,
    photo.id is not null as metadata_exists
  from public.application_photo_upload_reservations reservation
  left join public.application_photos photo
    on photo.id = reservation.id
    and photo.application_id = reservation.application_id
    and photo.storage_path = reservation.storage_path
  where reservation.created_at <= p_now - interval '10 minutes'
  order by reservation.created_at, reservation.id;
$$;

revoke all on function public.list_stale_photo_reservations(timestamptz)
from public, anon, authenticated;
grant execute on function public.list_stale_photo_reservations(timestamptz)
to service_role;

create or replace function public.delete_reconciled_photo_reservation(
  p_reservation_id uuid,
  p_application_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed_rows integer;
begin
  delete from public.application_photo_upload_reservations
  where id = p_reservation_id
    and application_id = p_application_id
    and storage_path = p_storage_path;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.delete_reconciled_photo_reservation(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.delete_reconciled_photo_reservation(uuid, uuid, text)
to service_role;

create or replace function public.count_abandoned_pending_photo_drafts(
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
    )
    and not exists (
      select 1
      from public.application_photos photo
      where photo.application_id = application.id
    );
$$;

revoke all on function public.count_abandoned_pending_photo_drafts(timestamptz)
from public, anon, authenticated;
grant execute on function public.count_abandoned_pending_photo_drafts(timestamptz)
to service_role;

create or replace function public.delete_abandoned_pending_photo_drafts(
  p_now timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed_rows bigint;
begin
  delete from public.applications application
  using public.opportunities opportunity
  where application.opportunity_id = opportunity.id
    and application.submission_state = 'pending_photo'
    and (
      opportunity.status = 'closed'
      or opportunity.closed_at is not null
      or opportunity.closes_at <= p_now
    )
    and not exists (
      select 1
      from public.application_photo_upload_reservations reservation
      where reservation.application_id = application.id
    )
    and not exists (
      select 1
      from public.application_photos photo
      where photo.application_id = application.id
    );
  get diagnostics changed_rows = row_count;
  return changed_rows;
end;
$$;

revoke all on function public.delete_abandoned_pending_photo_drafts(timestamptz)
from public, anon, authenticated;
grant execute on function public.delete_abandoned_pending_photo_drafts(timestamptz)
to service_role;
