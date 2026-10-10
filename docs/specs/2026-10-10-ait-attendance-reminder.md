# Apps in Toss Attendance Reminder

## Decision

On 2026-10-10 the operator chose Apps in Toss functional push as the first pre-appointment reminder channel (GitHub issue #9).
SMS and Kakao notifications are follow-up work and are out of scope here.
The reminder addresses the no-show pain point recorded in `docs/notes/2026-10-07-salon-recruiter-interview.md`.

## Coverage Limit

The reminder reaches only applicants who applied inside the Apps in Toss miniapp, because the recipient key comes from the miniapp SDK.
Applicants who applied through the standalone web link receive no reminder until the SMS or Kakao follow-up ships.
The miniapp is in `PREPARE` status and its public launch waits for the gates in `docs/specs/product.md`, so no real applicant receives a reminder before that launch.

## Reminder Rule

Send at most one `day_before` reminder per application when all of these hold at send time:

- The application is `submitted` and selected by the recruiter (`selected_at` is set).
- The opportunity's `starts_at` is in the future and at most 24 hours away.
- The application has no `applicant_confirmed`, `applicant_cancelled`, `completed`, or no-show event.
- The application has a stored Apps in Toss recipient key.
- No `day_before` reminder row exists for the application.

The scheduler runs hourly, so the effective lead time is between 23 and 24 hours, plus scheduler delay.
An application selected less than 24 hours before the appointment is reminded on the next run.

## Message Content

The message uses one console-approved functional template whose code starts with `model-pass-`.
The template context carries only the appointment time in Korea Standard Time, the venue district, and the category label.
It never carries the applicant's name, phone number, birth date, receipt number, or private management code.
The message links to the miniapp; the applicant confirms attendance with the receipt number and private management code they already hold.
The copy must be transactional (appointment time and place, and a request to confirm or cancel) and must not promote other opportunities.
The approved template is expected to be Korean-only; English copy is not a requirement for this channel.

Whether this reminder needs a notification agreement is decided by the console copy review.
If the review requires one, `requestNotificationAgreement` is added in a separate change; it is not built speculatively.

## Recipient Key

- The AIT build calls `getAnonymousKey` from `@apps-in-toss/web-framework` during application submission. The SDK is imported dynamically only when `VITE_APP_SURFACE` is `ait`.
- A missing key (`undefined`, `'ERROR'`, `'INVALID_CATEGORY'`, or the web surface) never blocks submission.
- `submit-application` validates the key and writes it to a dedicated table. No client or recruiter can read that table under Row Level Security.
- The key is used only for reminders about the current application. It is never used for future-opportunity alerts, which keep their separate optional consent.
- The key is deleted together with the applicant's personal fields in applicant privacy deletion and in scheduled post-closure deletion. Both functions scrub the application row rather than delete it, so a foreign-key cascade alone is not enough.

## Server Call

- The partner API at `https://apps-in-toss-api.toss.im` requires the partner mTLS client certificate.
- The sender runs as a Supabase Edge Function using `Deno.createHttpClient({ cert, key })`. The certificate and key are Edge Function secrets and never reach the client bundle.
- The supabase/edge-runtime source exposes `Deno.createHttpClient` (`ext/runtime/js/denoOverrides.js`, checked 2026-10-10), but whether the hosted runtime honors `cert` and `key` is unverified. The first implementation task proves it with a smoke call. If it fails, the fallback is a Node `https.Agent` sender in the scheduled GitHub Actions job; only one sender is built.
- Each send is claimed by inserting a reminder row before the API call (`unique (application_id, kind)`), so overlapping runs or retries cannot send twice.
- A response with `resultType: "FAIL"` is a failure even with HTTP 200; the failure code is stored on the reminder row.
- When the certificate or template code secret is absent, the function sends nothing and reports that state explicitly.

## External Preconditions

These are operator actions in the Apps in Toss console and are tracked as `external-action` issues:

1. Issue the partner mTLS certificate for `model-pass`. The workspace business verification is `REJECTED` (2026-10-10 console read: a business registration certificate issued within three months is required). The functional push documentation does not list business registration as a requirement, but whether certificate issuance needs it is unknown.
2. Create a functional campaign and template, and pass the copy review.
3. Upload a test bundle (`deploymentId`) and run a QR test in the Toss app, because the sandbox returns mock keys.

## Open Contradiction

The SDK page for `getAnonymousKey` says the returned key is not a key for Toss server API calls, while the push API page says to send that same `hash` as `x-anon-key`.
The smoke call to `POST /api-partner/v1/apps-in-toss/users/anon-key/verify` with a real key resolves this before the sender is built.

## Out of Scope

- SMS and Kakao notifications.
- Reminders to recruiters.
- Applicant deposits, penalties, and automatic replacement (`docs/specs/product.md` §Trust and Attendance).
- Toss Login.

## References

Accessed on 2026-10-10:

- [푸시알림 (smart message API)](https://developers-apps-in-toss.toss.im/documentation/common/growth/smart-message)
- [사용자 식별키 발급 (getAnonymousKey)](https://developers-apps-in-toss.toss.im/documentation/common/authentication/hash-key)
- [mTLS 인증서 발급 방법](https://developers-apps-in-toss.toss.im/documentation/integration/getting-started)
- [Deno.createHttpClient](https://docs.deno.com/api/deno/~/Deno.createHttpClient)
- [supabase/edge-runtime `denoOverrides.js`](https://github.com/supabase/edge-runtime/blob/main/ext/runtime/js/denoOverrides.js)
