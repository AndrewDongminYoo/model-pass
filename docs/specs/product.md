# Model Pass Product Specification

## Status

Working title: Model Pass.
Product direction approved in conversation on 2026-09-22.
This document describes the web application and a proposed Apps in Toss distribution path.
The interface defaults to Korean and supports switching all application screens to English, with the choice retained across visits.
On 2026-09-23, the operator prioritized Apps in Toss preparation; service pre-review and legal classification remain gates for public launch, not local implementation or test uploads.

## Product Thesis

Model Pass reduces the time spent reviewing unsuitable applicants for hair promotion exams and makeup certification exams.
It combines deterministic eligibility rules with optional AI assistance, but AI never makes the final eligibility decision.

The initial service is an opportunity-information and application-management tool.
It is not a managed recruiting agency, candidate-ranking service, public model marketplace, escrow service, or medical assessment product.

## Evidence and Assumptions

The following problem evidence came from the operator's domain observations during product discovery:

- Junior hair designers often recruit and personally bear model-related costs for salon promotion exams.
- Danggeun local job posts are a common initial recruitment channel.
- Recruiters may receive no applicants or lack time to review application messages while working.
- Hair eligibility depends on changing conditions such as length and recent dye, bleach, perm, or other styling history.
- Makeup eligibility is difficult to verify, and applicants may resist broad photo requests.
- Exam work may need to demonstrate a technique that does not match the model's preferred everyday style.
- Many potential applicants do not know that free or nearly free hair services and paid makeup-model opportunities exist.
- Makeup models are commonly paid cash after the session, while hair models commonly receive the procedure for free or nearly free.

These observations are discovery inputs, not market-size statistics.
The pilot must measure their frequency and economic value.

## Initial Market

- Demand-side base: hair salons, junior designers, makeup academies, and makeup examinees based in Gangnam-gu, Seoul.
- Applicant location: unrestricted when the applicant can attend the stated venue and time.
- Applicant age: 19 or older in version 1.
- Hair use case: salon promotion or designer qualification exams.
- Makeup use case: national certification practical exams.
- Initial acquisition: the recruiter posts from the recruiter's own verified Danggeun account and shares a job-scoped application link when platform policy permits it.

## Roles

### Recruiter

The recruiter creates an opportunity, selects or adjusts explicit rules, posts the opportunity through the recruiter's own channel, reviews eligible applications, and makes the final selection.

### Applicant

The applicant reads a specific opportunity, checks eligibility, supplies only the information required for that opportunity, chooses whether to apply, and separately chooses whether to receive future opportunity alerts.

### Operator

The operator maintains versioned rule templates, handles reports and factual attendance disputes, and audits data retention.
The operator does not rank candidates or negotiate on behalf of either party in version 1.

## User Flows

### Recruiter Flow

1. Select hair promotion exam or makeup certification exam.
2. Enter date, location, expected duration, compensation or procedure benefit, target technique, and required conditions.
3. Start from a category-specific rule template and explicitly confirm every hard rule.
4. Review the generated opportunity text and application link.
5. Publish the text through the recruiter's own account.
6. Review applicants who passed deterministic hard rules in submission order.
7. Request job-specific photos only from applicants who passed non-photo rules.
8. Select and contact the applicant directly.
9. Confirm attendance before the appointment and record the factual outcome afterward.
10. Close the opportunity early through an authenticated, irreversible server action when recruitment ends. Closing stops new applications and starts the job-scoped retention clock without removing factual attendance history.

### Applicant Flow

1. Browse open opportunities in the Apps in Toss miniapp or standalone web app, or open a job-scoped link without installing an app.
2. Read the exact procedure or exam task, schedule, venue area, duration, benefit, and cash compensation when applicable.
3. Answer deterministic eligibility questions.
4. Receive an immediate explanation when an explicit hard rule is not satisfied.
5. Upload only the job-specific photo requested after passing the non-photo rules.
6. Submit the application and current-job consent.
7. Choose future-opportunity alerts through a separate optional consent.
8. Confirm attendance and record completion or cancellation.

## Eligibility Model

Rules have one of three effects:

- `hard_fail`: The stated opportunity cannot accept the answer.
- `needs_review`: A recruiter must inspect the answer or job-scoped photo.
- `reminder`: The applicant can proceed but must satisfy a day-of instruction.

Hair rules are recruiter-configurable because salon promotion requirements vary.
The initial hair template includes current length, current style, recent dye, recent bleach, recent perm, willingness to accept the target style, and schedule availability.

Makeup rules are versioned by exam year and source.
The historical version 1 template included a sex condition, permanent or semi-permanent eyebrow, eyeliner, and lip procedures, eyelash extensions, and tattoos or henna as hard failures; that snapshot remains readable but is not the current exam template.
The 2026 version 2 template keeps the product's 19+ boundary and the exam's upper-age bound, labels model sex as a recruiter-specified opportunity condition, treats official score-deduction cases as recruiter review items, and does not exclude tattoos or henna.
Removable day-of conditions such as makeup, lenses, accessories, and visible nail art are reminders.
The source comparison and operator decision are recorded in `docs/notes/2026-09-24-makeup-exam-source-check.md`.

Official makeup rules must be rechecked against the applicable exam notice before each ruleset version is published.

## AI and Deterministic Logic

Deterministic rules own all eligibility outcomes.
Every outcome must identify the rule version, input value, effect, and applicant-facing reason.

AI may later:

- Convert recruiter free text into suggested structured questions.
- Produce a concise summary of applicant answers.
- Flag contradictory or missing statements for human review.
- Rewrite opportunity text without changing structured conditions.

AI must not:

- Diagnose skin, hair, or health conditions.
- Infer protected or sensitive traits from photos.
- Override a deterministic rule.
- Rank applicants.
- Send a rejection or selection without an explicit deterministic reason or recruiter action.
- Use submitted photos or answers for model training.

The first standalone pilot may ship without an AI provider.
Structured templates and deterministic rules must prove useful before an AI dependency is introduced.

## Privacy and Safety

- No public model profiles or public applicant search.
- The public opportunity list exposes only published, unclosed opportunities before their application deadline. It shows the category, title, appointment time, venue district, duration, and stated benefit; applicant data and recruiter-only fields remain private.
- No appearance score, public star rating, or attractiveness ranking.
- Photos are requested only after non-photo eligibility checks pass.
- Photos use private storage and job-scoped signed access.
- Job-scoped photos are deleted 30 days after the opportunity closes unless an active dispute or documented legal obligation requires a longer period.
- Future-opportunity consent is optional, separate, and revocable.
- Transactional records retain only the minimum fields required for the documented legal and accounting period.
- Applicant writes containing personal data go through a server-side validation function rather than direct anonymous database access.
- Applicants can request deletion subject to documented retention obligations.

## Trust and Attendance

Trust history is symmetrical.
The product records completed schedules, confirmed cancellations, and confirmed no-shows for both recruiters and applicants.
It does not calculate a public composite score.

Only factual counts needed for a pending application are shown to the counterparty.
Both sides can dispute a record, and the operator must preserve the original event and the resolution rather than silently rewriting history.

The product does not require applicant deposits.
The platform does not automatically choose or contact a replacement applicant in version 1.

## Monetization Experiment

The applicant side is free.
The initial recruiter price hypothesis is KRW 29,000 for a standard listing and KRW 49,000 for a deadline-sensitive listing.
These are experimental prices, not established market prices.

The paid item is the use of opportunity drafting, rule-based eligibility, structured application collection, and application-management tools.
The fee is not contingent on a candidate being hired or selected.
If an opportunity receives no applications, the pilot offers a refund or equivalent listing credit according to the checkout terms shown before payment.

Version 1 does not take a percentage of model compensation, hold model funds, sell a subscription, or sell applicant visibility.
RevenueCat and PayAction are outside the first pilot.
Payment activation is blocked until the legal classification gate is satisfied.

## Legal and Platform Gates

Before accepting payment or publicly launching, obtain a documented classification review based on the exact screens, contracts, and operational behavior.
The review must address the distinction between job placement and job-information provision, required registration or reporting, fee treatment, contracting-party disclosures, refund terms, and personal-data retention.

Primary references checked on 2026-09-22:

- Korean Employment Security Act definitions and reporting provisions: <https://www.law.go.kr/lsInfoP.do?lsId=001765>
- Administrative distinction between job placement and job-information provision: <https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000169910>
- Paid job-placement registration provision: <https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1024682487>
- Danggeun Jobs terms: <https://www.daangn.com/policy/jobs_terms>
- Danggeun trust and safety guidance: <https://jobs-trust.daangn.com/>

An external application link must not be assumed to comply with Danggeun policy until a current written response or directly applicable policy text confirms the intended flow.
The product must still function when the recruiter copies applicant answers manually.

Apps in Toss is the preferred applicant distribution target. The applicant-only miniapp displays open opportunities for visitors without a shared link and retains direct-link entry, as specified in `docs/specs/2026-09-25-ait-applicant-entry.md`.
Recruiter email/password authentication remains in the standalone web surface, not the miniapp.
Miniapp implementation and test uploads may proceed, but this product's recruitment and opportunity-information use case still requires service pre-review and legal classification review before public launch.

Apps in Toss references checked on 2026-09-22:

- Platform overview: <https://developers-apps-in-toss.toss.im/intro/overview.html>
- Existing web project integration: <https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/webview.md>
- Documentation index: <https://developers-apps-in-toss.toss.im/llms.txt>

## Pilot Success Criteria

The initial paid pilot targets five hair listings and five makeup listings based in Gangnam-gu.
The pilot records:

- Quote-to-payment conversion and stated rejection reason.
- Time from publication to first application.
- Number of applications and deterministic hard-fail rate.
- Recruiter review time per application.
- Number of job-scoped photo requests.
- Confirmed completion, cancellation, and no-show events.
- Repeat paid-listing intent and actual second purchase.
- Applicant opt-in and response to a later relevant opportunity.

The strongest continuation signal is a second paid listing from the same recruiter or organization.
If price is the repeated rejection reason at KRW 29,000, test KRW 19,000 as the next price point without changing the product scope at the same time.

## Explicitly Out of Scope

- Minors.
- Public profiles or public applicant browsing.
- Candidate ranking or automated selection.
- Direct recruiting, negotiation, or automatic replacement by the operator.
- Model compensation custody, escrow, or payout.
- Medical or cosmetic diagnosis.
- AI analysis of physical attractiveness or protected traits.
- Native iOS or Android applications.
- Public Apps in Toss launch before platform service pre-review and legal classification review.
- Subscriptions before repeat usage is observed.
- DeepL before multilingual demand is observed.
