begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '10000000-0000-4000-8000-000000000081',
  'authenticated',
  'authenticated',
  'sender-recruiter@example.test',
  ''
);

-- 081: starts in 12 hours (inside the window); 082: starts in 48 hours.
insert into public.opportunities (
  id, recruiter_id, category, title, starts_at, closes_at, venue_district,
  expected_minutes, benefit, status, ruleset_id, ruleset_version, rules_snapshot
)
values
  (
    '00000000-0000-4000-8000-000000000081',
    '10000000-0000-4000-8000-000000000081',
    'hair_promotion', 'Sender window opportunity',
    now() + interval '12 hours', now() + interval '6 hours', 'Gangnam-gu',
    120, '{"type":"procedure","description":"Hair service"}', 'published',
    'hair-promotion', 1, '[]'
  ),
  (
    '00000000-0000-4000-8000-000000000082',
    '10000000-0000-4000-8000-000000000081',
    'hair_promotion', 'Sender later opportunity',
    now() + interval '48 hours', now() + interval '6 hours', 'Gangnam-gu',
    120, '{"type":"procedure","description":"Hair service"}', 'published',
    'hair-promotion', 1, '[]'
  );

-- 811: eligible; 812: no recipient key; 813: outside the window;
-- 814 and 815: eligible, used for release.
insert into public.applications (
  id, opportunity_id, submission_attempt_id, submission_fingerprint,
  applicant_display_name, applicant_phone, applicant_birth_date,
  ruleset_id, ruleset_version, rules_snapshot, evaluation_snapshot
)
select
  application_id::uuid,
  opportunity_id::uuid,
  gen_random_uuid(),
  repeat('8', 64),
  'Sender applicant',
  '010-0000-0008',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
from (
  values
    ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000081'),
    ('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000081'),
    ('00000000-0000-4000-8000-000000000813', '00000000-0000-4000-8000-000000000082'),
    ('00000000-0000-4000-8000-000000000814', '00000000-0000-4000-8000-000000000081'),
    ('00000000-0000-4000-8000-000000000815', '00000000-0000-4000-8000-000000000081')
) as fixture(application_id, opportunity_id);

update public.applications
set
  selected_at = now(),
  selected_by = '10000000-0000-4000-8000-000000000081'
where opportunity_id in (
  '00000000-0000-4000-8000-000000000081',
  '00000000-0000-4000-8000-000000000082'
);

insert into public.application_toss_recipients (application_id, anon_key)
values
  ('00000000-0000-4000-8000-000000000811', 'anon-811'),
  ('00000000-0000-4000-8000-000000000813', 'anon-813'),
  ('00000000-0000-4000-8000-000000000814', 'anon-814'),
  ('00000000-0000-4000-8000-000000000815', 'anon-815');

select ok(
  not has_function_privilege('anon', 'public.list_attendance_reminder_candidates(timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_attendance_reminder(uuid, text, text, timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.release_attendance_reminder_claim(uuid)', 'EXECUTE'),
  'clients cannot call the sender functions'
);

select set_eq(
  $$ select * from public.list_attendance_reminder_candidates(now()) $$,
  $$ values
    ('00000000-0000-4000-8000-000000000811'::uuid),
    ('00000000-0000-4000-8000-000000000814'::uuid),
    ('00000000-0000-4000-8000-000000000815'::uuid) $$,
  'candidates need a recipient key and an appointment within 24 hours'
);

create temporary table claim_811 as
select (public.claim_attendance_reminder(
  '00000000-0000-4000-8000-000000000811', 'day_before', now()
) ->> 'reminderId')::uuid as reminder_id;

select ok(
  '00000000-0000-4000-8000-000000000811'::uuid not in (
    select * from public.list_attendance_reminder_candidates(now())
  ),
  'an unresolved claim is not a candidate'
);

select is(
  public.finish_attendance_reminder(
    (select reminder_id from claim_811), 'sent', null, now()
  ),
  true,
  'a claimed reminder is recorded as sent'
);

select ok(
  (
    select result = 'sent' and sent_at is not null and failure_code is null
    from public.attendance_reminders
    where application_id = '00000000-0000-4000-8000-000000000811'
  ),
  'a sent reminder keeps its send time'
);

select is(
  public.finish_attendance_reminder(
    (select reminder_id from claim_811), 'failed', 'LATE', now()
  ),
  false,
  'a resolved reminder cannot be finished twice'
);

select throws_ok(
  $$ select public.finish_attendance_reminder(
    (select reminder_id from claim_811), 'failed', null, now()
  ) $$,
  '22023',
  'Invalid reminder outcome.',
  'a failure needs a failure code'
);

create temporary table claim_814 as
select (public.claim_attendance_reminder(
  '00000000-0000-4000-8000-000000000814', 'day_before', now()
) ->> 'reminderId')::uuid as reminder_id;

select is(
  public.release_attendance_reminder_claim((select reminder_id from claim_814)),
  true,
  'a first-attempt claim is released'
);

select is(
  (
    select count(*)::bigint
    from public.attendance_reminders
    where application_id = '00000000-0000-4000-8000-000000000814'
  ),
  0::bigint,
  'releasing a first attempt removes its row'
);

select is(
  public.release_attendance_reminder_claim((select reminder_id from claim_814)),
  false,
  'a released claim cannot be released again'
);

create temporary table claim_815 as
select (public.claim_attendance_reminder(
  '00000000-0000-4000-8000-000000000815', 'day_before', now()
) ->> 'reminderId')::uuid as reminder_id;

do $$
begin
  perform public.finish_attendance_reminder(
    (select reminder_id from claim_815), 'failed', 'INVALID_PARAMETER', now()
  );
end;
$$;

select is(
  (
    select (public.claim_attendance_reminder(
      '00000000-0000-4000-8000-000000000815', 'day_before', now()
    ) ->> 'attemptCount')::integer
  ),
  2,
  'an explicit failure is reclaimed as the second attempt'
);

select is(
  public.release_attendance_reminder_claim((select reminder_id from claim_815)),
  true,
  'a reclaimed attempt is released'
);

select ok(
  (
    select result = 'failed'
      and attempt_count = 1
      and failure_code = 'CONFIGURATION_RELEASED'
    from public.attendance_reminders
    where application_id = '00000000-0000-4000-8000-000000000815'
  ),
  'releasing a reclaimed attempt restores the earlier failed state'
);

select ok(
  '00000000-0000-4000-8000-000000000815'::uuid in (
    select * from public.list_attendance_reminder_candidates(now())
  ),
  'a retryable failed reminder is a candidate again'
);

update public.attendance_reminders
set attempt_count = 3
where application_id = '00000000-0000-4000-8000-000000000815';

select ok(
  '00000000-0000-4000-8000-000000000815'::uuid not in (
    select * from public.list_attendance_reminder_candidates(now())
  ),
  'a reminder that used all three attempts is not a candidate'
);

select * from finish();
rollback;
