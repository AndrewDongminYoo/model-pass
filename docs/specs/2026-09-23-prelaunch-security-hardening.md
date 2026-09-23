# Prelaunch Security Hardening

## Problem

An external review identified direct opportunity writes, late attendance cancellation, broad cleanup credentials, applicant authorization ambiguity, unprocessed photo metadata, anonymous endpoint abuse, and unrestricted selection. The operator confirmed that no production tables have been created and requested fixes before publication in a PR.

## Scope

- Make opportunity publication and closure server-controlled; deny direct recruiter writes and enforce coherent status and closure timestamps.
- Expose authenticated early closure to recruiters through the application, with an explicit confirmation step.
- Prevent cancellation at or after the appointment start in both the Edge Function and database; keep attendance outcomes factual and append-only.
- Authenticate scheduled photo cleanup with a dedicated least-privilege invocation secret, not the database service-role key in GitHub Actions.
- Resolve applicant attendance through its submission capability even when a recruiter session or publishable key is present, without allowing a recruiter request to borrow that capability accidentally.
- Validate uploaded image bytes and remove metadata before storage; preserve private, job-scoped access and retention behavior.
- Bound anonymous submission and photo-upload abuse with a server-side, testable limit that does not store raw IP addresses.
- Use hourly per-opportunity, per-source budgets of 10 eligible new submissions and 20 photo-upload grants. Derive the source from the gateway-provided `X-Forwarded-For` address, store only a keyed hash, and expire its quota bucket on the first successful hourly cleanup after the 24-hour boundary. Reject requests when the source is unavailable. Invalid applications and exact retries do not consume a slot. Verify the hosted gateway's forwarded-header behavior before launch; distributed or forged-source abuse still requires edge-level controls.
- Block selection after opportunity closure/start, make accidental selection reversible only before attendance activity, and preserve recruiter ownership checks.
- Align photo-retention calculations and remove dead calculations; localize the recruiter list loading error.
- Consolidate the duplicated attendance access decision so both functions cannot drift.
- Add negative database and Edge Function regression coverage, then evaluate whether a preproduction migration squash is safe and useful.

## Non-goals

- Payment activation, Apps in Toss registration, or production deployment.
- Candidate ranking, direct solicitation, or changing eligibility rules.
- Silent omission of malformed applicant records from the recruiter list.
- Automatic concealment of applicant phone numbers before selection without a reviewed contact workflow; the product requires direct recruiter contact after selection, so this is a separate product/privacy decision.
- Broad utility extraction from every Edge Function merely to remove repetition.
- A selection count cap: the current product specification does not define capacity or backup-model policy, so adding a one-person limit would be an unreviewed product decision.

## Acceptance Criteria

1. An authenticated recruiter cannot insert or update opportunities through PostgREST; an authenticated owner can publish a validated opportunity through the Edge Function, and only an authorized server operation can close it.
2. Status and `closed_at` cannot disagree. A closed opportunity cannot be republished; the closure timestamp cannot be moved to delay deletion or photo cleanup.
3. A cancellation at or after `starts_at` is rejected by the Edge Function and the database, including when the caller bypasses the Edge Function; the UI no longer offers that action.
4. The cleanup workflow contains no database service-role secret and an invalid invocation secret cannot trigger cleanup.
5. An applicant capability works with either legacy anon or publishable keys and in a browser with a recruiter session; a missing or incorrect capability is denied.
6. Stored images have a verified supported format and no EXIF/GPS metadata. Malformed, mismatched, or undecodable data is rejected; valid uploads still finalize.
7. Repeated anonymous submissions or photo-upload attempts are limited at a documented boundary without raw IP retention, while a normal retry remains possible.
8. Selection is unavailable after closure/start and cannot be reversed after attendance activity; an eligible mistaken selection can be reversed through an authenticated server path.
9. Focused negative tests fail on the original behavior and pass after the fix. The full repository gate and relevant local database tests pass before commit and PR.

## Constraints

- Preserve the 19+ v1 boundary and all non-negotiable rules in `docs/specs/product.md`.
- Any new security-definer function must have an explicit search path and revoked public execution before a narrow service-role grant.
- Do not change a production database; it has no tables, and this task targets migration files and local verification only.
- Preserve existing commits and unrelated work; do not force-push or bypass hooks.
