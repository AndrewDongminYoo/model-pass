begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'recruiter-a@example.test',
    ''
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'recruiter-b@example.test',
    ''
  );

select is(
  (
    select count(*)::bigint
    from pg_class
    where oid in (
      'public.opportunities'::regclass,
      'public.applications'::regclass,
      'public.application_answers'::regclass,
      'public.application_photos'::regclass,
      'public.attendance_events'::regclass,
      'public.consent_events'::regclass
    )
      and relrowsecurity
  ),
  6::bigint,
  'RLS is enabled on every user-owned table'
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
  rules_snapshot
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'hair_promotion',
    'Owned opportunity',
    '2099-09-23T03:00:00Z',
    '2099-09-22T03:00:00Z',
    'Gangnam-gu',
    120,
    '{"type":"procedure","description":"Hair service"}',
    'published',
    'hair-promotion',
    1,
    '[]'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'makeup_certification',
    'Other recruiter opportunity',
    '2099-09-23T03:00:00Z',
    '2099-09-22T03:00:00Z',
    'Gangnam-gu',
    120,
    '{"type":"cash","amount":50000,"description":"Cash"}',
    'published',
    'makeup-certification',
    1,
    '[]'
  );

insert into public.applications (
  id,
  opportunity_id,
  applicant_display_name,
  applicant_phone,
  applicant_birth_date,
  ruleset_id,
  ruleset_version,
  rules_snapshot,
  evaluation_snapshot
)
values
  (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    'Owned applicant',
    '010-0000-0001',
    '2000-01-01',
    'hair-promotion',
    1,
    '[]',
    '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000002',
    'Other applicant',
    '010-0000-0002',
    '2000-01-01',
    'makeup-certification',
    1,
    '[]',
    '{"rulesetId":"makeup-certification","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
  );

insert into public.application_answers (application_id, field, value)
values
  ('00000000-0000-0000-0000-000000000011', 'isAvailable', 'true'),
  ('00000000-0000-0000-0000-000000000012', 'isAvailable', 'true');

insert into public.application_photos (application_id, storage_path, expires_at)
values
  (
    '00000000-0000-0000-0000-000000000011',
    'applications/11/photo.jpg',
    '2099-10-22T03:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    'applications/12/photo.jpg',
    '2099-10-22T03:00:00Z'
  );

insert into public.attendance_events (
  application_id,
  recorded_by,
  party,
  event_type
)
values
  (
    '00000000-0000-0000-0000-000000000011',
    '10000000-0000-4000-8000-000000000001',
    'applicant',
    'completed'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    '20000000-0000-4000-8000-000000000002',
    'applicant',
    'completed'
  );

insert into public.consent_events (application_id, consent_type, granted)
values
  (
    '00000000-0000-0000-0000-000000000011',
    'current_application',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    'current_application',
    true
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
  rules_snapshot
)
values (
  '00000000-0000-0000-0000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  'hair_promotion',
  'Snapshot opportunity',
  '2099-09-23T03:00:00Z',
  '2099-09-22T03:00:00Z',
  'Gangnam-gu',
  120,
  '{"type":"procedure","description":"Hair service"}',
  'published',
  'hair-promotion',
  1,
  '[{"id":"schedule-available","field":"isAvailable","operator":"equals","expected":true,"effect":"hard_fail","reason":"This schedule is unavailable."}]'
);

create temporary table submitted_application_ids (id uuid not null);

insert into submitted_application_ids (id)
select public.submit_application_transaction(
  '00000000-0000-0000-0000-000000000003',
  'Snapshot applicant',
  '010-0000-0003',
  '2000-01-01',
  '{"isAdult":true,"isAvailable":true}',
  true,
  false,
  'hair-promotion',
  1,
  '[{"id":"schedule-available","field":"isAvailable","operator":"equals","expected":true,"effect":"hard_fail","reason":"This schedule is unavailable."}]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
);

update public.opportunities
set
  ruleset_version = 2,
  rules_snapshot = '[{"id":"replacement","field":"isAvailable","operator":"equals","expected":false,"effect":"hard_fail","reason":"Changed after submission."}]',
  updated_at = now()
where id = '00000000-0000-0000-0000-000000000003';

select is(
  (
    select applications.ruleset_version
    from public.applications
    join submitted_application_ids on submitted_application_ids.id = applications.id
  ),
  1,
  'application keeps its submission-time ruleset version'
);

select is(
  (
    select applications.rules_snapshot -> 0 ->> 'reason'
    from public.applications
    join submitted_application_ids on submitted_application_ids.id = applications.id
  ),
  'This schedule is unavailable.',
  'application keeps its submission-time rules snapshot'
);

select is(
  (
    select count(*)::bigint
    from public.application_answers
    join submitted_application_ids
      on submitted_application_ids.id = application_answers.application_id
  ),
  2::bigint,
  'transaction persists every evaluated answer'
);

select results_eq(
  $$
    select consent_type, granted
    from public.consent_events
    join submitted_application_ids
      on submitted_application_ids.id = consent_events.application_id
    order by consent_type
  $$,
  $$
    values
      ('current_application'::text, true),
      ('future_opportunity'::text, false)
  $$,
  'transaction preserves current and future consent separately'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    select count(*)::bigint
    from public.applications
    where opportunity_id = '00000000-0000-0000-0000-000000000001'
  $$,
  $$ values (1::bigint) $$,
  'recruiter can read an owned application'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.applications
    where opportunity_id = '00000000-0000-0000-0000-000000000002'
  $$,
  $$ values (0::bigint) $$,
  'recruiter cannot read another recruiter application'
);

select is(
  (select count(*)::bigint from public.application_answers),
  1::bigint,
  'recruiter reads answers only for owned opportunities'
);

select is(
  (select count(*)::bigint from public.application_photos),
  1::bigint,
  'recruiter reads photos only for owned opportunities'
);

select is(
  (select count(*)::bigint from public.attendance_events),
  1::bigint,
  'recruiter reads attendance only for owned opportunities'
);

select is(
  (select count(*)::bigint from public.consent_events),
  1::bigint,
  'recruiter reads consents only for owned opportunities'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"role":"anon"}',
  true
);

select throws_ok(
  $$
    insert into public.applications (
      opportunity_id,
      applicant_display_name,
      applicant_phone,
      applicant_birth_date,
      ruleset_id,
      ruleset_version,
      rules_snapshot,
      evaluation_snapshot
    )
    values (
      '00000000-0000-0000-0000-000000000001',
      'Anonymous applicant',
      '010-9999-9999',
      '2000-01-01',
      'hair-promotion',
      1,
      '[]',
      '{"eligible":true}'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "applications"',
  'anonymous clients cannot insert applications directly'
);

select * from finish();
rollback;
