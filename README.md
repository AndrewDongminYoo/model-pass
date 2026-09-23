# Model Pass

Model Pass is the working title for a private, rule-based application tool for hair promotion-exam models and makeup certification-exam models.
The first market is recruiters based in Gangnam-gu, Seoul, and applicants aged 19 or older.

The product is deliberately not a public model marketplace.
Recruiters publish their own opportunity posts, applicants choose whether to apply, deterministic rules identify explicit incompatibilities, and recruiters make the final selection.

## Current Status

The repository contains a local standalone web pilot implemented with React, Vite, TypeScript, and Supabase.
The implemented flows cover recruiter authentication and opportunity publication, deterministic applicant eligibility, server-validated application submission, private job-scoped photos, recruiter application review, symmetric attendance actions, future-opportunity consent revocation, and retention-aware deletion requests.
The repository also includes unit, database, Edge Function, and Playwright coverage for the local pilot.
Task 8 defines and validates the first-party pilot event taxonomy, but it does not emit or persist those events; durable first-party collection remains a required follow-up before pilot measurement.

This status is not launch readiness.
The local pilot remains subject to the legal, policy, privacy, and operational gates in the product specification.

## Documents

- [Product specification](docs/specs/product.md)
- [Standalone web MVP implementation plan](docs/plans/2026-09-22-standalone-web-mvp.md)
- [Working notes](docs/notes/README.md)

## Local Setup

For a new, disposable local database only, install dependencies, start Supabase, and apply all migrations:

```bash
pnpm install --frozen-lockfile
supabase start
supabase db reset
```

Do not run `supabase db reset` against a local database with data; it deletes that data. Use `supabase migration up` to apply pending migrations instead.

The browser client needs only the local public URL and anon key.
Derive them from the running local stack without committing credentials:

```bash
local_supabase_status="$(supabase status -o json)"
export VITE_SUPABASE_URL="$(jq -r '.API_URL' <<<"$local_supabase_status")"
export VITE_SUPABASE_ANON_KEY="$(jq -r '.ANON_KEY' <<<"$local_supabase_status")"
unset local_supabase_status
pnpm dev
```

To exercise private photo uploads, configure `PHOTO_UPLOAD_SIGNING_SECRET` with at least 32 random UTF-8 bytes in the local Edge Function environment before starting the stack.
Keep that local secret out of Git.
Scheduled photo cleanup uses a different `PHOTO_CLEANUP_TOKEN` in the Edge Function environment and the matching `MODEL_PASS_PHOTO_CLEANUP_TOKEN` GitHub Actions secret; see [the privacy cleanup runbook](docs/notes/privacy-cleanup-runbook.md).
The photo-upload function bundles `magick.wasm` to decode and re-encode JPEG, PNG, and HEIC/HEIF server-side. Deploy that function with the Docker-backed Supabase CLI, not `--use-api`; [Supabase's WASM deployment guide](https://supabase.com/docs/guides/functions/wasm) requires declared static files (accessed 2026-09-23). Before launch, verify that the hosted gateway supplies the client `X-Forwarded-For` header used by anonymous per-source limits.

Run the local checks from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
for test_file in supabase/functions/*/index.test.ts; do function_dir="${test_file%/index.test.ts}"; deno test -A --sloppy-imports --frozen-lockfile --config "$function_dir/deno.json" --lock "$function_dir/deno.lock" "$test_file"; done
supabase test db
pnpm build
pnpm test:e2e
trunk check --all
```

Run `supabase db reset` before `pnpm test:e2e` only on a disposable local database; the command destroys existing local data.
The Playwright harness derives ephemeral local Supabase values at runtime and does not require committed credentials.
Pull requests run the format, lint, type, unit, Edge Function, pgTAP, build, and Chromium end-to-end checks in [PR checks](.github/workflows/pr-checks.yml) against a fresh local Supabase stack.

## Delivery Gates

1. Confirm the service classification and pre-launch obligations using the exact proposed user flow.
2. Build and test the standalone web pilot.
3. Run paid Gangnam pilot listings with hair and makeup recruiters.
4. Decide whether repeat usage justifies product expansion.
5. Request Apps in Toss service pre-review and create a separate integration plan.

Payment activation and public launch remain blocked until the product specification's legal classification and pre-launch review gates are satisfied.
Danggeun external application-link use remains blocked until a current written response or directly applicable policy text confirms the intended flow.
Apps in Toss integration remains blocked until the standalone pilot produces evidence and the use case passes platform pre-review.

See the [product specification](docs/specs/product.md) for the controlling requirements and primary-source links.
