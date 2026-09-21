# Model Pass Repository Instructions

## Product Scope

Model Pass is a working title for a Gangnam-based web service that helps hair promotion-exam and makeup certification-exam recruiters collect structured applications and apply deterministic eligibility rules.
Read `docs/specs/product.md` before changing product behavior.

## Non-Negotiable Boundaries

- Version 1 serves users aged 19 or older.
- Do not add public model profiles, appearance rankings, or public star ratings.
- Do not let AI make eligibility, health, skin, or hair-condition decisions.
- Keep deterministic rule results separate from AI-generated summaries and suggestions.
- Do not add candidate ranking, direct candidate solicitation, success fees, model-fee custody, or automatic reassignment without an approved legal classification update in the product spec.
- Treat photos as job-scoped sensitive content, store them privately, and delete them according to the retention policy.
- Keep future-opportunity consent separate from consent required for the current application.
- Record attendance history symmetrically for recruiters and applicants.

## Engineering Baseline

- Use TypeScript strict mode.
- Keep domain rules framework-independent and unit tested.
- Route unauthenticated writes containing personal data through server-side functions.
- Enforce Supabase Row Level Security for every user-owned table.
- Prefer boring, explicit modules over shared abstractions introduced for hypothetical future channels.
- The standalone web pilot comes before Apps in Toss integration.
- Add a dependency only when the platform or existing dependencies cannot provide the required behavior.

## Documentation

- Product specifications belong in `docs/specs/`.
- Executable plans belong in `docs/plans/`.
- Research and temporary decision records belong in `docs/notes/`.
- Write code identifiers and technical documentation in English.
- Record current external policy links and access dates when a decision depends on them.

## Verification

- Run the smallest focused test first, then the full declared quality gate.
- For dependency changes, regenerate and commit `pnpm-lock.yaml` with the manifest.
- Before a production launch or payment activation, verify the legal and platform gates in `docs/specs/product.md` against current primary sources.
