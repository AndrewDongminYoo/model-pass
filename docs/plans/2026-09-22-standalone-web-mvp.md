# Standalone Web MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, mobile-first web pilot that lets a recruiter publish a job-scoped eligibility form, lets an adult applicant self-check and apply, and lets the recruiter review deterministic results without public profiles or automated candidate ranking.

**Architecture:** Use a React 18 and Vite single-page application with framework-independent TypeScript domain modules. Use Supabase Postgres, Auth, private Storage, and Edge Functions so personal-data writes and signed photo access run server-side. Keep Apps in Toss, AI providers, online payment, and public deployment outside this plan until their gates in the product specification are satisfied.

**Tech Stack:** pnpm, React 18, Vite, TypeScript strict mode, React Router, Zod, Supabase, Deno for Edge Functions, Vitest, React Testing Library, Playwright, and Trunk after the real commands exist.

**Spec:** `docs/specs/product.md`

## Global Constraints

- Serve applicants aged 19 or older only.
- Keep deterministic rule evaluation in `src/features/eligibility/domain/` with no React or Supabase imports.
- Do not introduce an AI provider, payment provider, Apps in Toss SDK, public profile, ranking, deposit, success fee, or automatic replacement.
- Send all unauthenticated personal-data writes through Supabase Edge Functions.
- Enable Row Level Security on every application table and keep the photo bucket private.
- Delete job-scoped photos 30 days after an opportunity closes unless a dispute hold exists.
- Show eligible applications in submission order only.
- Keep current-application consent and future-opportunity consent separate.

## Review Focus

- A crafted request claiming an age below 19 must be rejected by the server even when the browser validation is bypassed.
- A recruiter must never read applications or photos belonging to another recruiter.
- A changed or stale ruleset must not alter the recorded result of an already submitted application.
- A reminder answer must not be treated as a hard failure, while a hard-fail answer must prevent submission.
- A photo past its deletion deadline must be removed unless an active dispute hold exists, and the cleanup must be idempotent.

---

### Task 1: Bootstrap the Web Application and Quality Gate

**Files:**

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `playwright.config.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/test/setup.ts`
- Create: `src/app/App.test.tsx`
- Modify: `.gitignore`

**Interfaces:**

- Produces: `App(): JSX.Element`, the root test command, the browser test command, and strict TypeScript configuration used by every later task.

- [ ] **Step 1: Initialize the manifest and install the declared dependencies**

Run:

```bash
pnpm init
pnpm add react@18 react-dom@18 react-router-dom zod @supabase/supabase-js
pnpm add -D vite typescript @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier @playwright/test
```

Expected: `package.json` and `pnpm-lock.yaml` exist, and the lockfile resolves one React 18 line.

- [ ] **Step 2: Add strict compiler, Vite, Vitest, ESLint, Prettier, and Playwright configuration**

Set package scripts to the following contract:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint . --max-warnings=0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc -b --pretty false"
  }
}
```

Configure Vitest to use `jsdom` and `src/test/setup.ts`.
Configure Playwright to run Chromium against the Vite preview server.

- [ ] **Step 3: Write the failing root render test**

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('renders the working product name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Model Pass' })).toBeVisible();
});
```

- [ ] **Step 4: Run the test and verify the intended failure**

Run: `pnpm test -- src/app/App.test.tsx`

Expected: FAIL because `App` does not exist.

- [ ] **Step 5: Add the minimal root component and application entry point**

```tsx
export function App() {
  return <h1>Model Pass</h1>;
}
```

- [ ] **Step 6: Run the first quality gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: every command exits zero and `dist/index.html` exists.

- [ ] **Step 7: Commit the bootstrap**

```bash
git add package.json pnpm-lock.yaml index.html tsconfig.json vite.config.ts playwright.config.ts src .gitignore
git commit -m "chore: scaffold standalone web app"
```

### Task 2: Implement the Versioned Deterministic Rules Engine

**Files:**

- Create: `src/features/eligibility/domain/types.ts`
- Create: `src/features/eligibility/domain/evaluate-rules.ts`
- Create: `src/features/eligibility/domain/evaluate-rules.test.ts`
- Create: `src/features/eligibility/templates/hair-promotion-v1.ts`
- Create: `src/features/eligibility/templates/makeup-certification-v1.ts`
- Create: `src/features/eligibility/templates/templates.test.ts`

**Interfaces:**

- Produces: `RuleDefinition`, `RuleEffect`, `AnswerValue`, `EvaluationResult`, `evaluateRules(answers, rules)`, `hairPromotionV1`, and `makeupCertificationV1`.
- `EvaluationResult` is immutable evidence saved with an application in Task 4.

- [ ] **Step 1: Define domain contracts in the failing test**

```ts
const rules: RuleDefinition[] = [
  {
    id: 'adult-only',
    field: 'isAdult',
    operator: 'equals',
    expected: true,
    effect: 'hard_fail',
    reason: 'This pilot is available to adults only.',
  },
  {
    id: 'remove-lenses',
    field: 'wearsLenses',
    operator: 'equals',
    expected: false,
    effect: 'reminder',
    reason: 'Remove lenses before the appointment.',
  },
];

expect(evaluateRules({ isAdult: false, wearsLenses: true }, rules)).toEqual({
  eligible: false,
  failures: [{ ruleId: 'adult-only', reason: 'This pilot is available to adults only.' }],
  reviews: [],
  reminders: [{ ruleId: 'remove-lenses', reason: 'Remove lenses before the appointment.' }],
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test -- src/features/eligibility/domain/evaluate-rules.test.ts`

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement explicit operators and exhaustive effect handling**

Support only `equals`, `not_equals`, `one_of`, `none_of`, `minimum`, and `maximum`.
Reject an unknown operator during ruleset parsing rather than silently treating it as a pass.

```ts
export type RuleEffect = 'hard_fail' | 'needs_review' | 'reminder';
export type AnswerValue = string | number | boolean | null;

export interface EvaluationResult {
  eligible: boolean;
  failures: RuleOutcome[];
  reviews: RuleOutcome[];
  reminders: RuleOutcome[];
}
```

- [ ] **Step 4: Add category templates and prove removable conditions are reminders**

The makeup template must encode prior permanent or semi-permanent procedures and persistent visible marks as hard rules, while day-of makeup, removable lenses, and removable accessories are reminders.
The hair template must mark target-style acceptance and explicit recruiter constraints as hard rules, while ambiguous hair-condition photos require review.

- [ ] **Step 5: Run domain verification**

Run: `pnpm test -- src/features/eligibility && pnpm typecheck`

Expected: the hard-fail, needs-review, reminder, unknown-operator, and missing-answer cases pass.

- [ ] **Step 6: Commit the rules engine**

```bash
git add src/features/eligibility
git commit -m "feat: add deterministic eligibility rules"
```

### Task 3: Build Recruiter Opportunity Drafting

**Files:**

- Create: `src/features/opportunities/domain/opportunity.ts`
- Create: `src/features/opportunities/components/OpportunityForm.tsx`
- Create: `src/features/opportunities/components/OpportunityPreview.tsx`
- Create: `src/features/opportunities/components/OpportunityForm.test.tsx`
- Create: `src/features/opportunities/routes/NewOpportunityPage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**

- Consumes: `RuleDefinition`, `hairPromotionV1`, and `makeupCertificationV1` from Task 2.
- Produces: `OpportunityDraft`, `OpportunityCategory`, `Compensation`, and validated form output for Task 4 persistence.

- [ ] **Step 1: Write tests for both category paths and explicit compensation**

```tsx
it('requires a cash amount for a paid makeup opportunity', async () => {
  render(<OpportunityForm onSubmit={onSubmit} />);
  await user.selectOptions(screen.getByLabelText('Category'), 'makeup_certification');
  await user.selectOptions(screen.getByLabelText('Benefit type'), 'cash');
  await user.click(screen.getByRole('button', { name: 'Preview opportunity' }));
  expect(screen.getByText('Enter the cash amount.')).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});
```

Also test that a hair opportunity can describe a free or nearly free procedure without a cash amount, and that a date in the past is rejected.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm test -- src/features/opportunities/components/OpportunityForm.test.tsx`

Expected: FAIL because the form and domain types do not exist.

- [ ] **Step 3: Implement the Zod-validated draft contract**

```ts
export type OpportunityCategory = 'hair_promotion' | 'makeup_certification';

export interface OpportunityDraft {
  category: OpportunityCategory;
  title: string;
  startsAt: string;
  closesAt: string;
  venueDistrict: string;
  expectedMinutes: number;
  benefit: Compensation;
  rulesetId: string;
  rulesetVersion: number;
  rules: RuleDefinition[];
}
```

Require `venueDistrict` to default to `서울 강남구` while remaining explicit and editable.

- [ ] **Step 4: Build the preview without AI-generated copy**

Render the exact structured procedure, duration, location, benefit, hard rules, review items, and reminders.
Provide a copy button only after the recruiter confirms that the preview matches the intended opportunity.

- [ ] **Step 5: Run focused UI and type verification**

Run: `pnpm test -- src/features/opportunities && pnpm typecheck`

Expected: both category paths, compensation validation, date validation, and preview confirmation pass.

- [ ] **Step 6: Commit recruiter drafting**

```bash
git add src/app src/features/opportunities
git commit -m "feat: add opportunity drafting flow"
```

### Task 4: Persist Opportunities and Server-Validated Applications

**Files:**

- Create: `supabase/config.toml`
- Create: `supabase/migrations/202609220001_initial_schema.sql`
- Create: `supabase/tests/rls.sql`
- Create: `supabase/functions/submit-application/index.ts`
- Create: `supabase/functions/submit-application/index.test.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/features/applications/domain/application.ts`
- Create: `src/features/applications/api/submit-application.ts`
- Create: `.env.example`

**Interfaces:**

- Consumes: `OpportunityDraft` and `EvaluationResult`.
- Produces: `submitApplication(input): Promise<{ applicationId: string; evaluation: EvaluationResult }>` and database records containing immutable ruleset snapshots.

- [ ] **Step 1: Write the database migration with private ownership**

Create `opportunities`, `applications`, `application_answers`, `application_photos`, `attendance_events`, and `consent_events`.
Store `rules_snapshot jsonb`, `ruleset_id text`, `ruleset_version integer`, and `evaluation_snapshot jsonb` on each application.
Enable Row Level Security on every table.

The recruiter policy must compare `auth.uid()` with `opportunities.recruiter_id` through the owning opportunity.
Do not add an anonymous insert policy for applications.

- [ ] **Step 2: Write an RLS test that fails before the policies are complete**

```sql
select tests.authenticate_as('recruiter-a');
select results_eq(
  $$ select count(*)::bigint from applications where opportunity_id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values (1::bigint) $$,
  'recruiter can read an owned application'
);
select results_eq(
  $$ select count(*)::bigint from applications where opportunity_id = '00000000-0000-0000-0000-000000000002' $$,
  $$ values (0::bigint) $$,
  'recruiter cannot read another recruiter application'
);
```

Use fixed recruiter and opportunity fixtures in the same transaction.
Run the owner-read assertion before adding the owner policy and confirm that it reports zero instead of the expected one; only then add the policy and trust the cross-owner zero-result assertion.

- [ ] **Step 3: Run the migration test and verify the denial assertion initially fails**

Run: `supabase db reset && supabase test db`

Expected: FAIL because the authenticated recruiter sees zero owned applications before the owner policy is applied.

- [ ] **Step 4: Implement the `submit-application` Edge Function**

The function must load the published opportunity, reject closed opportunities, reject applicants below 19, parse answers with Zod, evaluate the stored rules snapshot on the server, reject any hard failure, and call a database function that inserts the application, consent events, answers, and immutable snapshots in one database transaction.
It must ignore any client-supplied eligibility result.

```ts
export interface SubmitApplicationInput {
  opportunityId: string;
  applicant: {
    displayName: string;
    phone: string;
    birthDate: string;
  };
  answers: Record<string, AnswerValue>;
  currentApplicationConsent: true;
  futureOpportunityConsent: boolean;
}
```

- [ ] **Step 5: Add server tests for the age, stale-ruleset, and hard-fail cases**

Freeze the clock in the test.
Assert that a client-provided `eligible: true` value cannot bypass a hard-fail answer.
Assert that changing the opportunity after submission does not mutate `evaluation_snapshot`.

- [ ] **Step 6: Run database, function, and TypeScript verification**

Run: `supabase db reset && supabase test db && deno test -A supabase/functions/submit-application/index.test.ts && pnpm test -- src/features/applications && pnpm typecheck`

Expected: own-record access succeeds, cross-recruiter access fails, underage submission fails, hard-fail submission fails, and an eligible submission returns an application ID.

- [ ] **Step 7: Commit persistence and server validation**

```bash
git add supabase src/lib src/features/applications .env.example
git commit -m "feat: persist server-validated applications"
```

### Task 5: Build the Job-Scoped Applicant Experience

**Files:**

- Create: `src/features/applications/components/EligibilityForm.tsx`
- Create: `src/features/applications/components/EligibilityResult.tsx`
- Create: `src/features/applications/components/ApplicationForm.tsx`
- Create: `src/features/applications/components/ApplicationFlow.test.tsx`
- Create: `src/features/applications/routes/ApplyPage.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**

- Consumes: public opportunity data, `evaluateRules`, and `submitApplication`.
- Produces: the route `/opportunities/:opportunityId/apply` and a successful submission receipt without creating a public applicant profile.

- [ ] **Step 1: Write the failing end-to-end component tests**

Test these flows separately:

```tsx
it('explains a deterministic failure without requesting a photo', async () => {
  renderApplicationFlow(makeupOpportunity);
  await answerAdultQuestion(false);
  await user.click(screen.getByRole('button', { name: 'Check eligibility' }));
  expect(screen.getByText('This pilot is available to adults only.')).toBeVisible();
  expect(screen.queryByLabelText('Requested photo')).not.toBeInTheDocument();
});
```

```tsx
it('keeps future alerts optional when submitting an eligible application', async () => {
  renderApplicationFlow(makeupOpportunity);
  await answerAllEligibleQuestions();
  await user.click(screen.getByRole('button', { name: 'Submit application' }));
  expect(submitApplication).toHaveBeenCalledWith(
    expect.objectContaining({ futureOpportunityConsent: false }),
  );
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm test -- src/features/applications/components/ApplicationFlow.test.tsx`

Expected: FAIL because the applicant components do not exist.

- [ ] **Step 3: Implement progressive disclosure**

Show opportunity facts first, deterministic questions second, photo requests only after non-photo hard rules pass, applicant contact fields after eligibility, and future-alert consent as an unchecked independent control.
Do not render recruiter-only notes or other applicants.

- [ ] **Step 4: Add accessibility and double-submit coverage**

Every question must have a programmatic label and error association.
Disable the submit button while the request is pending and preserve answers after a recoverable network error.

- [ ] **Step 5: Run focused verification**

Run: `pnpm test -- src/features/applications && pnpm typecheck && pnpm lint`

Expected: the hard-fail, eligible, optional-consent, network-error, and double-submit tests pass.

- [ ] **Step 6: Commit the applicant flow**

```bash
git add src/app src/features/applications
git commit -m "feat: add private applicant flow"
```

### Task 6: Add Private Photos and Recruiter Review

**Files:**

- Create: `supabase/migrations/202609220002_private_photos.sql`
- Create: `supabase/functions/create-photo-upload/index.ts`
- Create: `supabase/functions/create-photo-view/index.ts`
- Create: `src/features/applications/api/application-photos.ts`
- Create: `src/features/recruiter/routes/ApplicationsPage.tsx`
- Create: `src/features/recruiter/components/ApplicationCard.tsx`
- Create: `src/features/recruiter/components/ApplicationCard.test.tsx`
- Modify: `src/features/applications/components/ApplicationForm.tsx`

**Interfaces:**

- Consumes: authenticated recruiter identity and job ownership.
- Produces: short-lived signed upload and view URLs, plus an application list ordered by `submitted_at asc` without a ranking field.

- [ ] **Step 1: Create the private storage bucket and metadata policies**

Use the object path contract `opportunity/{opportunityId}/application/{applicationId}/{photoId}`.
Reject uploads with a mismatched opportunity or application owner, content type outside JPEG, PNG, or HEIC, or size above the documented limit of 10 MB.

- [ ] **Step 2: Write failing authorization tests**

Prove a recruiter can request a signed URL for an owned application and cannot request one for another recruiter's application.
Prove an applicant upload token cannot be reused for a different object path.

- [ ] **Step 3: Implement signed URL functions and job-scoped upload UI**

Return a signed URL valid for 10 minutes.
Store only storage metadata in Postgres.
Do not make the bucket public or embed a permanent object URL.

- [ ] **Step 4: Build submission-order recruiter review**

Render deterministic outcomes, answers, requested photos, and factual history.
Do not add a sort control for attractiveness, AI score, or inferred fit.

- [ ] **Step 5: Run storage and UI verification**

Run: `supabase db reset && supabase test db && pnpm test -- src/features/recruiter src/features/applications && pnpm typecheck`

Expected: owner access passes, cross-owner access fails, invalid content fails, and recruiter cards remain in submission order.

- [ ] **Step 6: Commit private review**

```bash
git add supabase src/features/applications src/features/recruiter
git commit -m "feat: add private application review"
```

### Task 7: Add Symmetric Attendance History and Privacy Cleanup

**Files:**

- Create: `src/features/attendance/domain/attendance.ts`
- Create: `src/features/attendance/domain/attendance.test.ts`
- Create: `supabase/functions/record-attendance/index.ts`
- Create: `supabase/functions/cleanup-expired-photos/index.ts`
- Create: `supabase/functions/cleanup-expired-photos/index.test.ts`
- Create: `src/features/attendance/components/AttendanceSummary.tsx`
- Create: `src/features/attendance/components/AttendanceSummary.test.tsx`
- Create: `docs/notes/privacy-cleanup-runbook.md`

**Interfaces:**

- Produces: `AttendanceEventType`, append-only attendance events for both roles, factual counts, dispute holds, and idempotent photo cleanup.

- [ ] **Step 1: Define append-only event types with a failing reducer test**

```ts
export type AttendanceEventType =
  | 'recruiter_confirmed'
  | 'applicant_confirmed'
  | 'completed'
  | 'recruiter_cancelled'
  | 'applicant_cancelled'
  | 'recruiter_no_show'
  | 'applicant_no_show'
  | 'dispute_opened'
  | 'dispute_resolved';
```

The reducer must compute separate recruiter and applicant counts and must not collapse both sides into one score.

- [ ] **Step 2: Run the reducer test and verify it fails**

Run: `pnpm test -- src/features/attendance/domain/attendance.test.ts`

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement authorized event recording**

Allow each party to confirm or cancel its own attendance.
Require operator resolution before a disputed no-show count becomes visible to a future counterparty.
Never update or delete the original event when resolving a dispute.

- [ ] **Step 4: Write the cleanup failure case first**

Seed one expired photo, one current photo, and one expired photo with an active dispute hold.
Assert the first is deleted, the second remains, and the third remains.
Run the cleanup twice and assert the second run succeeds without additional deletion.

- [ ] **Step 5: Implement cleanup and the operator runbook**

Delete storage objects before marking their metadata as deleted.
Record `deleted_at`, deletion reason, and function invocation ID.
Document the dry-run query, production invocation, evidence check, and recovery path in `docs/notes/privacy-cleanup-runbook.md`.

- [ ] **Step 6: Run attendance and cleanup verification**

Run: `pnpm test -- src/features/attendance && deno test -A supabase/functions/cleanup-expired-photos/index.test.ts && supabase test db`

Expected: symmetric counts, dispute visibility, retention boundaries, and repeated cleanup pass.

- [ ] **Step 7: Commit trust and retention behavior**

```bash
git add src/features/attendance supabase/functions/record-attendance supabase/functions/cleanup-expired-photos docs/notes/privacy-cleanup-runbook.md
git commit -m "feat: add symmetric attendance history"
```

### Task 8: Add Pilot Metrics, End-to-End Coverage, and Trunk

**Files:**

- Create: `src/lib/analytics/events.ts`
- Create: `src/lib/analytics/events.test.ts`
- Create: `e2e/hair-application.spec.ts`
- Create: `e2e/makeup-application.spec.ts`
- Create: `e2e/recruiter-isolation.spec.ts`
- Create: `.trunk/trunk.yaml`
- Modify: `README.md`
- Modify: `docs/specs/product.md`

**Interfaces:**

- Consumes: application, review, and attendance flows.
- Produces: typed first-party event names and a repeatable local quality gate.

- [ ] **Step 1: Define first-party pilot events without third-party analytics**

```ts
export type PilotEvent =
  | { name: 'opportunity_previewed'; category: OpportunityCategory }
  | { name: 'application_started'; opportunityId: string }
  | { name: 'eligibility_checked'; opportunityId: string; eligible: boolean }
  | { name: 'application_submitted'; opportunityId: string }
  | { name: 'attendance_recorded'; opportunityId: string; outcome: AttendanceEventType };
```

Store operational events without applicant answers, phone numbers, photos, or free text.

- [ ] **Step 2: Write end-to-end tests for one hair and one makeup path**

The hair path must submit a procedure-benefit opportunity and an eligible applicant.
The makeup path must prove a hard failure blocks submission and a lens reminder does not.
The isolation test must sign in as two recruiters and prove neither can read the other's application.

- [ ] **Step 3: Run end-to-end tests and repair only failures in the planned scope**

Run: `pnpm test:e2e`

Expected: all three browser scenarios pass in Chromium.

- [ ] **Step 4: Configure Trunk around the real project commands**

Use the installed `setup-trunk` workflow to add only tools that correspond to the repository's declared TypeScript, formatting, Markdown, and secret checks.
Do not add a mobile, Python, or generated-code tool to this web repository.

- [ ] **Step 5: Run the complete local gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
supabase db reset
supabase test db
pnpm build
pnpm test:e2e
trunk check --all
```

Expected: every command exits zero, the database reset applies both migrations, and no check reports a warning treated as an error by project configuration.

- [ ] **Step 6: Update status documentation without claiming launch readiness**

Update the README with local setup commands and state that payment activation, public launch, Danggeun external-link use, and Apps in Toss integration remain blocked by the gates in the product specification.
Update the specification only when implementation behavior differs from the approved contract, and document the reason.

- [ ] **Step 7: Commit the pilot gate**

```bash
git add src/lib/analytics e2e .trunk README.md docs/specs/product.md
git commit -m "test: add standalone pilot quality gate"
```

## Plan Self-Review

- Spec coverage: recruiter drafting, deterministic rules, private application, progressive photos, recruiter isolation, symmetric attendance, consent separation, retention, and pilot metrics each have an owning task.
- Intentional exclusions: payment, AI, Apps in Toss, public profiles, ranking, direct recruiting, and automatic replacement remain outside this plan as required by the specification.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified error-handling steps.
- Type consistency: `OpportunityDraft`, `RuleDefinition`, `EvaluationResult`, `SubmitApplicationInput`, and `AttendanceEventType` are introduced before downstream consumption.
- Review focus coverage: server-side age validation is in Task 4, recruiter isolation is in Tasks 4 and 8, immutable snapshots are in Task 4, rule-effect separation is in Tasks 2 and 5, and retention holds plus idempotence are in Task 7.
