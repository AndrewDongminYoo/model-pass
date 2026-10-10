-- Sender support for the attendance reminder.
-- See docs/specs/2026-10-10-ait-attendance-reminder.md §Server Call.
-- claim_attendance_reminder remains the authority for eligibility; this list
-- only narrows which applications the sender tries to claim.

create function public.list_attendance_reminder_candidates(p_now timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select application.id
  from public.applications application
  join public.opportunities opportunity
    on opportunity.id = application.opportunity_id
  join public.application_toss_recipients recipient
    on recipient.application_id = application.id
  where application.submission_state = 'submitted'
    and application.selected_at is not null
    and opportunity.starts_at > p_now
    and opportunity.starts_at <= p_now + interval '24 hours'
    and not exists (
      select 1
      from public.attendance_reminders reminder
      where reminder.application_id = application.id
        and reminder.kind = 'day_before'
        and not (reminder.result = 'failed' and reminder.attempt_count < 3)
    )
  order by opportunity.starts_at, application.id
  limit 500;
$$;

revoke all on function public.list_attendance_reminder_candidates(timestamptz)
from public, anon, authenticated;
grant execute on function public.list_attendance_reminder_candidates(timestamptz)
to service_role;

-- Records the outcome of a claimed send. Only an unresolved claim changes.
create function public.finish_attendance_reminder(
  p_reminder_id uuid,
  p_result text,
  p_failure_code text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  updated_count integer;
begin
  if p_reminder_id is null or p_now is null
    or p_result not in ('sent', 'failed')
    or (p_result = 'sent' and p_failure_code is not null)
    or (p_result = 'failed' and (p_failure_code is null or char_length(p_failure_code) > 200)) then
    raise exception using errcode = '22023', message = 'Invalid reminder outcome.';
  end if;

  update public.attendance_reminders reminder
  set
    result = p_result,
    sent_at = case when p_result = 'sent' then p_now else null end,
    failure_code = p_failure_code
  where reminder.id = p_reminder_id
    and reminder.result is null;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.finish_attendance_reminder(uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.finish_attendance_reminder(uuid, text, text, timestamptz)
to service_role;

-- Undoes a claim after a configuration failure without consuming the
-- application's attempt: a first attempt disappears, a reclaimed one returns
-- to its earlier failed state.
create function public.release_attendance_reminder_claim(p_reminder_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.attendance_reminders%rowtype;
begin
  select reminder.* into target
  from public.attendance_reminders reminder
  where reminder.id = p_reminder_id
  for update;

  if not found or target.result is not null then
    return false;
  end if;

  if target.attempt_count = 1 then
    delete from public.attendance_reminders reminder
    where reminder.id = target.id;
  else
    update public.attendance_reminders reminder
    set
      attempt_count = target.attempt_count - 1,
      result = 'failed',
      failure_code = 'CONFIGURATION_RELEASED'
    where reminder.id = target.id;
  end if;
  return true;
end;
$$;

revoke all on function public.release_attendance_reminder_claim(uuid)
from public, anon, authenticated;
grant execute on function public.release_attendance_reminder_claim(uuid)
to service_role;
