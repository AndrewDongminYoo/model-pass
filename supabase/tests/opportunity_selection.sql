begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, aud, role, email, encrypted_password)
values
  (
    '50000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'selection-owner@example.test',
    ''
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'selection-other@example.test',
    ''
  );

insert into public.opportunities (
  id,
  recruiter_id,
  category,
  title,
  starts_at,
  closes_at,
  venue_district,
  expected_minutes,
  benefit,
  status,
  ruleset_id,
  ruleset_version,
  rules_snapshot,
  confirmed_hard_rule_ids
) values (
  '50000000-0000-4000-8000-000000000011',
  '50000000-0000-4000-8000-000000000001',
  'hair_promotion',
  'Selection test opportunity',
  '2099-09-23T03:00:00Z',
  '2099-09-22T03:00:00Z',
  'Gangnam-gu',
  90,
  '{"type":"procedure","description":"Hair service"}',
  'published',
  'hair-promotion',
  1,
  '[]',
  '[]'
);

insert into public.applications (
  id,
  opportunity_id,
  submission_attempt_id,
  submission_fingerprint,
  applicant_display_name,
  applicant_phone,
  applicant_birth_date,
  ruleset_id,
  ruleset_version,
  rules_snapshot,
  evaluation_snapshot
) values (
  '50000000-0000-4000-8000-000000000021',
  '50000000-0000-4000-8000-000000000011',
  '50000000-0000-4000-8000-000000000031',
  repeat('c', 64),
  'Selection applicant',
  '010-0000-0003',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
);

select throws_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'applicant',
      null,
      'applicant_confirmed',
      'applicant',
      null,
      null,
      null,
      '50000000-0000-4000-8000-000000000031'
    )
  $$,
  '42501',
  'Attendance is unavailable until recruiter selection.',
  'database rejects applicant attendance before selection'
);

select throws_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'recruiter',
      '50000000-0000-4000-8000-000000000001',
      'recruiter_confirmed',
      'recruiter',
      null,
      null,
      null,
      null
    )
  $$,
  '42501',
  'Attendance is unavailable until recruiter selection.',
  'database rejects recruiter attendance before selection'
);

select is(
  public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000002'
  ),
  null::jsonb,
  'another recruiter cannot select the application'
);

select is(
  (public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  )->>'applicationId'),
  '50000000-0000-4000-8000-000000000021',
  'owner selects the application'
);

select is(
  (select selected_by::text from public.applications where id = '50000000-0000-4000-8000-000000000021'),
  '50000000-0000-4000-8000-000000000001',
  'selection records the recruiter owner'
);

select ok(
  (select selected_at is not null from public.applications where id = '50000000-0000-4000-8000-000000000021'),
  'selection records its server timestamp'
);

select lives_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'applicant',
      null,
      'applicant_confirmed',
      'applicant',
      null,
      null,
      null,
      '50000000-0000-4000-8000-000000000031'
    )
  $$,
  'database allows attendance after selection while retaining applicant capability authorization'
);

select * from finish();

rollback;
