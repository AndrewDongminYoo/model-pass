begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '60000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'prelaunch-owner@example.test',
  ''
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    insert into public.opportunities (
      recruiter_id, category, title, starts_at, closes_at, venue_district,
      expected_minutes, benefit, status, ruleset_id, ruleset_version,
      rules_snapshot, confirmed_hard_rule_ids
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'hair_promotion', 'Bypassed validation', now() + interval '2 days',
      now() + interval '1 day', 'Gangnam-gu', 90,
      '{"type":"procedure","description":"Hair service"}',
      'published', 'hair-promotion', 1, '[]', '[]'
    )
  $$,
  '42501',
  'permission denied for table opportunities',
  'authenticated owner cannot bypass publication validation with direct insert'
);

reset role;

insert into public.opportunities (
  id, recruiter_id, category, title, starts_at, closes_at, venue_district,
  expected_minutes, benefit, status, ruleset_id, ruleset_version,
  rules_snapshot, confirmed_hard_rule_ids
) values (
  '60000000-0000-4000-8000-000000000011',
  '60000000-0000-4000-8000-000000000001',
  'hair_promotion', 'Original title', now() + interval '2 days',
  now() + interval '1 day', 'Gangnam-gu', 90,
  '{"type":"procedure","description":"Hair service"}',
  'published', 'hair-promotion', 1, '[]', '[]'
);

set local role authenticated;

select throws_ok(
  $$
    update public.opportunities
    set title = 'Bait-and-switch', status = 'closed', closed_at = null
    where id = '60000000-0000-4000-8000-000000000011'
  $$,
  '42501',
  'permission denied for table opportunities',
  'authenticated owner cannot mutate an opportunity after applications arrive'
);

reset role;

select lives_ok(
  $$
    select public.publish_opportunity_for_recruiter(
      '60000000-0000-4000-8000-000000000001',
      'hair_promotion', 'Server publication',
      now() + interval '2 days', now() + interval '1 day',
      'Gangnam-gu', 90,
      '{"type":"procedure","description":"Hair service"}',
      'hair-promotion', 1, '[]', '[]'
    )
  $$,
  'server publication still creates an opportunity'
);

select is(
  (select count(*)::integer from public.opportunities where title = 'Server publication'),
  1,
  'the server publication is persisted exactly once'
);

select throws_ok(
  $$
    insert into public.opportunities (
      recruiter_id, category, title, starts_at, closes_at, closed_at,
      venue_district, expected_minutes, benefit, status, ruleset_id,
      ruleset_version, rules_snapshot, confirmed_hard_rule_ids
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'hair_promotion', 'Inconsistent closure', now() + interval '2 days',
      now() + interval '1 day', null, 'Gangnam-gu', 90,
      '{"type":"procedure","description":"Hair service"}',
      'closed', 'hair-promotion', 1, '[]', '[]'
    )
  $$,
  '23514',
  'new row for relation "opportunities" violates check constraint "opportunities_closure_consistent"',
  'database rejects a closed opportunity without a closure timestamp'
);

select lives_ok(
  $$
    select public.close_opportunity_for_recruiter(
      '60000000-0000-4000-8000-000000000011',
      '60000000-0000-4000-8000-000000000001'
    )
  $$,
  'the owner can close an opportunity through the server operation'
);

select is(
  (select closed_at is not null and status = 'closed'
   from public.opportunities
   where id = '60000000-0000-4000-8000-000000000011'),
  true,
  'server closure sets status and timestamp atomically'
);

select is(
  public.close_opportunity_for_recruiter(
    '60000000-0000-4000-8000-000000000011',
    '60000000-0000-4000-8000-000000000001'
  )->>'status',
  'closed',
  'a response-loss retry returns the original closure'
);

select throws_ok(
  $$
    update public.opportunities
    set status = 'published', closed_at = null
    where id = '60000000-0000-4000-8000-000000000011'
  $$,
  '22023',
  'An opportunity closure cannot be reversed or delayed.',
  'even privileged writes cannot reopen a closed opportunity'
);

select is(public.consume_anonymous_request_quota(
  '60000000-0000-4000-8000-000000000011', 'submit_application', repeat('a', 64), 2
), true, 'first anonymous request fits the quota');

select is(public.consume_anonymous_request_quota(
  '60000000-0000-4000-8000-000000000011', 'submit_application', repeat('a', 64), 2
), true, 'second anonymous request fits the quota');

select is(public.consume_anonymous_request_quota(
  '60000000-0000-4000-8000-000000000011', 'submit_application', repeat('a', 64), 2
), false, 'third anonymous request is blocked');

select is(public.consume_anonymous_request_quota(
  '60000000-0000-4000-8000-000000000011', 'create_photo_upload', repeat('a', 64), 1
), true, 'photo upload grants have a separate quota');

select is(public.consume_anonymous_request_quota(
  '60000000-0000-4000-8000-000000000011', 'submit_application', repeat('b', 64), 2
), true, 'one source cannot exhaust another source quota');

select is(
  has_function_privilege(
    'authenticated',
    'public.consume_anonymous_request_quota(uuid,text,text,integer)',
    'execute'
  ),
  false,
  'clients cannot reset or consume quota directly'
);

select * from finish();

rollback;
