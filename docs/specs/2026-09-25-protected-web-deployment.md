# Protected Standalone Web Deployment

## Problem

The applicant-facing flow needs a hosted standalone web address, while service pre-review and legal classification remain incomplete.
The project already separates applicant access from recruiter sign-in and must preserve that boundary on the hosted site.

## Scope

- Host the existing standalone web build in the personal Vercel project named `model-pass` at its default `vercel.app` domain.
- Keep Preview and Production deployments behind Vercel Authentication until the launch gates in `product.md` are satisfied.
- Configure only public Supabase browser variables in Vercel. Keep anonymous opportunity listing disabled in Supabase and on the home screen.
- Exclude local secrets, Supabase workspace state, and generated build artifacts from deployment and source checks.
- Preserve direct-link application routes and the recruiter login route in the standalone web build.

## Non-Goals

- Public launch, payment activation, Apps in Toss review submission, and removal of deployment protection.
- New recruiter or applicant authentication methods.
- Git-connected automatic deployments.

## Acceptance Criteria

1. The default domain resolves to the current standalone web build, and an unauthenticated request redirects to Vercel Authentication.
2. A protected browser session can load the home screen and direct application routes with the configured Supabase project.
3. The removed anonymous opportunity-list endpoint returns 404. The home screen provides no public catalogue, while a job-scoped direct application link still opens its opportunity.
4. The web, AIT, unit, Edge Function, browser, lint, type, format, and repository quality checks pass before PR publication.
5. No secret values or local Supabase state enter the Git diff or Vercel source upload.

## Constraints

The service pre-review and legal classification gates in `product.md` remain open.
Vercel Authentication is a temporary access boundary for this deployment, not a statement of launch readiness.
