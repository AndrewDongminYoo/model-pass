# Explicit Opportunity Conditions

## Status

The operator approved the design direction in conversation on 2026-09-24.
This specification defines the intended behavior; implementation has not started.
It extends the product specification in `docs/specs/product.md` without changing the pilot's 19+ boundary, recruiter-led selection, or prohibition on candidate ranking.

## Problem and Outcome

The current opportunity form copies a category template without letting the recruiter state the actual job-specific criteria.
The applicant form then asks whether hair length, styling history, or other attributes meet an unspecified "opportunity requirement."
An applicant cannot answer that question reliably, and a deterministic rule cannot establish what the recruiter meant.

For every newly published opportunity, the recruiter must state each job-specific condition before publication, and the applicant must see the exact published question before answering it.
The published rule snapshot must be the common source for preview, applicant display, and server-side evaluation.
Answers remain self-reported unless a separate job-scoped photo or recruiter review provides evidence; the application must not present self-report as objective verification.

## Scope and Boundaries

- A category loads a versioned template with locked platform or verified exam rules and editable job-specific condition suggestions.
- The 19+ platform rule cannot be changed or removed by a recruiter.
- An exam rule may be locked only after its source and applicable year have been verified against a current primary source; its source and version remain visible in the template metadata.
- A makeup model's required sex is an explicit recruiter-supplied parameter of a non-removable exam condition, not a hidden generic question.
- Recruiters may edit, add, disable, or remove job-specific conditions before publication.
- Published conditions are immutable; an incorrect published opportunity must be closed and replaced rather than edited in place.
- A preferred condition never blocks an application and never produces a candidate score, rank, or automatic selection.
- No AI decides or rewrites eligibility, translates recruiter-authored content, or infers a condition from a photo.

## Recruiter Authoring Flow

Selecting hair promotion or makeup certification loads that category's template into the draft.
Locked rules are displayed as read-only cards with their source or platform rationale.
Editable suggestions are draft cards, not active published rules until the recruiter supplies a concrete applicant-facing question and an expected yes or no answer.
For hair, the suggestions cover current length, current style, recent dye, bleach, perm, target style acceptance, and availability where applicable.
For makeup, verified exam restrictions remain locked while the required-sex value is explicitly selected and any additional job-specific conditions remain editable.

Each editable condition has one applicant-facing yes/no question, one expected answer, and a choice between required and preferred.
The recruiter can add a custom condition or remove an irrelevant suggestion.
The editor provides examples but never publishes a placeholder such as "Do you meet this opportunity's other requirements?"
An active condition with missing text, missing expected answer, duplicate identity, or an unsupported effect blocks preview and publication with a field-specific error.
The preview displays the same question wording and required/preferred classification that the applicant will see.
The recruiter explicitly confirms all required conditions before publication, including locked ones.

The application chrome and built-in template text remain localized in Korean and English.
Recruiter-authored question text is displayed unchanged in both interface languages, like the existing opportunity title and benefit description.
It is not silently machine-translated.

## Published Rule Contract

The existing opportunity `rules_snapshot` JSON array remains the immutable publication artifact.
Newly published answerable rules include applicant-facing question text as part of the snapshot, with Korean and English variants for built-in questions and the same authored text in both variants for recruiter-authored questions.
The existing hair-photo review rule is not a self-reported yes/no condition; its review outcome and job-scoped upload flow remain separate from the answerable question list.
Each rule retains a stable ID, answer field, deterministic operator and expected value, effect, and an explanation derived from the approved question or a trusted template.
The publication endpoint accepts only supported yes/no recruiter conditions in this release; arbitrary operators, branching questionnaires, and unreviewed free-text evaluation are out of scope.

The publication server reconstructs the locked rules from its trusted category and template version, verifies any required template parameter, and validates the editable conditions before storing the final snapshot.
A client request cannot delete a locked rule, change its effect or expected answer, reuse a locked field or ID, or smuggle in a hidden rule.
The server rejects a stale template version instead of silently publishing a snapshot different from the recruiter preview.
The current direct PostgREST write restrictions and Row Level Security remain in force; this design does not relax either boundary.

The public opportunity endpoint returns the stored question and rule snapshot.
The applicant form renders questions from that snapshot rather than synthesizing vague labels from field names.
The applicant's answer is submitted against the opportunity ID and the same snapshot version.
The submission server reloads the stored snapshot and reevaluates the answers; it never trusts a client-computed eligibility result.
An unmet required rule is a `hard_fail` and prevents submission.
An unmet preferred rule uses `needs_review`, leaves the applicant eligible, and records the answer for recruiter review.
All applicant answers remain visible to the recruiter in submission order, without a preference score or rank.

## Legacy Opportunities and Exam-Source Gate

No existing published rule snapshot is silently rewritten.
Before rollout, a read-only production preflight checks whether published opportunities still contain the unspecified legacy questions.
If any exist, deployment pauses for an operator-approved close-and-repost or other explicit treatment; this feature does not automatically change or block their live application links.
Historical applications retain their original snapshots for audit.

The current makeup template metadata names 2021 as its applicable exam year.
Implementation must verify the current primary exam source and record its URL and access date before promoting makeup rules as locked current requirements.
If that verification cannot be completed, the release must not claim that the makeup template represents current official requirements.

## Acceptance Criteria

1. A recruiter can start from either category template, edit or remove job-specific suggestions, add a required or preferred yes/no condition, and preview the resulting applicant questions.
2. The recruiter cannot edit or remove the 19+ rule or verified exam restrictions, while the required makeup sex parameter is explicit and cannot be omitted.
3. An incomplete, duplicate, stale, or tampered rule set is rejected by the publication server even when the UI is bypassed.
4. A newly published opportunity never asks whether an unstated "opportunity condition" is met; every answerable applicant question is traceable to the exact published snapshot, while photo review remains a separate evidence flow.
5. A failed required answer blocks submission; a failed preferred answer does not block it and is visible as a review item, with no candidate ranking.
6. The server reevaluates against its stored opportunity snapshot and rejects answer fields or rule versions that do not match it.
7. Korean and English interface modes render built-in questions in their selected language and retain recruiter-authored text exactly as entered.
8. Focused domain, editor, publication, public-read, and submission tests cover the negative cases, and mobile screenshots verify readable 320px and 390px layouts.
9. Production rollout does not silently mutate legacy opportunities and does not label an unverified exam template as current.

## Non-Goals

- Editing a published opportunity in place.
- Automatic translation or AI interpretation of recruiter-authored conditions.
- Numeric thresholds, arbitrary rule operators, conditional branching, applicant scoring, or automatic selection in the first release of the editor.
- A new public candidate profile, photo-based inference, or a change to the legal and platform launch gates.
