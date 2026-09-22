create extension if not exists pgcrypto with schema extensions;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references auth.users(id) on delete cascade,
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
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  applicant_display_name text not null,
  applicant_phone text not null,
  applicant_birth_date date not null,
  ruleset_id text not null,
  ruleset_version integer not null check (ruleset_version > 0),
  rules_snapshot jsonb not null check (jsonb_typeof(rules_snapshot) = 'array'),
  evaluation_snapshot jsonb not null check (jsonb_typeof(evaluation_snapshot) = 'object'),
  created_at timestamptz not null default now()
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
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_opportunity public.opportunities%rowtype;
  new_application_id uuid;
begin
  if not p_current_application_consent then
    raise exception using
      errcode = '22023',
      message = 'Current application consent is required.';
  end if;

  if extract(year from age(current_date, p_applicant_birth_date)) < 19 then
    raise exception using
      errcode = '22023',
      message = 'Applicants must be at least 19 years old.';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Answers must be an object.';
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

  if target_opportunity.ruleset_id <> p_ruleset_id
    or target_opportunity.ruleset_version <> p_ruleset_version
    or target_opportunity.rules_snapshot <> p_rules_snapshot then
    raise exception using errcode = '40001', message = 'Opportunity rules changed before submission.';
  end if;

  if p_evaluation_snapshot ->> 'rulesetId' <> p_ruleset_id
    or (p_evaluation_snapshot ->> 'rulesetVersion')::integer <> p_ruleset_version
    or coalesce((p_evaluation_snapshot ->> 'eligible')::boolean, false) is not true
    or jsonb_array_length(coalesce(p_evaluation_snapshot -> 'failures', '[]'::jsonb)) <> 0 then
    raise exception using errcode = '22023', message = 'Evaluation snapshot is not eligible.';
  end if;

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
    target_opportunity.id,
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

  return new_application_id;
end;
$$;

revoke all on function public.submit_application_transaction(
  uuid,
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

create policy "Recruiters can delete owned opportunities"
on public.opportunities
for delete
to authenticated
using ((select auth.uid()) = recruiter_id);

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

create policy "Recruiters can record attendance for owned opportunities"
on public.attendance_events
for insert
to authenticated
with check (
  recorded_by = (select auth.uid())
  and exists (
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
  )
);
