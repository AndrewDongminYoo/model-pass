begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '10000000-0000-4000-8000-000000000009',
  'authenticated',
  'authenticated',
  'privacy-recruiter@example.test',
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
  rules_snapshot
)
values (
  '00000000-0000-4000-8000-000000000901',
  '10000000-0000-4000-8000-000000000009',
  'hair_promotion',
  'Privacy contract opportunity',
  '2099-09-23T03:00:00Z',
  '2099-09-22T03:00:00Z',
  'Gangnam-gu',
  120,
  '{"type":"procedure","description":"Hair service"}',
  'published',
  'hair-promotion',
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
values (
  '00000000-0000-4000-8000-000000000911',
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000921',
  repeat('9', 64),
  'Privacy applicant',
  '010-0000-0009',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
);

update public.applications
set
  selected_at = now(),
  selected_by = '10000000-0000-4000-8000-000000000009'
where id = '00000000-0000-4000-8000-000000000911';

insert into public.consent_events (application_id, consent_type, granted)
values (
  '00000000-0000-4000-8000-000000000911',
  'future_opportunity',
  true
);

insert into public.application_answers (application_id, field, value)
values (
  '00000000-0000-4000-8000-000000000911',
  'recentBleach',
  '"none"'::jsonb
);

insert into public.attendance_events (
  application_id,
  recorded_by,
  actor_party,
  party,
  event_type
)
values (
  '00000000-0000-4000-8000-000000000911',
  null,
  'applicant',
  'applicant',
  'completed'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.applicant_privacy_requests'::regclass
  ),
  'RLS is enabled on applicant privacy requests'
);

select ok(
  not has_table_privilege('anon', 'public.applicant_privacy_requests', 'SELECT, INSERT, UPDATE, DELETE'),
  'anonymous users have no direct privacy-request table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.applicant_privacy_requests', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated users have no direct privacy-request table privileges'
);

select ok(
  has_table_privilege('service_role', 'public.applicant_privacy_requests', 'SELECT')
  and not has_table_privilege('service_role', 'public.applicant_privacy_requests', 'INSERT, UPDATE, DELETE'),
  'the service role can list privacy requests but cannot mutate them directly'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.applicant_privacy_request_events'::regclass
  ),
  'RLS is enabled on privacy request processing events'
);

select ok(
  not has_table_privilege('anon', 'public.applicant_privacy_request_events', 'SELECT, INSERT, UPDATE, DELETE'),
  'anonymous users have no direct processing-event privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.applicant_privacy_request_events', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated users have no direct processing-event privileges'
);

select ok(
  has_table_privilege('service_role', 'public.applicant_privacy_request_events', 'SELECT')
  and not has_table_privilege('service_role', 'public.applicant_privacy_request_events', 'INSERT, UPDATE, DELETE'),
  'the service role can review processing events but cannot mutate them directly'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.manage_applicant_privacy(uuid, uuid, uuid, text)',
    'EXECUTE'
  ),
  'anonymous users cannot invoke the privacy RPC directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.manage_applicant_privacy(uuid, uuid, uuid, text)',
    'EXECUTE'
  ),
  'authenticated users cannot invoke the privacy RPC directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.manage_applicant_privacy(uuid, uuid, uuid, text)',
    'EXECUTE'
  ),
  'the service role can invoke the privacy RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.fulfill_applicant_deletion_request(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot fulfill deletion requests'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.fulfill_applicant_deletion_request(uuid)',
    'EXECUTE'
  ),
  'authenticated users cannot fulfill deletion requests'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.fulfill_applicant_deletion_request(uuid)',
    'EXECUTE'
  ),
  'the service role can fulfill deletion requests through the operator RPC'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.record_attendance_event(uuid,text,uuid,text,text,uuid,text,timestamptz)',
    'EXECUTE'
  ),
  'the service role cannot bypass the atomic applicant attendance wrapper'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_attendance_event_authorized(uuid,text,uuid,text,text,uuid,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the service role records attendance only through the atomic authorization wrapper'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000921',
    'revoke_future_opportunity_consent'
  ),
  '{"action": "revoke_future_opportunity_consent", "status": "accepted"}'::jsonb,
  'a matching capability accepts a consent revocation'
);

select is(
  (
    select count(*)::bigint
    from public.consent_events
    where application_id = '00000000-0000-4000-8000-000000000911'
      and consent_type = 'future_opportunity'
      and granted = false
  ),
  1::bigint,
  'revocation appends one negative consent event'
);

select is(
  (
    select count(*)::bigint
    from public.consent_events
    where application_id = '00000000-0000-4000-8000-000000000911'
      and consent_type = 'future_opportunity'
      and granted = true
  ),
  1::bigint,
  'revocation preserves the prior positive consent event'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000921',
    'revoke_future_opportunity_consent'
  ),
  '{"action": "revoke_future_opportunity_consent", "status": "accepted"}'::jsonb,
  'an identical revocation retry returns the original result'
);

select is(
  (
    select count(*)::bigint
    from public.consent_events
    where application_id = '00000000-0000-4000-8000-000000000911'
      and consent_type = 'future_opportunity'
      and granted = false
  ),
  1::bigint,
  'an identical revocation retry is idempotent'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000921',
    'request_deletion'
  ),
  '{"action": "request_deletion", "status": "pending"}'::jsonb,
  'a matching capability records a pending deletion request'
);

select is(
  (
    select count(*)::bigint
    from public.applicant_privacy_request_events event
    join public.applicant_privacy_requests request
      on request.id = event.request_id
    where request.application_id = '00000000-0000-4000-8000-000000000911'
      and request.action = 'request_deletion'
      and event.event_type = 'pending'
  ),
  1::bigint,
  'the initial deletion request appends one pending processing event'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000921',
    'request_deletion'
  ),
  '{"action": "request_deletion", "status": "pending"}'::jsonb,
  'an identical deletion retry returns the original result'
);

select is(
  (
    select count(*)::bigint
    from public.applicant_privacy_request_events event
    join public.applicant_privacy_requests request
      on request.id = event.request_id
    where request.application_id = '00000000-0000-4000-8000-000000000911'
      and request.action = 'request_deletion'
      and event.event_type = 'pending'
  ),
  1::bigint,
  'an identical deletion retry does not append another pending event'
);

select is(
  (
    select count(*)::bigint
    from public.applications
    where id = '00000000-0000-4000-8000-000000000911'
  ),
  1::bigint,
  'a deletion request does not delete the application immediately'
);

select throws_ok(
  $$
    select public.fulfill_applicant_deletion_request(
      (
        select id
        from public.applicant_privacy_requests
        where application_id = '00000000-0000-4000-8000-000000000911'
          and action = 'request_deletion'
      )
    )
  $$,
  '55000',
  'Deletion request is not eligible until 30 days after closure.',
  'fulfillment fails before the opportunity has been closed for 30 days'
);

update public.opportunities
set closes_at = now() - interval '29 days'
where id = '00000000-0000-4000-8000-000000000901';

select throws_ok(
  $$
    select public.fulfill_applicant_deletion_request(
      (
        select id
        from public.applicant_privacy_requests
        where application_id = '00000000-0000-4000-8000-000000000911'
          and action = 'request_deletion'
      )
    )
  $$,
  '55000',
  'Deletion request is not eligible until 30 days after closure.',
  'fulfillment rejects a published opportunity whose scheduled closure is less than 30 days old'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000999',
    'request_deletion'
  ),
  null::jsonb,
  'a wrong capability cannot record a privacy request'
);

select throws_ok(
  $$
    select public.manage_applicant_privacy(
      '00000000-0000-4000-8000-000000000911',
      '00000000-0000-4000-8000-000000000901',
      '00000000-0000-4000-8000-000000000921',
      'delete_immediately'
    )
  $$,
  '22023',
  'Unsupported privacy action.',
  'the privacy RPC rejects unsupported actions'
);

select throws_ok(
  $$
    update public.consent_events
    set granted = true
    where application_id = '00000000-0000-4000-8000-000000000911'
      and granted = false
  $$,
  'P0001',
  'Consent history is append-only.',
  'consent history cannot be updated'
);

select throws_ok(
  $$
    delete from public.consent_events
    where application_id = '00000000-0000-4000-8000-000000000911'
  $$,
  'P0001',
  'Consent history is append-only.',
  'consent history cannot be deleted while its application is retained'
);

select throws_ok(
  $$
    delete from public.applicant_privacy_requests
    where application_id = '00000000-0000-4000-8000-000000000911'
  $$,
  'P0001',
  'Applicant privacy requests are append-only.',
  'privacy requests cannot be deleted'
);

update public.opportunities
set
  status = 'closed',
  closed_at = now() - interval '31 days'
where id = '00000000-0000-4000-8000-000000000901';

insert into public.retention_holds (
  id,
  application_id,
  reason,
  opened_at
)
values (
  '00000000-0000-4000-8000-000000000931',
  '00000000-0000-4000-8000-000000000911',
  'legal_obligation',
  now() - interval '20 days'
);

select throws_ok(
  $$
    select public.fulfill_applicant_deletion_request(
      (
        select id
        from public.applicant_privacy_requests
        where application_id = '00000000-0000-4000-8000-000000000911'
          and action = 'request_deletion'
      )
    )
  $$,
  '55000',
  'Deletion request is blocked by an active retention hold.',
  'fulfillment fails closed while a retention hold is active'
);

update public.retention_holds
set released_at = now()
where id = '00000000-0000-4000-8000-000000000931';

insert into public.application_photos (
  id,
  application_id,
  storage_path,
  expires_at,
  content_type,
  byte_size
)
values (
  '00000000-0000-4000-8000-000000000941',
  '00000000-0000-4000-8000-000000000911',
  'opportunity/00000000-0000-4000-8000-000000000901/application/00000000-0000-4000-8000-000000000911/00000000-0000-4000-8000-000000000941',
  now() - interval '1 day',
  'image/jpeg',
  1024
);

select throws_ok(
  $$
    select public.fulfill_applicant_deletion_request(
      (
        select id
        from public.applicant_privacy_requests
        where application_id = '00000000-0000-4000-8000-000000000911'
          and action = 'request_deletion'
      )
    )
  $$,
  '55000',
  'Deletion request is blocked until all application photos are deleted.',
  'fulfillment fails closed while an application photo remains undeleted'
);

update public.application_photos
set
  deleted_at = now(),
  deletion_reason = 'retention_expired',
  deletion_invocation_id = '00000000-0000-4000-8000-000000000942'
where id = '00000000-0000-4000-8000-000000000941';

create temporary table fulfilled_deletion_result as
select public.fulfill_applicant_deletion_request(
  (
    select id
    from public.applicant_privacy_requests
    where application_id = '00000000-0000-4000-8000-000000000911'
      and action = 'request_deletion'
  )
) as result;

select is(
  (select result ->> 'status' from fulfilled_deletion_result),
  'fulfilled',
  'an explicitly closed opportunity older than 30 days is fulfilled'
);

select ok(
  (
    select applicant_display_name is null
      and applicant_phone is null
      and applicant_birth_date is null
    from public.applications
    where id = '00000000-0000-4000-8000-000000000911'
  ),
  'fulfillment removes direct applicant identifiers'
);

select is(
  (
    select count(*)::bigint
    from public.application_answers
    where application_id = '00000000-0000-4000-8000-000000000911'
  ),
  0::bigint,
  'fulfillment removes applicant answers'
);

select is(
  (
    select evaluation_snapshot
    from public.applications
    where id = '00000000-0000-4000-8000-000000000911'
  ),
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'::jsonb,
  'fulfillment retains only the minimum ruleset and result facts from evaluation detail'
);

select ok(
  (
    select submission_attempt_id <> '00000000-0000-4000-8000-000000000921'
      and submission_fingerprint <> repeat('9', 64)
    from public.applications
    where id = '00000000-0000-4000-8000-000000000911'
  ),
  'fulfillment rotates the submission capability and fingerprint'
);

select is(
  public.manage_applicant_privacy(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000921',
    'request_deletion'
  ),
  null::jsonb,
  'the pre-fulfillment submission capability is revoked'
);

select throws_ok(
  $$
    select public.record_attendance_event_authorized(
      '00000000-0000-4000-8000-000000000911',
      'applicant',
      null,
      'applicant_confirmed',
      'applicant',
      null,
      null,
      null,
      '00000000-0000-4000-8000-000000000921'
    )
  $$,
  '42501',
  'Applicant attendance capability is invalid.',
  'the pre-fulfillment capability cannot append attendance after rotation'
);

select is(
  (
    select count(*)::bigint
    from public.attendance_events
    where application_id = '00000000-0000-4000-8000-000000000911'
  ),
  1::bigint,
  'a rejected stale-capability replay does not append an attendance event'
);

select is(
  (
    select jsonb_agg(event.event_type order by event.occurred_at, event.id)
    from public.applicant_privacy_request_events event
    join public.applicant_privacy_requests request
      on request.id = event.request_id
    where request.application_id = '00000000-0000-4000-8000-000000000911'
      and request.action = 'request_deletion'
  ),
  '["pending", "fulfilled"]'::jsonb,
  'fulfillment appends a fulfilled event after the pending event'
);

select ok(
  (
    select count(*) = 2
    from public.consent_events
    where application_id = '00000000-0000-4000-8000-000000000911'
  )
  and (
    select count(*) = 1
    from public.attendance_events
    where application_id = '00000000-0000-4000-8000-000000000911'
  )
  and (
    select count(*) = 2
    from public.applicant_privacy_requests
    where application_id = '00000000-0000-4000-8000-000000000911'
  ),
  'fulfillment preserves consent, attendance, and request audit facts'
);

select is(
  public.fulfill_applicant_deletion_request(
    (
      select id
      from public.applicant_privacy_requests
      where application_id = '00000000-0000-4000-8000-000000000911'
        and action = 'request_deletion'
    )
  ),
  (select result from fulfilled_deletion_result),
  'a repeated fulfillment returns the original audit result'
);

select is(
  (
    select count(*)::bigint
    from public.applicant_privacy_request_events event
    join public.applicant_privacy_requests request
      on request.id = event.request_id
    where request.application_id = '00000000-0000-4000-8000-000000000911'
      and request.action = 'request_deletion'
      and event.event_type = 'fulfilled'
  ),
  1::bigint,
  'a repeated fulfillment does not append another fulfilled event'
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
  '00000000-0000-4000-8000-000000000902',
  '10000000-0000-4000-8000-000000000009',
  'hair_promotion',
  'Scheduled closure privacy opportunity',
  now() - interval '30 days',
  now() - interval '31 days',
  'Gangnam-gu',
  120,
  '{"type":"procedure","description":"Hair service"}',
  'published',
  'hair-promotion',
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
values (
  '00000000-0000-4000-8000-000000000912',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000922',
  repeat('8', 64),
  'Scheduled closure applicant',
  '010-0000-0010',
  '2000-01-01',
  'hair-promotion',
  1,
  '[]',
  '{"rulesetId":"hair-promotion","rulesetVersion":1,"eligible":true,"failures":[],"reviews":[],"reminders":[]}'
);

create temporary table scheduled_deletion_request_result as
select public.manage_applicant_privacy(
  '00000000-0000-4000-8000-000000000912',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000922',
  'request_deletion'
) as result;

select is(
  (
    public.fulfill_applicant_deletion_request(
      (
        select id
        from public.applicant_privacy_requests
        where application_id = '00000000-0000-4000-8000-000000000912'
          and action = 'request_deletion'
      )
    ) ->> 'status'
  ),
  'fulfilled',
  'fulfillment accepts a published opportunity whose scheduled closure is more than 30 days old'
);

select throws_ok(
  $$
    update public.applicant_privacy_request_events
    set occurred_at = occurred_at
    where event_type = 'fulfilled'
  $$,
  'P0001',
  'Applicant privacy request events are append-only.',
  'processing events cannot be updated directly'
);

select throws_ok(
  $$
    delete from public.applicant_privacy_request_events
    where event_type = 'fulfilled'
  $$,
  'P0001',
  'Applicant privacy request events are append-only.',
  'processing events cannot be deleted directly'
);

select * from finish();
rollback;
