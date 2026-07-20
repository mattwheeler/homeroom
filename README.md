# Homeroom

Homeroom is a guardian-connected AI workspace for K–12 students. It turns read-only school records, calendars, and family logistics into a calm, age-appropriate next step while keeping the student in control.

This repository contains the public OpenAI Build Week prototype: application source, migrations, tests, security guidance, and reproducible setup instructions. Internal planning, release operations, judge handoff, and submission production materials are maintained outside the public repository.

> **Demo-data policy:** The included household, student profile, classes, coursework, and events are fictional or synthetic. Do not commit real student records, private calendar feeds, credentials, or personally identifying information for a minor.

## What it does

Homeroom separates the student and guardian experiences while connecting them through explicit, student-approved actions.

- **Today** combines a private AI check-in with one recommended next action. The student can choose a different task, plan the day, or ignore the recommendation.
- **Calendar** combines read-only schoolwork, extracurricular events, and official school dates without allowing Homeroom to modify the source systems.
- **Classes** organizes connected courses and assignments while preserving the original source and submission boundary.
- **Supplies** shows only attributed lines from an official list. Missing items or quantities are never invented by a model.
- **Learn** provides short, course-scoped readiness sessions with transparent learner memory and no model-assigned grades.
- **Task Room** breaks an assignment into timeboxed, source-aware steps and persists the student's progress.
- **Guardian workspace** manages the student profile, learning supports, safety controls, source connections, approved family reminders, and a limited progress summary.

There is no separate demo-only application or forced judge sequence. Reviewer access opens the same `/student` and `/guardian` product paths used by authenticated accounts.

## Product principles

1. **Student agency:** AI proposes; the student chooses.
2. **Guardian connection without surveillance:** private coaching stays private, and only student-approved family messages are shared.
3. **Read-only school integrations:** Homeroom does not post, submit, grade, RSVP, or edit provider data.
4. **Age-aware executive-function support:** time management, organization, and prioritization are taught through the work rather than presented as a separate lecture.
5. **Source truth over model guesses:** dates, classes, assignments, events, and shopping lists require an attributed source.
6. **Visible, erasable continuity:** retained learning preferences and progress are scoped, inspectable, and deletable.

## Technical foundation

- Next.js 16 application surface running on Vinext and Cloudflare Workers
- Cloudflare D1 for authoritative, versioned application state
- OpenAI Responses API targeting `gpt-5.6-sol`
- Strict, stage-scoped function tools with application-side validation
- Google OpenID Connect with PKCE, nonce, signed one-time intent cookies, verified email, and role allowlists
- Signed, role-scoped, `HttpOnly` sessions with same-origin and CSRF controls
- Encrypted provider tokens and private calendar feed URLs
- One-time approval receipts bound to actor, arguments, version, expiry, and idempotency key
- D1-backed rate limiting for public and model-spending endpoints
- Persisted focus sessions, student-approved guardian notifications, and scheduled email digests
- Adapter boundaries for Google Classroom, iCalendar feeds, official school calendars, and official supply pages

The application—not the model—owns permissions, source normalization, state transitions, approval, persistence, deterministic grading, and write authorization. Model calls use `store: false`, bounded context, structured output, and a limited tool surface.

## How Codex and GPT-5.6 were used

Codex served as the implementation partner across product specification, interface iteration, integration debugging, database migrations, security hardening, testing, and documentation. The resulting behavior is preserved as normal reviewable source code and automated verification rather than hidden in an unreproducible prompt workflow.

GPT-5.6 Sol powers bounded proposal and coaching tasks:

- the day planner reads an application-built, read-only projection before proposing a plan;
- plan revisions compare against the latest source fingerprint and stage a new immutable version;
- Learning Rooms receive a course objective, the student's explicit support preference, bounded recent dialogue, and evidence-backed continuity; and
- coaching can offer questions and hints while deterministic application code retains grading authority.

The model cannot save a plan, send a family message, acknowledge a guardian notification, mutate a school source, grade work, or authorize itself. Source reads, generation, proposal staging, one-time approval, and persistence remain separate boundaries.

## Repository scope

Public repository documentation is intentionally limited to material needed to understand, run, review, secure, and license the software:

- this README;
- [`SECURITY.md`](SECURITY.md); and
- the [MIT license](LICENSE).

Product strategy, decision records, competitive analysis, release operations, judge credentials, submission field drafts, and video production materials are internal project documentation and are not stored here.

## Local setup

Requirements: Node.js 22 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Set a random `SESSION_SIGNING_SECRET` of at least 32 characters in `.dev.vars`. Add `OPENAI_API_KEY` only when testing a live model turn. Secrets, build output, local logs, coverage, and local D1 state are ignored by Git.

Optional live integrations use environment-specific values such as:

```dotenv
SOURCE_TOKEN_ENCRYPTION_KEY=a-different-random-secret-at-least-32-characters
GOOGLE_CLASSROOM_CLIENT_ID=your-google-oauth-web-client-id
GOOGLE_CLASSROOM_CLIENT_SECRET=your-google-oauth-web-client-secret
GOOGLE_IDENTITY_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
AUTH_GUARDIAN_EMAILS=guardian-google-account@example.com
AUTH_STUDENT_EMAILS=student-google-account@example.com
RESEND_API_KEY=your-resend-api-key
GUARDIAN_DIGEST_FROM=Homeroom <updates@your-verified-domain.example>
CRON_SECRET=another-random-secret-at-least-32-characters
JUDGE_ACCESS_CODE=a-private-random-review-code-at-least-24-characters
```

In Google Cloud, enable the Classroom API, configure the OAuth consent screen, add authorized test accounts while the application remains in testing, and register the exact callback URI on a Web application OAuth client. Classroom access is limited to:

- `classroom.courses.readonly`
- `classroom.coursework.me.readonly`

Identity sign-in requests only `openid email profile`.

## Read-only source architecture

All external providers feed a normalized, household-scoped projection. That projection powers Today, Calendar, Classes, Supplies, Task Room, and the day planner without exposing source credentials to the student interface.

### Google Classroom

The Classroom adapter uses Google's OAuth web-server flow, encrypted offline refresh tokens, one-time hashed state, and a callback-only session. It reads active courses, published coursework, and the signed-in student's own submission state, then stores one atomic normalized snapshot in D1.

### Calendar feeds

The iCalendar adapter supports approved HTTPS calendar providers. It rejects credentials and nonstandard ports, manually validates every redirect, limits payload size, parses timed and all-day events, and encrypts the private subscription URL at rest.

### Official school pages

Official calendar and supply-page adapters use an explicit hostname allowlist and fail closed when a publication is unavailable or changes shape. Every imported record retains source attribution. Student checkmarks are private organizational state and never alter the official page.

The Build Week prototype includes one verified district-family adapter as evidence that this approach works. Supporting arbitrary districts requires a reviewed adapter or a standards-based feed; the application does not pretend that an unverified page was successfully connected.

## Verification

```bash
npm test
npm run test:e2e
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run security
npm run verify:release
```

Release verification covers unit and integration tests, browser journeys for both roles, type checking, linting, production build output, dependency auditing, and repository secret checks.

## Security and privacy

See [`SECURITY.md`](SECURITY.md) for the trust boundaries, reporting process, and deployment expectations.

Important defaults:

- never place real student data in fixtures, screenshots, commits, issues, or pull requests;
- never commit `.dev.vars`, OAuth secrets, API keys, judge access codes, private feed URLs, or exported D1 data;
- use separate guardian and student identities and exact role allowlists;
- retain read-only provider scopes and source-specific hostname policies; and
- run the complete release verification before publishing a deployment.

## Provider references

- [Google Classroom authorization scopes](https://developers.google.com/workspace/classroom/guides/auth)
- [Google Classroom courses.list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list)
- [Google Classroom coursework list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork/list)
- [Google Classroom student submissions list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/list)
- [BAND calendar export instructions](https://help.mobilecore.naver.com/help/viewHelp.nhn?countryCode=EN&helpNo=1095&languageCode=en&serviceCode=band)
- [CutTime calendar subscription guidance](https://support.gocuttime.com/article/298-subscribing-to-individual-calendar)
- [BAND Open API guide](https://developers.band.us/develop/guide/api)

## Status

Homeroom is an OpenAI Build Week prototype, not a production student-information system. The architecture demonstrates a server-authoritative path to a multi-household product, but a public production release would require continuing privacy, compliance, accessibility, provider-verification, and operational review.
