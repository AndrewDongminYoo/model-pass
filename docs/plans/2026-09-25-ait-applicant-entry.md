# Apps in Toss Applicant Entry Implementation Plan

**Goal:** Make the AIT bundle usable by applicants with shared opportunities while keeping recruiter Supabase login only on standalone web.

**Architecture:** Build-time surface selection isolates AIT from recruiter routes. Both surfaces reuse the existing application route and server functions. Link entry requires no new identity and does not change server authorization.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright, Apps in Toss WebView SDK 3.5.0.

**Spec:** `docs/specs/2026-09-25-ait-applicant-entry.md`.

## Tasks

1. Add failing tests for opportunity-link parsing and mobile home navigation, then implement the smallest parser and input form. Verify with focused Vitest and a 390 × 844 browser check.
2. Add failing tests that AIT routes never expose recruiter login, while web routes still do. Make AIT build selection explicit and test both bundles.
3. Add failing tests for a shareable absolute HTTPS URL after publication. Reuse the existing clipboard behavior and retain the relative route link.
4. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`, `pnpm build:web`, and focused Playwright coverage. Inspect the AIT bundle for the absence of recruiter login UI and verify no backend migration or dependency was added.

## Review Focus

- A malformed or unrelated link must not navigate or send personal data.
- A direct recruiter route in the miniapp must not render a Supabase login form.
- The shared URL must use the web origin and exact published opportunity path.
- The standalone web recruiter route must remain usable after AIT build changes.
