begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (id, aud, role, email, encrypted_password)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'publication-owner@example.test',
    ''
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'publication-other@example.test',
    ''
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.opportunities (
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
      '30000000-0000-4000-8000-000000000001',
      'hair_promotion',
      'Owned publication',
      '2099-09-23T03:00:00Z',
      '2099-09-22T03:00:00Z',
      'Gangnam-gu',
      90,
      '{"type":"procedure","description":"Hair service"}',
      'published',
      'hair-promotion',
      1,
      '[{"id":"adult-only","field":"isAdult","operator":"equals","expected":true,"effect":"hard_fail","reason":"Adults only."}]',
      '["adult-only"]'
    )
  $$,
  'authenticated recruiter can publish an opportunity they own after confirming every hard rule'
);

select throws_ok(
  $$
    insert into public.opportunities (
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
      '40000000-0000-4000-8000-000000000002',
      'hair_promotion',
      'Cross-owner publication',
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
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "opportunities"',
  'authenticated recruiter cannot publish under another recruiter id'
);

select throws_ok(
  $$
    insert into public.opportunities (
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
      '30000000-0000-4000-8000-000000000001',
      'hair_promotion',
      'Unconfirmed publication',
      '2099-09-23T03:00:00Z',
      '2099-09-22T03:00:00Z',
      'Gangnam-gu',
      90,
      '{"type":"procedure","description":"Hair service"}',
      'published',
      'hair-promotion',
      1,
      '[{"id":"adult-only","field":"isAdult","operator":"equals","expected":true,"effect":"hard_fail","reason":"Adults only."}]',
      '[]'
    )
  $$,
  '23514',
  'new row for relation "opportunities" violates check constraint "opportunities_hard_rule_confirmations_complete"',
  'database rejects publication with an unconfirmed hard rule'
);

select * from finish();

rollback;
