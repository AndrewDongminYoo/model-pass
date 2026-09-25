# Apps in Toss Applicant Entry

## Decision

The Apps in Toss build is an applicant-only surface with direct-link entry.
The standalone web build retains recruiter email/password authentication and opportunity management.
The miniapp does not offer Supabase or any other non-Toss sign-in.
This is an implementation and test scope decision, not authorization to request review or launch.

## Applicant Flow

The miniapp home accepts a shared Model Pass opportunity URL from `https://model-pass.vercel.app`, a matching `intoss://model-pass/opportunities/{id}/apply` URL, or the opportunity UUID.
It validates and extracts the opportunity ID locally, navigates to the existing application route, and leaves opportunity availability and eligibility to the existing server functions.
An invalid link produces an inline error without an external navigation or personal-data request.
Direct deep links to the same route remain available.
There is no public candidate profile, candidate search, or automatic candidate selection.

The existing job-scoped application receipt and privacy controls remain authoritative.
The miniapp does not create a separate identity for link entry.

## Recruiter Flow

The standalone web build keeps its existing Supabase-authenticated recruiter routes.
After publication, the recruiter can copy an absolute HTTPS applicant URL as well as open the existing relative application route.
The miniapp build does not render or call recruiter login, publication, or application-management routes.

## Release Boundary

Anonymous public listing is disabled. First-visit opportunity discovery is deferred until service pre-review and legal classification are complete.
The recruiter preview tells recruiters to share the job-scoped link because publication alone does not expose a listing on the app home screen.
Before review or launch, the operator must confirm the legal and platform gates in the product specification.

## Verification

Unit tests cover valid and malformed links, channel-specific routes, and copyable recruiter URLs.
Browser tests cover link-only entry and preserve the standalone recruiter flow.
The AIT and standalone web builds must each compile without a new dependency or database migration.

## Current Platform References

The [Apps in Toss non-game checklist](https://developers-apps-in-toss.toss.im/checklist/app-nongame.md) prohibits non-Toss login and requires declared in-app features to work (accessed 2026-09-25).
The [feature-route guide](https://developers-apps-in-toss.toss.im/development/test/function.md) maps WebView routes to `intoss://{appName}/{path}` (accessed 2026-09-25).
