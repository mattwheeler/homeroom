# Homeroom code-freeze audit — 2026-07-20

## Executive assessment

Homeroom is a credible Build Week release candidate, not a clickable concept. Its strongest competitive argument is the complete student–guardian loop: authenticated household roles, real read-only school sources, bounded AI coaching, explicit approvals, persisted student progress, guardian-visible coarse progress, and student-controlled family sharing all operate in the same product.

The release gate is green locally and on the deployed origin. The public Worker, D1, production secrets, migrations, Google callbacks, Resend domain, and scheduled trigger are configured. Release `323ec4cbc84f17f30a6628a42199f08169d7e2f6` is live as Cloudflare Worker version `d0c9c58c-643d-4a37-a6e3-e1075b173467` (the code release plus the final cron-secret rotation).

### Scorecard

| Area | Score | Assessment |
| --- | ---: | --- |
| Problem and product thesis | 9.4/10 | Specific, emotionally legible, and grounded in a real K–12 coordination problem. |
| Working product depth | 9.2/10 | Student, guardian, source, AI, planning, learning, reminder, progress, and digest loops are implemented. |
| OpenAI use | 9.3/10 | GPT‑5.6 Sol is used where generation or coaching adds value; permissions, grading, clocks, and writes remain deterministic. |
| Trust, privacy, and safety | 9.5/10 | Unusually strong for a hackathon: role isolation, explicit sharing, minimal scopes, hardened callbacks, source attribution, and no school-source writes. |
| UI/UX and accessibility | 9.1/10 | Calm, age-aware hierarchy with desktop/mobile E2E, keyboard coverage, focus management, and automated accessibility checks. |
| Engineering and operations | 9.2/10 | D1-authoritative state, migrations, rate limits, logs, health, tests, release runbook, and rollback path. |
| Submission readiness | 8.2/10 before video/form; 9.3/10 after | The product is ready; remaining risk is presentation and required submission metadata. |

This score does not predict placement in a large field. It says the build has the technical and product substance to be judged seriously; the final video must make that substance obvious in under three minutes.

## Automated release evidence

`npm run verify:release` passed on 2026-07-20:

- dependency audit: **0 vulnerabilities**;
- TypeScript: passed;
- ESLint: passed with zero warnings;
- Vitest: **430/430 tests passed** across 100 files;
- coverage: **88.40% statements, 80.23% branches, 91.92% functions, 90.77% lines**;
- production Vinext/Cloudflare build: passed; and
- Playwright: **6/6 desktop and mobile journeys passed**.

The browser gate includes horizontal-overflow checks, serious/critical WCAG 2 A/AA scanning, keyboard-operable judge access, and the complete student journey.

### Deployed-origin evidence

The final release was exercised against `https://homeroom-build-week.riseuplabs-homeroom.workers.dev` on 2026-07-20:

- `/api/health`: D1 ready and exact release SHA reported;
- public root: HTTP 200 with CSP, HSTS, frame denial, nosniff, Referrer-Policy, Permissions-Policy, COOP, and CORP;
- student judge identity and bootstrap: HTTP 200 with seven connected classes and the bounded live calendar projection;
- live GPT-5.6 morning plan: HTTP 200 after the structured-output regression fix;
- guardian judge identity and product session: HTTP 200/201;
- guardian workspace: HTTP 200 with Emily and four configured source categories;
- guardian inbox and approved-only digest preview: HTTP 200;
- authenticated cron route: HTTP 200 with zero eligible recipients and zero deliveries; and
- Worker tail: all exercised routes completed normally, with no CPU-limit or unhandled exception.

There were no unread student-approved guardian notes during the freeze smoke, so the release did not manufacture a reminder or send a content-free email merely to produce evidence. Reminder delivery, acknowledgement, and digest inclusion remain covered by the automated suite.

## Infrastructure and deployment audit

### Ready

- Cloudflare Worker with an explicit compatibility date, persistent observability, invocation logs, and version metadata.
- Remote D1 database with additive, forward-only migrations through `0011_reviewer_identity_provider.sql`.
- Weekly Sunday guardian-digest schedule (`0 14 * * SUN`) protected by `CRON_SECRET`.
- `/api/health` checks D1 and exposes the deployed release identity and model target.
- Cloudflare deployment versions provide code rollback without destructive database rollback.
- All required Worker secrets are present; secrets and local D1 state are ignored by git.
- Google identity and Classroom callbacks are registered for local and production origins.
- Resend sending domain is verified and the guardian sender is configured.

### Release hardening completed

- The OpenAI Responses transport uses a small direct HTTP client instead of loading the full Node SDK on each Worker AI invocation.
- Student bootstrap loads source aggregates concurrently.
- The live projection reads a bounded, non-destructive calendar window (31 days back, up to 370 days forward, maximum 180 BAND events). All imported events remain in D1; this only controls the payload used by Today and AI planning.

### Residual infrastructure risks

- Calendar history is not paginated. The bounded projection is correct for the current student experience, but a multi-year product should add cursor-based calendar loading.
- The public release is a single Cloudflare deployment rather than a multi-region enterprise topology. This is appropriate for Build Week.
- Provider availability remains an external dependency. Homeroom fails closed and keeps the last attributed snapshot.

## Security, privacy, and repository audit

### Authentication and authorization

- Google OpenID Connect uses PKCE, nonce, signed one-time intent cookies, verified email, and exact role allowlists.
- Verified Google subjects resolve to durable principals and household membership; students cannot enter guardian routes.
- Judge access is secret-protected, D1-rate-limited, expires after two hours, and resolves to the fictional review household without rewriting Google identities.
- Product sessions are signed, role-scoped, `HttpOnly`, `SameSite=Lax`, and secure on HTTPS.

### Request and data controls

- Mutating routes enforce same-origin, CSRF, JSON content type, and request-size limits.
- Public and OpenAI-spending endpoints use D1-backed per-principal/IP fixed-window limits.
- Approval receipts bind actor, arguments, state version, expiration, and idempotency key; replay is rejected.
- SQL is parameterized. Source tokens are AES-GCM encrypted at rest and never returned to the browser.
- Source fetchers require HTTPS, reject credentials and nonstandard ports, revalidate every redirect, restrict hosts, and cap payload size.
- Homeroom never submits, grades, edits, posts, RSVPs, or mutates a school source.

### Browser and supply-chain controls

- Worker-boundary headers include CSP, HSTS, frame denial, nosniff, Referrer-Policy, Permissions-Policy, COOP, and CORP.
- `npm audit --audit-level=high` reports zero vulnerabilities.
- Repository history and tracked files contain no known credentials, OAuth codes, private calendar URLs, API keys, or `.dev.vars`.
- `SECURITY.md` documents reporting and boundaries.

### AI safety

- Model requests use `store: false`, a hashed safety identifier, strict structured output, bounded tool rounds, and application-built context.
- Models can propose and coach but cannot grant permissions, save plans, send reminders, acknowledge inbox items, or grade schoolwork.
- Student safety language detection includes direct and indirect phrases plus false-positive regression cases.
- Private coaching dialogue and answers are not projected to guardians. Guardians see only coarse progress and messages the student explicitly sends.

### Security conclusion

No known critical or high-severity release blocker remains. Production use with non-fictional minors would still require formal legal/privacy review, data-retention policy, incident response, school/district agreements where applicable, and jurisdiction-specific COPPA/FERPA analysis.

## Documentation and repository audit

### Ready

- The README accurately distinguishes live product behavior, fictional review data, source boundaries, OpenAI use, identity, local setup, and deployment.
- `docs/release-runbook.md` covers preflight, remote migrations, secrets, deploy, smoke, digest verification, rollback, and freeze evidence.
- `docs/judge-guide.md` provides one concise student/guardian walkthrough through the real product routes.
- `SECURITY.md` and vulnerability reporting are present.
- GitHub is public with project description and deployed homepage.
- Confluence contains the Homeroom specification and decision history; this audit is mirrored as the dated [Code Freeze & Submission Readiness](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/pages/74448897/Homeroom+Code+Freeze+Submission+Readiness+2026-07-20) page under the Build Week workspace.
- `docs/devpost-submission-runbook.md` maps every live Devpost field to a verified answer or explicit owner decision.
- `docs/demo-video-script.md` provides the final sub-three-minute voiceover and shot list aligned to the judging criteria.

### User decision still required

- The repository intentionally has no license until the owner selects one. Devpost requires the relevant license choice. MIT is the simplest permissive option, but that legal/product decision belongs to the owner.

## Product, feature, and data audit

### Complete release loops

1. Separate student and guardian identity and household membership.
2. Read-only Google Classroom classes, coursework, due dates, and student submission state.
3. BAND/CutTime calendar, official district dates, and source-backed supply lists.
4. A live Today recommendation with alternative choices and optional private check-in.
5. Persisted Task Room timeboxes, task-specific steps, completed sessions, and shame-free re-entry.
6. Class-scoped, timeboxed Learning Rooms with structured, deletable continuity.
7. Live GPT‑5.6 day-plan proposals with source fingerprints, versioned approval, and revision.
8. Student-previewed family reminders, guardian inbox, acknowledgement, coarse progress, and approved-only digest.
9. Guardian controls for age/grade, supports, privacy, external links, and source access.

### Honest limitations

- The release household is intentionally one fictional family. The schema supports durable principals/households, but self-service child/guardian invitations are not implemented.
- Official page adapters are verified for Comal ISD/Pieper sources, not every district CMS in the country.
- ClassLink is not part of the release. A production integration would require district/vendor partnership and ClassLink OAuth/OneRoster approval.
- BAND announcements require reviewed BAND developer credentials; the supported live rail is the program calendar export.
- Homeroom does not replace the school LMS. Completion in Homeroom never claims the school assignment was submitted.

## UI/UX and accessibility audit

### Strengths

- One visual system now spans student, guardian, calendar, classes, supplies, learning, planner, and Task Room.
- Student Today uses the agreed hierarchy: greeting, optional private check-in, then one recommended action.
- Information density is reduced for attention variability; alternatives and history are progressively disclosed.
- Task steps and time allocations are task-aware and respond to the selected focus window.
- Recent work is available without competing with the next action, and guardian progress preserves student privacy.
- External links obey guardian policy.
- Layouts are tested at desktop and mobile widths with keyboard focus handling and no serious automated accessibility violations.

### Remaining UX validation owned by people

- One final deployed-origin visual pass at 100% browser zoom.
- A short usability check with the intended student persona and guardian. Automated tests cannot prove emotional fit, comprehension, or whether the hierarchy feels calm in real use.

## Competition assessment

Homeroom should lead with one sentence: **school portals tell a student what exists; Homeroom helps the student decide what to do next, learn how to do it, and ask a guardian for help without surrendering privacy or agency.**

The demo should prove four things visually:

1. real source data arrives read-only;
2. Emily receives one calm next step and can choose differently;
3. GPT‑5.6 coaches or plans within strict boundaries; and
4. Emily explicitly shares one reminder, which Matt receives alongside privacy-safe progress.

Do not spend video time touring every setting. The differentiator is the connected loop and the trust architecture, not the number of screens.

## Code-freeze decision

### Must complete before freeze

- [x] full local release gate;
- [x] remove the AI Worker SDK CPU overhead;
- [x] bound the live source projection without deleting provider data;
- [x] deploy the release candidate and stamp its commit in `/api/health`;
- [x] run repeated student/guardian deployed-origin smoke checks;
- [x] verify the authenticated scheduled digest endpoint; and
- [x] confirm no Worker CPU-limit event during the smoke.

### Must complete before Devpost submission

- [ ] select and add the repository license;
- [ ] record and upload the final video (under three minutes);
- [x] add the public Worker and GitHub links;
- [ ] add the private judge code and testing instructions;
- [ ] add the correct `/feedback` session ID;
- [ ] upload thumbnail/gallery media;
- [ ] preview the public project page and test every link in an incognito browser; and
- [ ] submit before the deadline and capture confirmation.
