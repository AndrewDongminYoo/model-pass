# Privacy Cleanup Runbook

## Scope

The `cleanup-expired-photos` function removes expired job-scoped photos, reconciles stale upload reservations, and deletes abandoned `pending_photo` drafts after an opportunity closes.
The function does not delete submitted applications.
Invoke it only with a service-role token or an authenticated operator JWT.
Never place either token in client code, logs, or documentation.

## Scheduled Execution

GitHub Actions runs [photo-retention-cleanup.yml](../../.github/workflows/photo-retention-cleanup.yml) every day at 03:17 UTC and supports an operator-initiated `workflow_dispatch` run.
The workflow sends exactly `{"dryRun":false}` to the cleanup function.
It has no GitHub token permissions and permits one active cleanup run at a time; queued runs do not cancel an in-progress cleanup.
The workflow reads only the `MODEL_PASS_SUPABASE_URL` and `MODEL_PASS_OPERATOR_TOKEN` repository secrets.
It never prints either secret or the request URL.

A designated repository administrator owns setting, rotating, and removing those two repository secrets.
The production privacy operator owns reviewing failed runs and the resulting cleanup evidence.
Assign both roles before enabling the workflow in a production repository.
Do not store either value as a workflow variable, environment-level plaintext value, or local documentation example.

The scheduled production run intentionally has no preceding dry run.
It validates that the response is an HTTP 200 JSON response with the expected cleanup-result shape, that `dryRun` is `false`, and that photo and reservation failure counts are zero.
It writes only a non-sensitive summary to the job log: invocation UUID and aggregate eligible, held, reconciled, and deleted counts.
An invalid response, transport or HTTP failure, or nonzero photo or reservation failure count fails the job.

## Cleanup Order

One invocation uses this order:

1. List expired photo metadata and identify active attendance-dispute or legal-obligation holds.
2. Atomically claim each exact expired, undeleted, unheld photo with the invocation UUID and claim time.
3. Remove each claimed private Storage object by its exact stored path.
4. Finalize `deleted_at`, `deletion_reason`, and the matching invocation UUID, which also clears the claim.
5. Reconcile upload reservations older than the ten-minute signed grant window by claiming the exact reservation and application state before any Storage removal.
6. Recheck that the exact reservation still exists and matching photo metadata is still absent while holding the application lock.
7. Remove the exact Storage object, then delete only the reservation with the matching invocation claim.
8. Delete closed or scheduled-closed `pending_photo` drafts only when no reservation or photo metadata remains.

For a stale reservation with exact photo metadata, cleanup removes only the reservation.
For a stale reservation without exact photo metadata, cleanup removes the exact Storage object before it removes the reservation.
An active reservation cleanup claim blocks photo finalization for the same application and exact upload.
If finalization wins the application lock first, the reservation or matching metadata recheck prevents cleanup from authorizing Storage removal.
This order preserves the database evidence needed to retry an interrupted object cleanup.

## Dry Run

Inspect the same database candidates that the function reads:

```sql
select *
from public.list_expired_photo_cleanup_candidates(now());

select *
from public.list_stale_photo_reservations(now());

select public.count_abandoned_pending_photo_drafts(now()) as eligible_now;

select
  public.count_projected_abandoned_pending_photo_drafts(now())
    as projected_eligible_after_reconciliation;
```

Invoke a non-mutating function pass before every manual retry or other non-routine production cleanup:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${MODEL_PASS_OPERATOR_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{"dryRun":true}' \
  "${MODEL_PASS_SUPABASE_URL}/functions/v1/cleanup-expired-photos"
```

The dry-run response reports eligible and held photos, stale reservations, and zero performed deletions.
For pending drafts, `eligible` is the current-state count with every reservation acting as a blocker.
`projectedEligibleAfterReconciliation` is the count expected after reservations older than the ten-minute grant window are reconciled; a current reservation still blocks that projection.
Review unexpectedly high counts before continuing.

## Production Invocation

Use a server-side secret source to set `MODEL_PASS_OPERATOR_TOKEN` and `MODEL_PASS_SUPABASE_URL` without printing either value.
Then invoke the mutating pass:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${MODEL_PASS_OPERATOR_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{"dryRun":false}' \
  "${MODEL_PASS_SUPABASE_URL}/functions/v1/cleanup-expired-photos"
```

Record the returned invocation UUID, deleted count, held count, reservation counts, pending-draft count, and failure counts in the private operations log.

For a scheduled or manually dispatched GitHub Actions run, also retain the workflow run URL, start and finish time, conclusion, and non-sensitive job-log summary with the invocation UUID in that private operations log.
Use the invocation UUID for the database evidence queries below and for the cleanup function logs.

## Evidence Check

Use the returned invocation UUID to verify photo metadata:

```sql
select
  id,
  storage_path,
  cleanup_claim_invocation_id,
  cleanup_claimed_at,
  deleted_at,
  deletion_reason,
  deletion_invocation_id
from public.application_photos
where deletion_invocation_id = '<invocation-uuid>'::uuid
order by id;
```

Verify that active holds remain protected:

```sql
select photo.id, photo.storage_path, hold.reason, hold.opened_at
from public.application_photos photo
join public.retention_holds hold on hold.application_id = photo.application_id
where photo.expires_at <= now()
  and photo.deleted_at is null
  and hold.released_at is null
order by photo.id, hold.opened_at;
```

Run the same production invocation a second time.
The second response must report zero additional photo, reservation, and pending-draft deletions for the already reconciled records.

## Active Holds

An open attendance dispute creates an `attendance_dispute` hold in the same database transaction as the append-only dispute event.
An operator resolution releases that hold in the same transaction as the append-only resolution event.
A service-role process can create a separate `legal_obligation` hold when documented legal retention is required.
Cleanup lists held expired photos but does not remove their Storage objects or mark their metadata deleted.
A photo cleanup claim and a new retention hold are serialized on the application.
If a claim is active, opening a dispute or another hold fails with a retryable transaction error before the hold is recorded.

## Retry and Recovery

When the scheduled workflow fails, do not suppress or rerun it blindly.
First review the failed job's generic error category and the cleanup function logs by invocation UUID when one was returned.
Run the Dry Run query and function pass above before an operator starts a manual `workflow_dispatch` retry.
Record the retry's workflow run URL and invocation UUID with the original failed run.

Disable the scheduled workflow immediately when a cleanup result has nonzero failure counts, an evidence query contradicts the invocation summary, or there is any indication that Storage deletion and metadata evidence disagree.
A repository administrator disables the workflow in GitHub Actions and records the time and reason in the private operations log.
Escalate to the production privacy operator and the engineering owner before re-enabling it.
Re-enable only after the discrepancy is resolved, the Evidence Check passes for the affected invocation, and a supervised manual run completes without failures.

If Storage returns a clear pre-delete rejection (`400`, `401`, `403`, `405`, `413`, `415`, or `422`), the function releases its matching photo or reservation claim, preserves database evidence, and increments the failure count.
If Storage returns `404` or `410`, the exact object is already absent, so cleanup keeps the claim and completes photo metadata finalization or reservation deletion.
Retry the invocation after correcting Storage access or availability.
If the Storage request has an ambiguous result, including `408`, any `5xx` response, a network failure, or response loss, the function retains the claim because the object may have been removed.
If Storage removal succeeds but photo metadata finalization or claimed-reservation deletion fails or is uncertain, the function also retains the exact claim as recovery evidence.
Do not manually clear that claim.
A different invocation cannot replace a fresh photo or reservation claim.
After 15 minutes, the claim is stale and a cleanup invocation can atomically replace it, remove the same exact path idempotently, and finalize the matching photo evidence or reservation reconciliation.
The 15-minute interval bounds automated recovery and is longer than the ten-minute signed upload grant window.
If reservation reconciliation fails, the reservation remains and blocks pending-draft deletion.
Do not manually delete the application first because its cascades can remove the only orphan-object record.

If a metadata row was marked deleted but the object still exists, stop scheduled cleanup and investigate the Storage response and function logs for that invocation UUID.
Do not clear deletion evidence to conceal the mismatch.

## Pending Drafts

Pending drafts are eligible only when their opportunity has `status = 'closed'`, has `closed_at`, or has reached `closes_at`.
Cleanup first reconciles all stale reservations and exact object paths.
The database deletion function then requires the draft to have no remaining reservation and no photo metadata.
The dry-run count applies the same reservation rule as deletion, so any reservation blocks both count and deletion regardless of reservation age.
Submitted applications are outside this deletion query and remain retained under the product policy.
