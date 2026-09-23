begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

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
    select public.unselect_application_for_recruiter(
      '50000000-0000-4000-8000-000000000021',
      '50000000-0000-4000-8000-000000000011',
      '50000000-0000-4000-8000-000000000001'
    )
  $$,
  'owner can undo a mistaken selection before attendance activity'
);

select is(
  (select selected_at from public.applications where id = '50000000-0000-4000-8000-000000000021'),
  null::timestamptz,
  'undo clears the selection timestamp'
);

select is(
  (public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  )->>'applicationId'),
  '50000000-0000-4000-8000-000000000021',
  'owner can reselect before attendance activity'
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

select lives_ok(
  $$
    select public.unselect_application_for_recruiter(
      '50000000-0000-4000-8000-000000000021',
      '50000000-0000-4000-8000-000000000011',
      '50000000-0000-4000-8000-000000000001'
    )
  $$,
  'attendance activity does not permit an unsafe reversal'
);

select ok(
  (select selected_at is not null from public.applications where id = '50000000-0000-4000-8000-000000000021'),
  'attendance activity keeps the selection in place'
);

insert into public.applications (
  id, opportunity_id, submission_attempt_id, submission_fingerprint,
  applicant_display_name, applicant_phone, applicant_birth_date,
  ruleset_id, ruleset_version, rules_snapshot, evaluation_snapshot
)
select ids.application_id, application.opportunity_id, ids.attempt_id,
  application.submission_fingerprint, application.applicant_display_name,
  application.applicant_phone, application.applicant_birth_date,
  application.ruleset_id, application.ruleset_version,
  application.rules_snapshot, application.evaluation_snapshot
from public.applications application
cross join (values
  ('50000000-0000-4000-8000-000000000022'::uuid, '50000000-0000-4000-8000-000000000032'::uuid),
  ('50000000-0000-4000-8000-000000000023'::uuid, '50000000-0000-4000-8000-000000000033'::uuid)
) ids(application_id, attempt_id)
where application.id = '50000000-0000-4000-8000-000000000021';

update public.opportunities
set starts_at = clock_timestamp() + interval '1 second',
    closes_at = clock_timestamp() + interval '500 milliseconds'
where id = '50000000-0000-4000-8000-000000000011';

select is(
  (public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000023',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  )->>'applicationId'),
  '50000000-0000-4000-8000-000000000023',
  'selection succeeds before the real-time boundary'
);

select pg_sleep(1.2);

select is(
  public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000022',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  ),
  null::jsonb,
  'selection fails after the boundary even in a transaction started earlier'
);

select is(
  public.unselect_application_for_recruiter(
    '50000000-0000-4000-8000-000000000023',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  ),
  null::jsonb,
  'unselection fails after the boundary even in a transaction started earlier'
);

select throws_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'applicant', null, 'applicant_cancelled', 'applicant',
      null, null, null, '50000000-0000-4000-8000-000000000031'
    )
  $$,
  '22023',
  'Attendance cancellation is only available before the appointment.',
  'cancellation fails after the real-time boundary in an earlier transaction'
);

update public.opportunities
set starts_at = now() - interval '1 minute',
    closes_at = now() - interval '1 day'
where id = '50000000-0000-4000-8000-000000000011';

select is(
  public.select_application_for_recruiter(
    '50000000-0000-4000-8000-000000000021',
    '50000000-0000-4000-8000-000000000011',
    '50000000-0000-4000-8000-000000000001'
  ),
  null::jsonb,
  'database refuses selection after the appointment begins'
);

select throws_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'applicant',
      null,
      'applicant_cancelled',
      'applicant',
      null,
      null,
      null,
      '50000000-0000-4000-8000-000000000031'
    )
  $$,
  '22023',
  'Attendance cancellation is only available before the appointment.',
  'database rejects a late applicant cancellation even through the authorized RPC'
);

select lives_ok(
  $$
    select public.record_attendance_event_authorized(
      '50000000-0000-4000-8000-000000000021',
      'recruiter',
      '50000000-0000-4000-8000-000000000001',
      'applicant_no_show',
      'applicant',
      null,
      null,
      null,
      null
    )
  $$,
  'recruiter can record the applicant no-show after a rejected late cancellation'
);

select * from finish();

rollback;
