begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

select is(
  (select public from storage.buckets where id = 'application-photos'),
  false,
  'application photo bucket is private'
);

select ok(
  (
    select file_size_limit = 10485760
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
      and cardinality(allowed_mime_types) = 4
    from storage.buckets
    where id = 'application-photos'
  ),
  'application photo bucket limits uploads to approved MIME types and 10 MiB'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and ('anon' = any(roles) or 'public' = any(roles))
  ),
  0::bigint,
  'storage objects have no anonymous or public policy'
);

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
      'public.application_photo_upload_reservations'::regclass,
      'public.attendance_events'::regclass,
      'public.consent_events'::regclass
    )
      and relrowsecurity
  ),
  7::bigint,
  'RLS is enabled on every user-owned table'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.application_photo_upload_reservations',
    'SELECT'
  ),
  'authenticated users have no reservation read privilege'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.application_photo_upload_reservations',
    'SELECT'
  ),
  'anonymous users have no reservation read privilege'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.application_photo_upload_reservations',
    'SELECT, INSERT, UPDATE, DELETE'
  ),
  'service role owns reservation reconciliation privileges'
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
  submission_attempt_id,
  submission_fingerprint,
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
    '00000000-0000-4000-8000-000000000011',
    repeat('a', 64),
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
    '00000000-0000-4000-8000-000000000012',
    repeat('b', 64),
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

insert into public.application_photos (
  id,
  application_id,
  storage_path,
  content_type,
  byte_size,
  expires_at
)
values
  (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-0000-0000-000000000011',
    'opportunity/00000000-0000-0000-0000-000000000001/application/00000000-0000-0000-0000-000000000011/00000000-0000-4000-8000-000000000021',
    'image/jpeg',
    3,
    '2099-10-22T03:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000022',
    '00000000-0000-0000-0000-000000000012',
    'opportunity/00000000-0000-0000-0000-000000000002/application/00000000-0000-0000-0000-000000000012/00000000-0000-4000-8000-000000000022',
    'image/heic',
    4,
    '2099-10-22T03:00:00Z'
  );

insert into public.application_photo_upload_reservations (
  id,
  application_id,
  storage_path,
  content_type,
  byte_size
)
values (
  '00000000-0000-4000-8000-000000000024',
  '00000000-0000-0000-0000-000000000011',
  'opportunity/00000000-0000-0000-0000-000000000001/application/00000000-0000-0000-0000-000000000011/00000000-0000-4000-8000-000000000024',
  'image/jpeg',
  6
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
  ),
  (
    '00000000-0000-0000-0000-000000000011',
    'future_opportunity',
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

create temporary table submitted_application_results (result jsonb not null);

insert into submitted_application_results (result)
select public.submit_application_transaction(
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-4000-8000-000000000030',
  repeat('c', 64),
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

create temporary table submitted_application_ids as
select (result ->> 'applicationId')::uuid as id
from submitted_application_results;

update public.opportunities
set
  ruleset_id = 'hair-promotion-updated',
  ruleset_version = 2,
  rules_snapshot = '[{"id":"replacement","field":"isAvailable","operator":"equals","expected":false,"effect":"hard_fail","reason":"Changed after submission."}]',
  updated_at = now()
where id = '00000000-0000-0000-0000-000000000003';

select is(
  (
    select applications.ruleset_id
    from public.applications
    join submitted_application_ids on submitted_application_ids.id = applications.id
  ),
  'hair-promotion',
  'application keeps its submission-time ruleset identity'
);

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

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-4000-8000-000000000031',
      repeat('e', 64),
      'Null consent applicant',
      '010-0000-0004',
      '2000-01-01',
      '{"isAdult":true,"isAvailable":false}',
      null,
      false,
      'hair-promotion-updated',
      2,
      '[{"id":"replacement","field":"isAvailable","operator":"equals","expected":false,"effect":"hard_fail","reason":"Changed after submission."}]',
      '{"rulesetId":"hair-promotion-updated","rulesetVersion":2,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  '22023',
  'Current application consent is required.',
  'transaction fails closed when current consent is null'
);

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-4000-8000-000000000032',
      repeat('f', 64),
      'Incomplete evaluation applicant',
      '010-0000-0005',
      '2000-01-01',
      '{"isAdult":true,"isAvailable":false}',
      true,
      false,
      'hair-promotion-updated',
      2,
      '[{"id":"replacement","field":"isAvailable","operator":"equals","expected":false,"effect":"hard_fail","reason":"Changed after submission."}]',
      '{"rulesetId":"hair-promotion-updated","rulesetVersion":2,"eligible":true}'
    )
  $$,
  '22023',
  'Evaluation snapshot has an invalid shape.',
  'transaction fails closed when evaluation evidence is incomplete'
);

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-4000-8000-000000000033',
      repeat('1', 64),
      'Stale rules applicant',
      '010-0000-0006',
      '2000-01-01',
      '{"isAdult":true,"isAvailable":true}',
      true,
      false,
      'hair-promotion',
      1,
      '[{"id":"schedule-available","field":"isAvailable","operator":"equals","expected":true,"effect":"hard_fail","reason":"This schedule is unavailable."}]',
      '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  '40001',
  'Opportunity rules changed before submission.',
  'transaction rejects a stale opportunity rules snapshot'
);

update public.opportunities
set closed_at = now()
where id = '00000000-0000-0000-0000-000000000003';

select is(
  public.submit_application_transaction(
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-4000-8000-000000000030',
    repeat('c', 64),
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
  ),
  (select result from submitted_application_results),
  'an exact retry after rules mutation and closure returns the stored application result'
);

select is(
  (
    select count(*)::bigint
    from public.applications
    join submitted_application_ids on submitted_application_ids.id = applications.id
  ),
  1::bigint,
  'an exact retry leaves one application'
);

select is(
  (
    select count(*)::bigint
    from public.application_answers
    join submitted_application_ids
      on submitted_application_ids.id = application_answers.application_id
  ),
  2::bigint,
  'an exact retry leaves one answer set'
);

select is(
  (
    select count(*)::bigint
    from public.consent_events
    join submitted_application_ids
      on submitted_application_ids.id = consent_events.application_id
  ),
  2::bigint,
  'an exact retry leaves one consent set'
);

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-4000-8000-000000000030',
      repeat('d', 64),
      'Changed applicant',
      '010-9999-9999',
      '2000-01-01',
      '{"isAdult":true,"isAvailable":true}',
      true,
      false,
      'hair-promotion',
      1,
      '[{"id":"schedule-available","field":"isAvailable","operator":"equals","expected":true,"effect":"hard_fail","reason":"This schedule is unavailable."}]',
      '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  '22023',
  'Submission attempt payload does not match the original application.',
  'a changed payload cannot reuse a submission attempt ID'
);

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-4000-8000-000000000034',
      repeat('2', 64),
      'Closed opportunity applicant',
      '010-0000-0007',
      '2000-01-01',
      '{"isAdult":true,"isAvailable":false}',
      true,
      false,
      'hair-promotion-updated',
      2,
      '[{"id":"replacement","field":"isAvailable","operator":"equals","expected":false,"effect":"hard_fail","reason":"Changed after submission."}]',
      '{"rulesetId":"hair-promotion-updated","rulesetVersion":2,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  '22023',
  'Opportunity is closed.',
  'transaction rejects an opportunity with closed_at set'
);

update public.opportunities
set status = 'draft'
where id = '00000000-0000-0000-0000-000000000002';

select throws_ok(
  $$
    select public.submit_application_transaction(
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-4000-8000-000000000035',
      repeat('3', 64),
      'Draft opportunity applicant',
      '010-0000-0008',
      '2000-01-01',
      '{"isAdult":true}',
      true,
      false,
      'makeup-certification',
      1,
      '[]',
      '{"rulesetId":"makeup-certification","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  'P0002',
  'Opportunity not found.',
  'transaction rejects an unpublished opportunity'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.submit_application_transaction(uuid,uuid,text,text,text,date,jsonb,boolean,boolean,text,integer,jsonb,jsonb)',
    'EXECUTE'
  ),
  'anonymous role cannot execute the submission transaction'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.submit_application_transaction(uuid,uuid,text,text,text,date,jsonb,boolean,boolean,text,integer,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated role cannot execute the submission transaction'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.finalize_application_photo(uuid,uuid,uuid,uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'anonymous role cannot finalize an application photo'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_application_photo(uuid,uuid,uuid,uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'authenticated role cannot finalize an application photo'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_application_photo(uuid,uuid,uuid,uuid,text,text,bigint)',
    'EXECUTE'
  ),
  'service role can finalize an application photo'
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
) values (
  '00000000-0000-0000-0000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  'hair_promotion',
  'Photo opportunity',
  '2099-09-23T03:00:00Z',
  '2099-09-22T03:00:00Z',
  'Gangnam-gu',
  120,
  '{"type":"procedure","description":"Hair service"}',
  'published',
  'hair-photo',
  1,
  '[{"id":"photo-required","field":"requestedPhoto","operator":"equals","expected":true,"effect":"needs_review","reason":"Upload the requested job-specific photo."}]'
);

create temporary table pending_photo_results (result jsonb not null);
insert into pending_photo_results (result)
select public.submit_application_transaction(
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-4000-8000-000000000044',
  repeat('4', 64),
  'Pending photo applicant',
  '010-0000-0044',
  '2000-01-01',
  '{"isAdult":true}',
  true,
  false,
  'hair-photo',
  1,
  '[{"id":"photo-required","field":"requestedPhoto","operator":"equals","expected":true,"effect":"needs_review","reason":"Upload the requested job-specific photo."}]',
  '{"rulesetId":"hair-photo","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[{"ruleId":"photo-required","reason":"Upload the requested job-specific photo.","effect":"needs_review","input":null}],"reminders":[]}'
);

create temporary table pending_photo_ids as
select (result ->> 'applicationId')::uuid as id
from pending_photo_results;

select is(
  (
    select submission_state
    from public.applications
    join pending_photo_ids using (id)
  ),
  'pending_photo',
  'submission transaction derives pending_photo from stored rule evidence'
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
  (
    select count(*)::bigint
    from public.applications
    where opportunity_id = '00000000-0000-0000-0000-000000000004'
  ),
  0::bigint,
  'recruiter cannot read a pending photo application'
);

select is(
  (
    select count(*)::bigint
    from public.application_answers
    join public.applications
      on applications.id = application_answers.application_id
    where applications.opportunity_id = '00000000-0000-0000-0000-000000000004'
  ),
  0::bigint,
  'recruiter cannot read pending photo application answers'
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

select results_eq(
  $$ select consent_type from public.consent_events order by consent_type $$,
  $$ values ('current_application'::text) $$,
  'recruiter reads current-application consent but not future consent'
);

select throws_ok(
  $$
    insert into public.applications (
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
    )
    values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-4000-8000-000000000041',
      repeat('4', 64),
      'Direct write applicant',
      '010-1111-1111',
      '2000-01-01',
      'hair-promotion',
      1,
      '[]',
      '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "applications"',
  'authenticated recruiters cannot insert applications directly'
);

select throws_ok(
  $$
    insert into public.application_answers (application_id, field, value)
    values ('00000000-0000-0000-0000-000000000011', 'extra', 'true')
  $$,
  '42501',
  'new row violates row-level security policy for table "application_answers"',
  'authenticated recruiters cannot insert application answers directly'
);

select throws_ok(
  $$
    insert into public.application_photos (
      application_id,
      storage_path,
      content_type,
      byte_size,
      expires_at
    )
    values (
      '00000000-0000-0000-0000-000000000011',
      'opportunity/00000000-0000-0000-0000-000000000001/application/00000000-0000-0000-0000-000000000011/00000000-0000-4000-8000-000000000023',
      'image/png',
      5,
      '2099-10-22T03:00:00Z'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "application_photos"',
  'authenticated recruiters cannot insert application photos directly'
);

select throws_ok(
  $$
    insert into public.attendance_events (
      application_id,
      recorded_by,
      party,
      event_type
    )
    values (
      '00000000-0000-0000-0000-000000000011',
      '10000000-0000-4000-8000-000000000001',
      'recruiter',
      'completed'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "attendance_events"',
  'authenticated recruiters cannot insert attendance directly'
);

select throws_ok(
  $$
    insert into public.consent_events (application_id, consent_type, granted)
    values (
      '00000000-0000-0000-0000-000000000011',
      'future_opportunity',
      true
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "consent_events"',
  'authenticated recruiters cannot insert consent directly'
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
      submission_attempt_id,
      submission_fingerprint,
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
      '00000000-0000-4000-8000-000000000042',
      repeat('5', 64),
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

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    delete from public.opportunities
    where id = '00000000-0000-0000-0000-000000000001'
    returning id
  $$,
  $$ select null::uuid where false $$,
  'authenticated recruiters cannot delete owned opportunities'
);

reset role;

insert into public.application_photo_upload_reservations (
  id,
  application_id,
  storage_path,
  content_type,
  byte_size
)
select
  '00000000-0000-4000-8000-000000000044',
  id,
  'opportunity/00000000-0000-0000-0000-000000000004/application/' || id || '/00000000-0000-4000-8000-000000000044',
  'image/jpeg',
  3
from pending_photo_ids;

select is(
  public.finalize_application_photo(
    '00000000-0000-4000-8000-000000000044',
    (select id from pending_photo_ids),
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-4000-8000-000000000044',
    'opportunity/00000000-0000-0000-0000-000000000004/application/' || (select id from pending_photo_ids) || '/00000000-0000-4000-8000-000000000044',
    'image/jpeg',
    3
  ),
  jsonb_build_object(
    'applicationId', (select id from pending_photo_ids),
    'photoId', '00000000-0000-4000-8000-000000000044'::uuid,
    'submissionState', 'submitted'
  ),
  'photo finalization returns the submitted application receipt'
);

select is(
  (select submission_state from public.applications join pending_photo_ids using (id)),
  'submitted',
  'photo finalization advances pending_photo to submitted'
);

select ok(
  (select count(*) = 1 from public.application_photos where id = '00000000-0000-4000-8000-000000000044')
  and (select count(*) = 0 from public.application_photo_upload_reservations where id = '00000000-0000-4000-8000-000000000044'),
  'photo metadata insertion and reservation release commit atomically'
);

update public.opportunities
set
  status = 'closed',
  closed_at = '2099-08-01T03:00:00Z'
where id = '00000000-0000-0000-0000-000000000004';

select is(
  (
    select expires_at
    from public.application_photos
    where id = '00000000-0000-4000-8000-000000000044'
  ),
  '2099-08-31T03:00:00Z'::timestamptz,
  'early opportunity closure resets photo retention to actual closure plus 30 days'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::bigint
    from public.applications
    where opportunity_id = '00000000-0000-0000-0000-000000000004'
  ),
  1::bigint,
  'recruiter can read the application only after photo finalization'
);

reset role;

select throws_ok(
  $$
    delete from public.opportunities
    where id = '00000000-0000-0000-0000-000000000003'
  $$,
  '23503',
  'update or delete on table "opportunities" violates foreign key constraint "applications_opportunity_id_fkey" on table "applications"',
  'retained applications prevent privileged opportunity deletion'
);

select throws_ok(
  $$
    delete from auth.users
    where id = '20000000-0000-4000-8000-000000000002'
  $$,
  '23503',
  'update or delete on table "users" violates foreign key constraint "opportunities_recruiter_id_fkey" on table "opportunities"',
  'retained opportunities prevent privileged recruiter deletion'
);

select * from finish();
rollback;
