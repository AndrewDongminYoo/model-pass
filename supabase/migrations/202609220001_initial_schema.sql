create extension if not exists pgcrypto with schema extensions;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete restrict,
  category text not null check (category in ('hair_promotion', 'makeup_certification')),
  title text not null,
  starts_at timestamptz not null,
  closes_at timestamptz not null,
  closed_at timestamptz,
  venue_district text not null,
  expected_minutes integer not null check (expected_minutes > 0),
  benefit jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  ruleset_id text not null,
  ruleset_version integer not null check (ruleset_version > 0),
  rules_snapshot jsonb not null check (jsonb_typeof(rules_snapshot) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at < starts_at)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  submission_attempt_id uuid not null,
  submission_fingerprint text not null check (submission_fingerprint ~ '^[0-9a-f]{64}$'),
  applicant_display_name text not null,
  applicant_phone text not null,
  applicant_birth_date date not null,
  ruleset_id text not null,
  ruleset_version integer not null check (ruleset_version > 0),
  rules_snapshot jsonb not null check (jsonb_typeof(rules_snapshot) = 'array'),
  evaluation_snapshot jsonb not null check (jsonb_typeof(evaluation_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (opportunity_id, submission_attempt_id)
);

create index applications_opportunity_id_idx
  on public.applications(opportunity_id, created_at);

create table public.application_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  field text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (application_id, field)
);

create table public.application_photos (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  storage_path text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null,
  party text not null check (party in ('recruiter', 'applicant')),
  event_type text not null check (
    event_type in ('completed', 'cancelled', 'no_show', 'disputed', 'resolved')
  ),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  consent_type text not null check (
    consent_type in ('current_application', 'future_opportunity')
  ),
  granted boolean not null,
  occurred_at timestamptz not null default now()
);

alter table public.opportunities enable row level security;
alter table public.applications enable row level security;
alter table public.application_answers enable row level security;
alter table public.application_photos enable row level security;
alter table public.attendance_events enable row level security;
alter table public.consent_events enable row level security;

create or replace function public.submit_application_transaction(
  p_opportunity_id uuid,
  p_submission_attempt_id uuid,
  p_submission_fingerprint text,
  p_applicant_display_name text,
  p_applicant_phone text,
  p_applicant_birth_date date,
  p_answers jsonb,
  p_current_application_consent boolean,
  p_future_opportunity_consent boolean,
  p_ruleset_id text,
  p_ruleset_version integer,
  p_rules_snapshot jsonb,
  p_evaluation_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_opportunity public.opportunities%rowtype;
  existing_application_id uuid;
  existing_submission_fingerprint text;
  existing_evaluation_snapshot jsonb;
  new_application_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_opportunity_id::text || ':' || p_submission_attempt_id::text,
      0
    )
  );

  select id, submission_fingerprint, evaluation_snapshot
  into
    existing_application_id,
    existing_submission_fingerprint,
    existing_evaluation_snapshot
  from public.applications
  where opportunity_id = p_opportunity_id
    and submission_attempt_id = p_submission_attempt_id;

  if found then
    if existing_submission_fingerprint is distinct from p_submission_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'Submission attempt payload does not match the original application.';
    end if;

    return jsonb_build_object(
      'applicationId', existing_application_id,
      'evaluation', existing_evaluation_snapshot
    );
  end if;

  if p_current_application_consent is not true then
    raise exception using
      errcode = '22023',
      message = 'Current application consent is required.';
  end if;

  if p_applicant_birth_date is null
    or extract(
      year from age(
        (now() at time zone 'Asia/Seoul')::date,
        p_applicant_birth_date
      )
    ) < 19 then
    raise exception using
      errcode = '22023',
      message = 'Applicants must be at least 19 years old.';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Answers must be an object.';
  end if;

  if jsonb_typeof(p_rules_snapshot) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Rules snapshot must be an array.';
  end if;

  if jsonb_typeof(p_evaluation_snapshot) is distinct from 'object'
    or jsonb_typeof(p_evaluation_snapshot -> 'rulesetId') is distinct from 'string'
    or jsonb_typeof(p_evaluation_snapshot -> 'rulesetVersion') is distinct from 'number'
    or jsonb_typeof(p_evaluation_snapshot -> 'eligible') is distinct from 'boolean'
    or jsonb_typeof(p_evaluation_snapshot -> 'failures') is distinct from 'array'
    or jsonb_typeof(p_evaluation_snapshot -> 'reviews') is distinct from 'array'
    or jsonb_typeof(p_evaluation_snapshot -> 'reminders') is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'Evaluation snapshot has an invalid shape.';
  end if;

  select *
  into target_opportunity
  from public.opportunities
  where id = p_opportunity_id
    and status = 'published'
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Opportunity not found.';
  end if;

  if target_opportunity.closed_at is not null or target_opportunity.closes_at <= now() then
    raise exception using errcode = '22023', message = 'Opportunity is closed.';
  end if;

  if target_opportunity.ruleset_id is distinct from p_ruleset_id
    or target_opportunity.ruleset_version is distinct from p_ruleset_version
    or target_opportunity.rules_snapshot is distinct from p_rules_snapshot then
    raise exception using errcode = '40001', message = 'Opportunity rules changed before submission.';
  end if;

  if p_evaluation_snapshot ->> 'rulesetId' is distinct from p_ruleset_id
    or p_evaluation_snapshot -> 'rulesetVersion' is distinct from to_jsonb(p_ruleset_version)
    or p_evaluation_snapshot -> 'eligible' is distinct from 'true'::jsonb
    or jsonb_array_length(p_evaluation_snapshot -> 'failures') <> 0 then
    raise exception using errcode = '22023', message = 'Evaluation snapshot is not eligible.';
  end if;

  if p_answers -> 'isAdult' is distinct from 'true'::jsonb
    or exists (
      select 1
      from jsonb_object_keys(p_answers) as answer(field)
      where answer.field <> 'isAdult'
        and not exists (
          select 1
          from jsonb_array_elements(target_opportunity.rules_snapshot) as rule
          where rule ->> 'field' = answer.field
        )
    ) then
    raise exception using
      errcode = '22023',
      message = 'Answers contain fields not requested by this opportunity.';
  end if;

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
    target_opportunity.id,
    p_submission_attempt_id,
    p_submission_fingerprint,
    p_applicant_display_name,
    p_applicant_phone,
    p_applicant_birth_date,
    p_ruleset_id,
    p_ruleset_version,
    p_rules_snapshot,
    p_evaluation_snapshot
  )
  returning id into new_application_id;

  insert into public.application_answers (application_id, field, value)
  select new_application_id, answer.key, answer.value
  from jsonb_each(p_answers) as answer;

  insert into public.consent_events (application_id, consent_type, granted)
  values
    (new_application_id, 'current_application', true),
    (new_application_id, 'future_opportunity', p_future_opportunity_consent);

  return jsonb_build_object(
    'applicationId', new_application_id,
    'evaluation', p_evaluation_snapshot
  );
end;
$$;

revoke all on function public.submit_application_transaction(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  jsonb,
  boolean,
  boolean,
  text,
  integer,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.submit_application_transaction(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  jsonb,
  boolean,
  boolean,
  text,
  integer,
  jsonb,
  jsonb
) to service_role;

create policy "Recruiters can read owned opportunities"
on public.opportunities
for select
to authenticated
using ((select auth.uid()) = recruiter_id);

create policy "Recruiters can create owned opportunities"
on public.opportunities
for insert
to authenticated
with check ((select auth.uid()) = recruiter_id);

create policy "Recruiters can update owned opportunities"
on public.opportunities
for update
to authenticated
using ((select auth.uid()) = recruiter_id)
with check ((select auth.uid()) = recruiter_id);

create policy "Recruiters can read applications for owned opportunities"
on public.applications
for select
to authenticated
using (
  exists (
    select 1
    from public.opportunities
    where opportunities.id = applications.opportunity_id
      and opportunities.recruiter_id = (select auth.uid())
  )
);

create policy "Recruiters can read answers for owned opportunities"
on public.application_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = application_answers.application_id
      and opportunities.recruiter_id = (select auth.uid())
  )
);

create policy "Recruiters can read photos for owned opportunities"
on public.application_photos
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = application_photos.application_id
      and opportunities.recruiter_id = (select auth.uid())
  )
);

create policy "Recruiters can read attendance for owned opportunities"
on public.attendance_events
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = attendance_events.application_id
      and opportunities.recruiter_id = (select auth.uid())
  )
);

create policy "Recruiters can read consents for owned opportunities"
on public.consent_events
for select
to authenticated
using (
  exists (
    select 1
    from public.applications
    join public.opportunities
      on opportunities.id = applications.opportunity_id
    where applications.id = consent_events.application_id
      and opportunities.recruiter_id = (select auth.uid())
      and consent_events.consent_type = 'current_application'
  )
);
