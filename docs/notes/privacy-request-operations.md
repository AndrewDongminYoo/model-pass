# Privacy Request Operations

## Scope

This runbook covers operator processing for submitted `request_deletion` records.
Run every query from an authorized server-side database session using the `service_role` database role.
Do not run these queries from a browser, expose service credentials to client code, or copy applicant identifiers or submission capabilities into an operations log.
The request row remains append-only with its original `pending` status; `applicant_privacy_request_events` is the authoritative append-only processing history.

## 1. List Pending Requests

List deletion requests that do not yet have a fulfilled event:

```sql
select
  request.id as request_id,
  request.application_id,
  request.requested_at,
  pending_event.id as pending_event_id,
  pending_event.occurred_at as pending_at
from public.applicant_privacy_requests request
join public.applicant_privacy_request_events pending_event
  on pending_event.request_id = request.id
  and pending_event.event_type = 'pending'
where request.action = 'request_deletion'
  and not exists (
    select 1
    from public.applicant_privacy_request_events fulfilled_event
    where fulfilled_event.request_id = request.id
      and fulfilled_event.event_type = 'fulfilled'
  )
order by request.requested_at, request.id;
```

Choose one returned request ID for review.
Use placeholders such as `<request-id>` only in documentation and tickets; keep actual identifiers in the restricted operator session.

## 2. Review Eligibility

Review the closure threshold and blockers without selecting direct applicant identifiers or capability values:

```sql
select
  request.id as request_id,
  request.application_id,
  opportunity.id as opportunity_id,
  opportunity.status as opportunity_status,
  opportunity.closed_at,
  opportunity.closes_at,
  case
    when opportunity.closed_at is not null then opportunity.closed_at
    when opportunity.status = 'published'
      and opportunity.closes_at <= now() then opportunity.closes_at
    else null
  end as effective_closed_at,
  coalesce(
    case
      when opportunity.closed_at is not null then opportunity.closed_at
      when opportunity.status = 'published'
        and opportunity.closes_at <= now() then opportunity.closes_at
      else null
    end <= now() - interval '30 days',
    false
  ) as closure_threshold_met,
  exists (
    select 1
    from public.retention_holds hold
    where hold.application_id = application.id
      and hold.released_at is null
  ) as has_active_retention_hold,
  exists (
    select 1
    from public.application_photos photo
    where photo.application_id = application.id
      and photo.deleted_at is null
  ) as has_undeleted_photo
from public.applicant_privacy_requests request
join public.applications application on application.id = request.application_id
join public.opportunities opportunity on opportunity.id = application.opportunity_id
where request.id = '<request-id>'::uuid
  and request.action = 'request_deletion';
```

Proceed only when the query returns exactly one row with a non-null `effective_closed_at`, `closure_threshold_met = true`, `has_active_retention_hold = false`, and `has_undeleted_photo = false`.
The effective closure is the explicit `closed_at` when present.
Otherwise, it is the elapsed `closes_at` for an opportunity that remains `published`.
Draft opportunities and published opportunities whose `closes_at` is still in the future are not closed.
An active hold requires its documented release process.
An undeleted photo requires the private Storage cleanup workflow and finalized photo-deletion evidence before fulfillment.
Do not bypass either blocker or manually change privacy request or processing event rows.

## 3. Fulfill

Keep rotation evidence only in the current restricted database session:

```sql
create temporary table privacy_fulfillment_before on commit preserve rows as
select
  application.submission_attempt_id,
  application.submission_fingerprint
from public.applicant_privacy_requests request
join public.applications application on application.id = request.application_id
where request.id = '<request-id>'::uuid
  and request.action = 'request_deletion';
```

The temporary table must contain exactly one row.
Invoke the narrowly granted fulfillment function:

```sql
select public.fulfill_applicant_deletion_request('<request-id>'::uuid);
```

Record only the returned `requestId`, `applicationId`, `eventId`, and `status` in the restricted operations record.
The function atomically removes direct applicant identifiers and answers, reduces evaluation detail to ruleset and eligibility facts, rotates the submission capability and fingerprint, and appends the fulfilled event.

## 4. Verify Evidence

Verify minimization, rotation, and the single fulfilled event in the same session:

```sql
select
  application.applicant_display_name is null as display_name_removed,
  application.applicant_phone is null as phone_removed,
  application.applicant_birth_date is null as birth_date_removed,
  not exists (
    select 1
    from public.application_answers answer
    where answer.application_id = application.id
  ) as answers_removed,
  application.evaluation_snapshot = jsonb_build_object(
    'rulesetId', application.ruleset_id,
    'rulesetVersion', application.ruleset_version,
    'eligible', application.evaluation_snapshot -> 'eligible',
    'failures', '[]'::jsonb,
    'reviews', '[]'::jsonb,
    'reminders', '[]'::jsonb
  ) as evaluation_minimized,
  application.submission_attempt_id <> before.submission_attempt_id
    as submission_capability_rotated,
  application.submission_fingerprint <> before.submission_fingerprint
    as submission_fingerprint_rotated
from public.applicant_privacy_requests request
join public.applications application on application.id = request.application_id
cross join privacy_fulfillment_before before
where request.id = '<request-id>'::uuid;

select
  event.id,
  event.event_type,
  event.occurred_at
from public.applicant_privacy_request_events event
where event.request_id = '<request-id>'::uuid
order by event.occurred_at, event.id;
```

The first query must return exactly one row with every boolean `true`.
The second query must show exactly one `pending` event followed by exactly one `fulfilled` event.
Consent events, attendance events, the privacy request, and both processing events remain retained as audit facts.
End the operator session to discard the temporary pre-fulfillment capability evidence.

## 5. Retry and Recovery

The fulfillment function is idempotent.
If the response is lost after invocation, call the same function again with the same request ID:

```sql
select public.fulfill_applicant_deletion_request('<request-id>'::uuid);

select count(*) as fulfilled_event_count
from public.applicant_privacy_request_events
where request_id = '<request-id>'::uuid
  and event_type = 'fulfilled';
```

For an already fulfilled request, the function returns the original fulfilled event ID and does not minimize or rotate the application again.
The evidence query must return `fulfilled_event_count = 1`.
If fulfillment reports that 30 days have not elapsed, wait until the effective closure threshold is met and review again.
If it reports an active retention hold or undeleted photo, complete the corresponding documented hold-release or photo-cleanup workflow, rerun the review query, and retry.
Do not edit or delete request or processing event history to force a retry.
