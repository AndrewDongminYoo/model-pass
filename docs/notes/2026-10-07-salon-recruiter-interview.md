# 2026-10-07 Salon Recruiter Interview

Source: an interview conducted by the operator on 2026-10-07, reported to the repository on 2026-10-10.
Sample: one interviewee, a salon manager-level hair professional.
Confidence: low for frequency and market size (n = 1); moderate that the two pain points below are real for this interviewee and the staff the interviewee described.
The interviewee and the salon are not identified because the repository is public.

## Reported Findings

- Model no-shows are a major pain point when salon staff recruit models (n = 1).
- Salon staff often use a model-matching platform the interviewee called "미모" (n = 1).
- Dissatisfaction with that platform's fees was strong, and the recruiter (designer) side pays the fee (n = 1).

These are the interviewee's statements, not verified facts about any platform.
The platform's identity and fee model are researched separately in `2026-10-10-mimo-platform-research.md`.

## Product Decisions Affected

- Pre-appointment reminders (GitHub issue #9, #10): the no-show report supports a reminder, but the existing confirmation, symmetric no-show recording, and dispute flow already cover the recording side.
- Fee positioning (GitHub issue #11): the reported recruiter-paid platform fee, whose basis is not yet known, is the comparison point for the flat, non-contingent listing fee in `docs/specs/product.md` §Monetization Experiment.
- Applicant deposits, no-show penalties, and automatic replacement stay out of scope; the interview does not change `docs/specs/product.md` §Trust and Attendance.
