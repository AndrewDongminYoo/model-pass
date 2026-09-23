# Prelaunch Security Hardening Plan

## Direction

The operator approved resolving the verified prelaunch review findings and opening a PR. Work in the main workspace on `fix/prelaunch-security-boundaries`, using the existing code style and no new dependency unless native tools cannot meet the image contract.

## Steps

1. Establish the current contract and local verification environment. Inspect the relevant migrations, Edge Functions, tests, and current Supabase documentation. Verify the project account and preserve unrelated files.
2. Write failing database tests for direct opportunity writes, closure consistency, late cancellation, and selection timing/reversal. Implement minimal migration and RPC changes plus affected Edge Function calls.
3. Write failing Edge Function tests for applicant capability precedence, cleanup invocation credentials, photo byte validation/metadata removal, and anonymous request limits. Implement each path with narrowly scoped changes.
4. Update the frontend paths that expose changed behavior (attendance actions, selection reversal, image preparation if required, error localization). Add focused tests before implementation.
5. Verify retention behavior and evaluate migration squash without resetting the existing local database, which contains data. Run the migration and pgTAP suites inside rollback-only transactions; use a separate empty test instance if a fresh-history proof is still needed. Do not remove applied migration history without proof that the production history is empty.
6. Run focused tests, database tests, full `pnpm` quality gate, and a read-only adversarial review of the exact candidate. Repair confirmed blockers and re-run affected checks.
7. Stage explicit files by concern, inspect the index, make conventional commits, push the branch, open a PR against `main`, and observe current-head CI and hosted reviews. Leave merge to the operator.

## Verification

- DB security: run the new migration and each pgTAP file inside an explicit transaction against the local database, then roll it back. Never reset the existing data-bearing local database.
- Edge and UI behavior: focused `pnpm test -- <test-file>` runs with observed red/green outcomes.
- Full gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm format:check`.
- Git and PR: exact staged diff, `git diff --check`, PR head SHA, CI status, and unresolved-review-thread check.

## Risks

- Removing default table grants can break the current JWT-backed publish path; replace it in the same change.
- A status constraint must account for scheduled expiry and early closure without delaying deletion eligibility.
- Photo decoding/metadata removal in an Edge Function may require a dependency or a narrower accepted-format contract; validate runtime support before choosing one.
- IP-based limits can misidentify users behind a shared network; prefer a modest boundary and preserve idempotent retries.
- The local database contains existing records and migration version `20260923003444` was partly applied before that was discovered. Never reset it or assume a later `migration up` would apply the expanded file; verify the full file transactionally and leave local migration history unchanged.
