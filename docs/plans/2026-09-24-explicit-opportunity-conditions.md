# Explicit Opportunity Conditions Implementation Plan

> For the implementing agent: execute this plan in the main workspace with test-driven changes, one task at a time.
> This document is an approved direction, not authorization to deploy, push, or alter existing production opportunities.

## Goal

Replace unstated opportunity-condition questions with recruiter-authored, applicant-visible yes/no conditions while retaining non-removable platform and verified exam rules.
A failed preference must be a recruiter review item, not an eligibility rejection or ranking signal.

## Architecture

Keep `opportunities.rules_snapshot` as the immutable publication artifact and preserve version 1 snapshots for historical reads.
Add a versioned, framework-independent publication builder that owns trusted locked rules and validates editable conditions.
The recruiter editor previews the builder's exact questions; the Edge publication handler runs the same builder on untrusted input before persisting.
The public opportunity, applicant form, submission reevaluation, and recruiter answer view all read the stored questions.
No new table, dependency, AI decision path, or RLS relaxation is planned.

## Tech Stack

React 18, strict TypeScript, Zod, Vitest and Testing Library, Playwright, Supabase Edge Functions on Deno, and the existing Postgres JSONB snapshot and RLS policies.

## Spec

`docs/specs/2026-09-24-explicit-opportunity-conditions.md`; preserve the boundaries in `docs/specs/product.md`.

## Global Constraints

- Work in the current main workspace.
  Preserve unrelated files, including the existing untracked `supabase/.branches/` state.
- Follow the existing Supabase skill before implementation: check current platform documentation, preserve server authorization and RLS, and do not reset a data-bearing database.
- Do not treat the 2021 makeup template metadata as proof of current exam requirements.
  Verify the applicable primary Q-net notice and record its URL and access date before making exam restrictions a locked current template.
  If this cannot be verified, stop that release gate rather than guess.
- Keep version 1 snapshots readable.
  Use a new template version for new publications; do not rewrite published opportunities or historical applications.
- Write a failing focused test before each behavior change.
  Use exact paths for formatters, review the diff, and ask before any newly discovered migration or broad rewrite.
- No commit, PR, push, deployment, or production data change is included in the current documentation task.
  The commit steps below apply only when implementation is separately authorized.

## Review Focus

Can a forged client drop or alter a locked rule, publish an unseen question, or cause the server to evaluate a different snapshot? Are failed preferred conditions non-blocking and visible without a score? Are applicant and recruiter labels the exact published questions in both locales? Does the rollout leave legacy live links unchanged until an operator decision?

### Task 1: Prove the exam source and legacy rollout state

**Files:** Read `docs/specs/product.md`, `src/features/eligibility/templates/makeup-certification-v1.ts`, and `supabase/migrations/202609220001_initial_schema.sql`.
On implementation, update only the new template metadata and a dated note in `docs/notes/` with verified primary-source evidence.

**Interface:** The new makeup template metadata names its actual applicable exam year, official source URL, and access date.
Version 1 remains unchanged.

- [ ] Read the applicable current Q-net exam notice and compare each proposed locked condition with the source.
      Record source URL, access date, applicable year, and any rule that is not source-supported.
      Do not infer legal or medical eligibility from the notice.
- [ ] Run a read-only, row-level production preflight for published opportunities whose snapshot contains a vague legacy field.
      Use the authenticated operator's approved read-only channel; do not paste applicant data into a report.
      A starting query is:

```sql
select id, category, ruleset_id, ruleset_version
from public.opportunities as opportunity
where status = 'published'
  and exists (
    select 1
    from jsonb_array_elements(opportunity.rules_snapshot) as rule
    where rule ->> 'field' in (
      'meetsCurrentLengthRequirement',
      'meetsCurrentStyleRequirement',
      'meetsRecentDyeRequirement',
      'meetsRecentBleachRequirement',
      'meetsRecentPermRequirement',
      'meetsRecruiterConstraints',
      'acceptsTargetStyle',
      'matchesRequiredSex'
    )
  );
```

- [ ] If the preflight returns rows, stop rollout and request an explicit close-and-repost or other operator treatment.
      If the Q-net source is unavailable or conflicts with the draft locked rules, stop makeup-template promotion and resolve the source before implementation.
- [ ] No code commit is made for this read-only gate.
      A source note and metadata change belong with Task 2's template commit after verification.

### Task 2: Define a versioned rule contract and trusted builder

**Files:** `src/features/eligibility/domain/types.ts`, a narrowly scoped new `src/features/eligibility/domain/opportunity-conditions.ts` and test, `src/features/eligibility/templates/hair-promotion-v2.ts`, `src/features/eligibility/templates/makeup-certification-v2.ts`, `src/features/eligibility/templates/templates.test.ts`, `src/features/opportunities/domain/opportunity.ts`, and the source note from Task 1.
Preserve the version 1 template files.

**Interface:** An answerable published version 2 rule has a stable `id`, unique answer `field`, `operator: "equals"`, boolean `expected`, `effect`, `reason`, and non-empty localized `question: { en, ko }`.
The existing hair-photo review rule remains non-answerable and must not be turned into a yes/no question.
Legacy version 1 rules may lack `question` for read compatibility.
The publication builder accepts a category, template version, required makeup sex when applicable, and editable yes/no conditions; it returns canonical rules or field-specific validation errors.
Locked rules originate only from trusted templates.

- [ ] Add failing domain tests for a missing question, missing expected answer, duplicate ID or field, unsupported effect/operator, locked ID or field reuse, missing makeup sex, stale template version, and tampered locked rule.
      Include a preferred `expected: false` case, a source-backed makeup locked-rule case, and preservation of the non-answerable hair-photo rule.
- [ ] Run `pnpm exec vitest run src/features/eligibility/domain/opportunity-conditions.test.ts src/features/eligibility/templates/templates.test.ts` and observe the intended failures.
- [ ] Implement the smallest shared builder and version 2 templates.
      The builder must never accept locked rules from the client as authority; it must reconstruct them and compare the submitted preview `rules` array with the canonical result, without adding a separate hash or token.
      Keep the existing general evaluator able to read version 1 snapshots.

```ts
type ApplicantQuestion = { en: string; ko: string };
type EditableCondition = {
  id: string;
  field: string;
  question: ApplicantQuestion;
  expected: boolean;
  effect: "hard_fail" | "needs_review";
};
```

- [ ] Rerun the focused tests until green.
      Verify that a newly built rule has no generic “opportunity requirement” wording and no hidden condition.
- [ ] Proposed commit: `feat(eligibility): define explicit versioned opportunity conditions`.

### Task 3: Build the recruiter editor and exact preview

**Files:** `src/features/opportunities/components/OpportunityForm.tsx`, `OpportunityForm.test.tsx`, `OpportunityPreview.tsx`, a new `OpportunityPreview.test.tsx`, `src/features/opportunities/routes/NewOpportunityPage.tsx`, `src/features/opportunities/domain/opportunity.ts`, and scoped styles if necessary.

**Interface:** Category selection loads version 2 locked cards and editable suggestion cards.
A suggestion becomes active only with a concrete applicant-facing yes/no question, expected answer, and required/preferred selection.
Recruiters can edit, add, or remove only editable cards; makeup required sex is an explicit required selector.
Preview shows the exact localized questions and classification that will be published, including the confirmed locked rules.

- [ ] Add failing UI tests for both category templates, locked-card immutability, suggestion edit/remove, custom add, required/preferred switch, makeup sex omission, duplicate/blank question errors, and a locale switch that leaves authored text unchanged.
      Assert exact question text in preview, not just a non-empty list.
- [ ] Run `pnpm exec vitest run src/features/opportunities/components/OpportunityForm.test.tsx src/features/opportunities/components/OpportunityPreview.test.tsx` and observe the intended failures.
- [ ] Implement the editor using existing React state and i18n conventions.
      Keep IDs and fields stable during draft edits; use a new identifier for newly added cards.
      Remove orphaned static template imports and validation messages made obsolete by this change.
- [ ] Rerun the focused tests until green.
      Check 320px and 390px layouts in a rendered browser; capture recruiter editor and preview with long Korean questions and both effect states.
- [ ] Proposed commit: `feat(opportunities): author and preview explicit conditions`.

### Task 4: Enforce canonical publication on the server

**Files:** `supabase/functions/publish-opportunity/index.ts`, `index.test.ts`, `src/features/opportunities/api/publish-opportunity.ts`, and a new `src/features/opportunities/api/publish-opportunity.test.ts` if the client request shape changes.
Touch a SQL migration only if tests prove the current JSONB/RPC contract cannot store the canonical snapshot; obtain approval first.

**Interface:** The server accepts the version 2 draft contract but constructs the persisted `rules_snapshot` from trusted locked rules plus validated editable input.
A stale version, missing makeup parameter, duplicate ID or field, changed locked rule, unconfirmed required rule, hidden condition, or mismatch with the preview commitment returns a client error before persistence.

- [ ] Add failing Edge tests using a forged request for every bypass above, plus a successful required/preferred mix.
      Assert the persisted command contains canonical questions, effects, and expected values rather than raw client rules.
- [ ] Run the focused Deno test and observe the intended failures:

```sh
deno test -A --sloppy-imports --frozen-lockfile --config supabase/functions/publish-opportunity/deno.json --lock supabase/functions/publish-opportunity/deno.lock supabase/functions/publish-opportunity/index.test.ts
```

- [ ] Call the shared builder after authentication and before persistence.
      Keep existing service-role/RPC authority and hard-rule confirmation behavior.
      Do not widen direct table grants or RLS.
- [ ] Rerun the focused test until green; verify the rejected request never calls persistence.
- [ ] Proposed commit: `fix(opportunities): enforce trusted publication rules`.

### Task 5: Display and evaluate the stored questions end to end

**Files:** `supabase/functions/get-public-opportunity/index.ts` and test, `src/features/applications/api/get-public-opportunity.ts`, `src/features/applications/components/EligibilityForm.tsx`, `src/features/applications/components/ApplicationFlow.test.tsx`, `supabase/functions/submit-application/index.ts` and test, `src/features/applications/api/application-photos.ts` and test, `src/features/recruiter/components/ApplicationCard.tsx` and test, plus `src/features/recruiter/routes/ApplicationsPage.tsx` if its loader needs the question map.

**Interface:** New public opportunities return the stored version 2 questions.
Applicant and recruiter views render the question for the active locale; authored text is identical in both.
The submission server still reloads the opportunity's stored snapshot and reevaluates answers.
Unmet `hard_fail` blocks; unmet `needs_review` does not block and is visible to the recruiter.
Historical version 1 applications keep their existing fallback labels.

- [ ] Add failing public-read tests for preserving the stored question, applicant tests asserting exact Korean and English question text, submission tests for required rejection/preference acceptance and forged snapshot mismatch, and recruiter tests asserting the custom question beside its answer.
      Ensure the recruiter application query retrieves the opportunity's rule snapshot through its existing authorized path rather than trusting the applicant payload.
- [ ] Run `pnpm exec vitest run src/features/applications/components/ApplicationFlow.test.tsx src/features/applications/api/application-photos.test.ts src/features/recruiter/components/ApplicationCard.test.tsx` and the focused Deno tests below; observe the intended failures.

```sh
deno test -A --sloppy-imports --frozen-lockfile --config supabase/functions/get-public-opportunity/deno.json --lock supabase/functions/get-public-opportunity/deno.lock supabase/functions/get-public-opportunity/index.test.ts
deno test -A --sloppy-imports --frozen-lockfile --config supabase/functions/submit-application/deno.json --lock supabase/functions/submit-application/deno.lock supabase/functions/submit-application/index.test.ts
```

- [ ] Render answerable labels from the stored snapshot with a version 1 fallback.
      Preserve the separate photo-field handling, existing answer ordering, retention behavior, and symmetric attendance.
      Reuse the current evaluator and DB snapshot-equality check instead of building a second eligibility path.
- [ ] Rerun all focused tests until green.
      Inspect the actual DB read policy for any added nested opportunity select; do not relax RLS silently.
- [ ] Proposed commit: `feat(applications): show published questions and review preferences`.

### Task 6: Integration, visual verification, and rollout gate

**Files:** `e2e/recruiter-publication.spec.ts`, `e2e/hair-application.spec.ts`, `e2e/makeup-application.spec.ts`, and only the fixture files they use.
Update the new spec or plan if implementation uncovers an approved contract change.

- [ ] Write an E2E case that publishes a concrete required hair condition and a preferred condition, opens the applicant link, sees the exact questions, submits an unmet preference, and finds the answer as a recruiter review item.
      Add a makeup case that proves the required-sex parameter and locked restriction cannot be bypassed.
      Make the new test fail before implementation is complete.
- [ ] Run `pnpm exec playwright test e2e/recruiter-publication.spec.ts e2e/hair-application.spec.ts e2e/makeup-application.spec.ts`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`, and the repository's declared Deno and database checks.
      Use `trunk check --all` if available in the current environment.
      Document any unavailable gate rather than claiming it passed.
- [ ] In a rendered browser, inspect 320px and 390px recruiter, preview, applicant, and recruiter-answer screens.
      Test long Korean line wraps, locale switching, keyboard labels, and error association.
      Confirm the fixture actually contains a long custom condition and a failed preference.
- [ ] Conduct a local adversarial review of the exact diff: tampered publication payloads, snapshot parity, RLS, legacy reads, and no scoring.
      Repair confirmed findings and rerun affected checks.
- [ ] Re-run the read-only production legacy preflight immediately before deployment.
      If it returns rows, stop and request an operator decision; do not mutate or block live links automatically.
      Deployment, PR creation, and push require separate authorization.
- [ ] Proposed commit for integration-only edits: `test(opportunities): cover explicit condition flows`.

## Completion Evidence

Implementation is ready for review only when every focused test has an observed red then green result, the full declared gates pass or are reported as unavailable, the rendered screens show exact authored questions, and the exam-source and legacy preflight gates are resolved.
A green localization or snapshot-shape test alone is not evidence of readable wording or server/client parity.
