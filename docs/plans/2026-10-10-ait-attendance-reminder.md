# Apps in Toss Attendance Reminder Implementation Plan

**Goal:** Send one pre-appointment Apps in Toss push to selected miniapp applicants who have not confirmed attendance.

**Architecture:** The AIT build captures the miniapp recipient key at submission. An hourly GitHub Actions job invokes an operator-token Edge Function that claims and sends reminders over the partner mTLS API.

**Tech Stack:** React, TypeScript, Vite, Vitest, Supabase Postgres and Edge Functions (Deno), Apps in Toss WebView SDK 3.5.0, GitHub Actions.

**Spec:** `docs/specs/2026-10-10-ait-attendance-reminder.md`.

## Preconditions

The operator issues the partner mTLS certificate and confirms that functional campaign creation is available in the console before Task 1.
Tasks 2 and 3 do not call the partner API and can proceed in parallel with the console work, but the sender (Task 4) waits for the smoke result.

## Tasks

1. **Smoke call.** Add `supabase/functions/_shared/toss-partner-client.ts` that builds a `Deno.createHttpClient` from PEM secrets and posts JSON to the partner API. Add a temporary operator-token function that calls `users/anon-key/verify` with a key passed in the request body. Deploy it, run it once with a real key from a QR test, record the result in `docs/notes/`, then delete the temporary function. If the hosted runtime ignores the client certificate, stop and revise the spec to the GitHub Actions Node fallback.
2. **Schema.** Add a migration with `application_toss_recipients (application_id primary key, anon_key, created_at)` and `attendance_reminders (id, application_id, kind, attempt_count, claimed_at, sent_at, result, failure_code, unique (application_id, kind))`, both with Row Level Security enabled and no client policies. Add a service-role `claim_attendance_reminder` function that locks the application row, re-checks the reminder rule, and inserts or reclaims the row (explicit failures only, up to three attempts). Extend `unselect_application_for_recruiter` to refuse once a reminder row exists, and `fulfill_applicant_deletion_request` to delete the recipient row. Add pgTAP cases in `supabase/tests/` for no client read access, deletion on fulfillment, claim eligibility, retry limits, and unselection refusal after a claim.
3. **Capture.** Add failing tests, then a `src/lib/apps-in-toss/anonymous-key.ts` helper that dynamically imports the SDK only on the AIT surface and returns `null` on any non-success result. Pass the key as an optional field to `submit-application` and validate it server-side. Keep it out of the submission fingerprint so a retry with a different capture result does not conflict. After the application is persisted, write the key with a separate best-effort service-role insert; a failed write is logged and never fails the submission. Tests prove that submission succeeds without a key and that the capture times out instead of hanging; a search of the `pnpm build:web` output confirms it contains no SDK import, while the AIT build emits a separate SDK chunk.
4. **Sender.** Add `send-attendance-reminders` following the `cleanup-expired-photos` dependency-injection pattern: operator-token authorization, eligibility query per the spec's reminder rule, claim-before-send, `resultType` handling, deletion of recipient keys whose appointment has started, and an explicit `notConfigured` result when secrets are missing. Unit tests use fakes for every dependency, including a duplicate-claim race, an HTTP 200 `FAIL` response that stays retryable, an ambiguous timeout that is not retried, a selection whose appointment starts before the next run (no reminder), and exclusion of every final outcome from either party (including `recruiter_cancelled` and `recruiter_no_show`).
5. **Lookup route.** Add failing tests, then an AIT route `/applications/lookup` that takes the receipt number and private management code, resolves the opportunity on the server without revealing whether an application ID exists, and opens the existing attendance confirmation. Set it as the template's landing URL.
6. **Schedule.** Add `.github/workflows/attendance-reminders.yml` mirroring `photo-retention-cleanup.yml` (hourly, `permissions: {}`, concurrency group, response-shape validation).
7. **Docs.** Add the recipient key to the applicant-facing consent and privacy notice before any real-user release, add it to the privacy operations notes, and list the new secrets in `supabase/functions/.env.example` with placeholders only.
8. **Verification.** Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`, `pnpm build:web`, the Edge Function Deno tests, and `supabase test db`. A test send with `send-test-message` waits for the approved template and the uploaded test bundle.

## Review Focus

- No path sends a reminder twice for the same application, and an ambiguous outcome is never retried.
- A recruiter cannot unselect an application after its reminder is claimed.
- A missing or failed recipient key never blocks or alters an application submission.
- The recipient key is unreadable by clients and recruiters, and it is deleted after the appointment starts and on deletion-request fulfillment.
- The template context carries no applicant personal data or private management code.
- The lookup route reveals nothing for a wrong receipt number and code pair.
- The web bundle does not import the Apps in Toss SDK.
