begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.application_toss_recipients'::regclass),
  'recipient keys have Row Level Security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.attendance_reminders'::regclass),
  'reminder claims have Row Level Security enabled'
);

select ok(
  not has_table_privilege('anon', 'public.application_toss_recipients', 'SELECT')
    and not has_table_privilege('authenticated', 'public.application_toss_recipients', 'SELECT'),
  'clients and recruiters cannot read recipient keys'
);

select ok(
  not has_table_privilege('anon', 'public.application_toss_recipients', 'INSERT')
    and not has_table_privilege('authenticated', 'public.application_toss_recipients', 'INSERT'),
  'clients and recruiters cannot write recipient keys'
);

select ok(
  not has_table_privilege('anon', 'public.attendance_reminders', 'SELECT')
    and not has_table_privilege('authenticated', 'public.attendance_reminders', 'SELECT'),
  'clients and recruiters cannot read reminder claims'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in ('application_toss_recipients', 'attendance_reminders')
  ),
  0::bigint,
  'recipient keys and reminder claims have no client policies'
);

insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '10000000-0000-4000-8000-000000000071',
  'authenticated',
  'authenticated',
  'reminder-recruiter@example.test',
  ''
);

-- 071: starts in 12 hours (inside the window); 072: starts in 48 hours.
insert into public.opportunities (
  id, recruiter_id, category, title, starts_at, closes_at, venue_district,
  expected_minutes, benefit, status, ruleset_id, ruleset_version, rules_snapshot
)
values
  (
    '00000000-0000-4000-8000-000000000071',
    '10000000-0000-4000-8000-000000000071',
    'hair_promotion', 'Reminder window opportunity',
    now() + interval '12 hours', now() + interval '6 hours', 'Gangnam-gu',
    120, '{"type":"procedure","description":"Hair service"}', 'published',
    'hair-promotion', 1, '[]'
  ),
  (
    '00000000-0000-4000-8000-000000000072',
    '10000000-0000-4000-8000-000000000071',
    'hair_promotion', 'Reminder later opportunity',
    now() + interval '48 hours', now() + interval '6 hours', 'Gangnam-gu',
    120, '{"type":"procedure","description":"Hair service"}', 'published',
    'hair-promotion', 1, '[]'
  );

-- 711: eligible; 712: recruiter cancelled; 713: outside the window;
-- 714: no recipient key; 715: eligible, used for unselection.
insert into public.applications (
  id, opportunity_id, submission_attempt_id, submission_fingerprint,
  applicant_display_name, applicant_phone, applicant_birth_date,
  ruleset_id, ruleset_version, rules_snapshot, evaluation_snapshot
)
select
  application_id::uuid,
  opportunity_id::uuid,
  gen_random_uuid(),
  repeat('7', 64),
  'Reminder applicant',
  '010-0000-0007',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
from (
  values
    ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000071'),
    ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000071'),
    ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000072'),
    ('00000000-0000-4000-8000-000000000714', '00000000-0000-4000-8000-000000000071'),
    ('00000000-0000-4000-8000-000000000715', '00000000-0000-4000-8000-000000000071')
) as fixture(application_id, opportunity_id);

update public.applications
set
  selected_at = now(),
  selected_by = '10000000-0000-4000-8000-000000000071'
where opportunity_id in (
  '00000000-0000-4000-8000-000000000071',
  '00000000-0000-4000-8000-000000000072'
);

insert into public.application_toss_recipients (application_id, anon_key)
values
  ('00000000-0000-4000-8000-000000000711', 'anon-711'),
  ('00000000-0000-4000-8000-000000000712', 'anon-712'),
  ('00000000-0000-4000-8000-000000000713', 'anon-713'),
  ('00000000-0000-4000-8000-000000000715', 'anon-715');

insert into public.attendance_events (
  application_id, recorded_by, actor_party, party, event_type
)
values (
  '00000000-0000-4000-8000-000000000712',
  '10000000-0000-4000-8000-000000000071',
  'recruiter',
  'recruiter',
  'recruiter_cancelled'
);

select is(
  (
    select public.claim_attendance_reminder(
      '00000000-0000-4000-8000-000000000711', 'day_before', now()
    ) ->> 'anonKey'
  ),
  'anon-711',
  'an eligible application is claimed with its recipient key'
);

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000711', 'day_before', now()
  ),
  null,
  'a claimed reminder is not claimed twice'
);

update public.attendance_reminders
set result = 'failed', failure_code = 'INVALID_PARAMETER'
where application_id = '00000000-0000-4000-8000-000000000711';

select is(
  (
    select (public.claim_attendance_reminder(
      '00000000-0000-4000-8000-000000000711', 'day_before', now()
    ) ->> 'attemptCount')::integer
  ),
  2,
  'an explicit failure is reclaimed as the second attempt'
);

update public.attendance_reminders
set result = 'failed', failure_code = 'INVALID_PARAMETER', attempt_count = 3
where application_id = '00000000-0000-4000-8000-000000000711';

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000711', 'day_before', now()
  ),
  null,
  'a reminder is not reclaimed after three attempts'
);

update public.attendance_reminders
set result = null, failure_code = null, attempt_count = 1
where application_id = '00000000-0000-4000-8000-000000000711';

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000711', 'day_before', now()
  ),
  null,
  'an ambiguous claim without a result is not reclaimed'
);

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000712', 'day_before', now()
  ),
  null,
  'a recruiter-cancelled application is not claimed'
);

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000713', 'day_before', now()
  ),
  null,
  'an appointment more than 24 hours away is not claimed'
);

select is(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000714', 'day_before', now()
  ),
  null,
  'an application without a recipient key is not claimed'
);

select isnt(
  public.claim_attendance_reminder(
    '00000000-0000-4000-8000-000000000715', 'day_before', now()
  ),
  null,
  'the unselection fixture is claimed'
);

select is(
  public.unselect_application_for_recruiter(
    '00000000-0000-4000-8000-000000000715',
    '00000000-0000-4000-8000-000000000071',
    '10000000-0000-4000-8000-000000000071'
  ),
  null,
  'a recruiter cannot unselect an application after its reminder is claimed'
);

update public.attendance_reminders
set result = 'failed', failure_code = 'INVALID_PARAMETER'
where application_id = '00000000-0000-4000-8000-000000000715';

select isnt(
  public.unselect_application_for_recruiter(
    '00000000-0000-4000-8000-000000000715',
    '00000000-0000-4000-8000-000000000071',
    '10000000-0000-4000-8000-000000000071'
  ),
  null,
  'a recruiter can unselect an application whose reminder only failed'
);

select is(
  (
    select count(*)::bigint
    from public.attendance_reminders
    where application_id = '00000000-0000-4000-8000-000000000715'
  ),
  0::bigint,
  'unselection deletes the failed reminder so it cannot be reclaimed'
);

select is(
  public.record_toss_recipient(
    '00000000-0000-4000-8000-000000000714', gen_random_uuid(), 'anon-714'
  ),
  false,
  'a recipient key is not recorded for a stale submission attempt'
);

select is(
  public.record_toss_recipient(
    '00000000-0000-4000-8000-000000000714',
    (
      select submission_attempt_id
      from public.applications
      where id = '00000000-0000-4000-8000-000000000714'
    ),
    'anon-714'
  ),
  true,
  'a recipient key is recorded before the appointment starts'
);

insert into public.opportunities (
  id, recruiter_id, category, title, starts_at, closes_at, venue_district,
  expected_minutes, benefit, status, ruleset_id, ruleset_version, rules_snapshot
)
values (
  '00000000-0000-4000-8000-000000000073',
  '10000000-0000-4000-8000-000000000071',
  'hair_promotion', 'Reminder started opportunity',
  now() - interval '1 hour', now() - interval '2 hours', 'Gangnam-gu',
  120, '{"type":"procedure","description":"Hair service"}', 'published',
  'hair-promotion', 1, '[]'
);

insert into public.applications (
  id, opportunity_id, submission_attempt_id, submission_fingerprint,
  applicant_display_name, applicant_phone, applicant_birth_date,
  ruleset_id, ruleset_version, rules_snapshot, evaluation_snapshot
)
values (
  '00000000-0000-4000-8000-000000000716',
  '00000000-0000-4000-8000-000000000073',
  gen_random_uuid(),
  repeat('7', 64),
  'Reminder applicant',
  '010-0000-0007',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
);

select is(
  public.record_toss_recipient(
    '00000000-0000-4000-8000-000000000716',
    (
      select submission_attempt_id
      from public.applications
      where id = '00000000-0000-4000-8000-000000000716'
    ),
    'anon-716'
  ),
  false,
  'a recipient key is not recorded after the appointment starts'
);

select is(
  (
    select count(*)::bigint
    from public.application_toss_recipients
    where application_id = '00000000-0000-4000-8000-000000000716'
  ),
  0::bigint,
  'a late retry does not recreate a deleted recipient key'
);

select is(
  public.delete_started_toss_recipients(now() + interval '13 hours'),
  4,
  'recipient keys are deleted once their appointment has started'
);

select * from finish();
rollback;
