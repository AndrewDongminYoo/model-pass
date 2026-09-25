# Protected Standalone Web Deployment Plan

**Spec:** `docs/specs/2026-09-25-protected-web-deployment.md`.

## Steps

1. Verify link-only AIT applicant entry against the product and applicant-entry specifications. Confirm the anonymous list Edge Function is absent both from source and the deployed project; check focused unit and browser behavior.
2. Review the Vercel build and upload configuration. Confirm the source upload excludes local secrets and workspace state, then verify the protected default domain, direct route rewrite, and browser Supabase configuration.
3. Run the declared full test and quality gates, then conduct a read-only adversarial review of the complete PR candidate. Repair only confirmed in-scope findings and rerun affected checks.
4. Commit the remaining work by concern, push one task branch, and open a PR against `main`. Observe current-head CI and hosted review within the PR-loop budget, then request the operator's visual approval for changed screens and operator merge.

## Ownership And Verification

The current workspace is the only write location; no task worktree is needed.
The root agent owns Git staging, commits, external deployment verification, review dispositions, and final checks.
Verify with `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`, `pnpm build:web`, both web and Apps in Toss Playwright checks, Deno tests, `trunk check --all`, and `git diff --check`.
