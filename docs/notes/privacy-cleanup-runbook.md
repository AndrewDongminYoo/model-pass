# Privacy Cleanup Runbook

## Scope

The `cleanup-expired-photos` function removes expired job-scoped photos, reconciles stale upload reservations, and deletes abandoned `pending_photo` drafts after an opportunity closes.
The function does not delete submitted applications.
Invoke it only with a service-role token or an authenticated operator JWT.
Never place either token in client code, logs, or documentation.

## Cleanup Order

One invocation uses this order:

1. List expired photo metadata and identify active attendance-dispute or legal-obligation holds.
2. Atomically claim each exact expired, undeleted, unheld photo with the invocation UUID and claim time.
3. Remove each claimed private Storage object by its exact stored path.
4. Finalize `deleted_at`, `deletion_reason`, and the matching invocation UUID, which also clears the claim.
5. Reconcile upload reservations older than the ten-minute signed grant window.
6. Delete closed or scheduled-closed `pending_photo` drafts only when no reservation or photo metadata remains.

For a stale reservation with exact photo metadata, cleanup removes only the reservation.
For a stale reservation without exact photo metadata, cleanup removes the exact Storage object before it removes the reservation.
This order preserves the database evidence needed to retry an interrupted object cleanup.

## Dry Run

Inspect the same database candidates that the function reads:

```sql
select *
from public.list_expired_photo_cleanup_candidates(now());

select *
from public.list_stale_photo_reservations(now());
```

Invoke a non-mutating function pass before every production cleanup:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${MODEL_PASS_OPERATOR_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{"dryRun":true}' \
  "${MODEL_PASS_SUPABASE_URL}/functions/v1/cleanup-expired-photos"
```

The dry-run response reports eligible and held photos, stale reservations, and zero performed deletions.
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

If Storage rejects removal before success, the function releases its matching claim, leaves photo metadata intact, and increments the failure count.
Retry the invocation after correcting Storage access or availability.
If Storage removal succeeds but metadata finalization fails or is uncertain, the function retains the exact claim and metadata as recovery evidence.
Do not manually clear that claim.
A different invocation cannot replace a fresh claim.
After 15 minutes, the claim is stale and a cleanup invocation can atomically replace it, remove the same exact path idempotently, and finalize deletion evidence.
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
