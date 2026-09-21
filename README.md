# Model Pass

Model Pass is the working title for a private, rule-based application tool for hair promotion-exam models and makeup certification-exam models.
The first market is recruiters based in Gangnam-gu, Seoul, and applicants aged 19 or older.

The product is deliberately not a public model marketplace.
Recruiters publish their own opportunity posts, applicants choose whether to apply, deterministic rules identify explicit incompatibilities, and recruiters make the final selection.

## Current Status

The repository currently contains the approved product specification and the first standalone web MVP implementation plan.
Application code has not been scaffolded yet.

## Documents

- [Product specification](docs/specs/product.md)
- [Standalone web MVP implementation plan](docs/plans/2026-09-22-standalone-web-mvp.md)
- [Working notes](docs/notes/README.md)

## Planned Delivery Order

1. Confirm the service classification and pre-launch obligations using the exact proposed user flow.
2. Build and test the standalone web pilot.
3. Run paid Gangnam pilot listings with hair and makeup recruiters.
4. Decide whether repeat usage justifies product expansion.
5. Request Apps in Toss service pre-review and create a separate integration plan.

## Quality Gate

The implementation plan uses pnpm, TypeScript strict mode, Vitest, React Testing Library, and Supabase migration tests.
Trunk should be configured after the application scaffold defines the real formatter, linter, and test commands.
