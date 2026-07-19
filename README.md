# Homeroom

Homeroom is a guardian-connected AI workspace designed specifically for K–12 students. The Build Week prototype follows Emily, a fictional 14-year-old starting ninth grade, as she prepares for band camp and seven upcoming classes.

The product thesis is simple: students should not have to translate a pile of school portals, calendars, assignments, and family logistics into a workable day by themselves. Homeroom turns approved source records into a calm, age-appropriate plan while keeping consequential actions explicit, reviewable, and reversible.

## Product surfaces

- `/student` is Emily's complete student workspace. **Today** presents one actionable next task, **Calendar** combines schoolwork, band events, and official district dates, **Classes** shows all seven connected Classroom classes, **Supplies** shows only attributed school-list lines, and **Learn** opens independent AI-led Learning rooms. AI planning, source-change review, family help, guardian-safe sharing, and transparency evidence are progressively disclosed inside this journey. Guardian controls and source credentials never appear here.
- `/guardian` is Matt's separate guardian workspace for Emily's age/grade profile, learning supports, safety and privacy controls, and read-only source connections—including Google Classroom, band calendars, the official district calendar, and official school/course supply pages.
- `/` is a role-aware account entry screen. Student and guardian accounts authenticate separately with their allowlisted Google identities before opening their workspace. There is no separate demo product or demo-only route.

## Live product experience

Homeroom has no separate demo application and no forced judge sequence. The production student and guardian journeys are the Build Week experience:

1. A verified Google identity resolves to a durable student or guardian principal and household membership.
2. Guardian-managed, read-only sources populate the live projection: Google Classroom, CutTime/BAND calendar exports, official district dates, and official school supply pages.
3. **Today** recommends one next action, but Emily can always choose a different task, class, Learning Room, calendar date, or family-help request.
4. **Plan today** runs GPT‑5.6 Sol against the current live projection. Emily can accept the exact proposal, request an alternative, or ignore it. Every saved version is bound to the source fingerprint and a one-time approval receipt.
5. **Task Room** persists the selected timebox, completed chunks, elapsed time, and estimate-versus-actual evidence. A shame-free re-entry card uses that history after time away without streak pressure.
6. **Ask Matt** shows Emily the exact notification first. Only her approved message enters Matt's guardian inbox, where it can be acknowledged and included in an approved-only weekly email digest.
7. **Learn** opens any connected class immediately; tutoring, planning, schoolwork, and family help are independent capabilities rather than prerequisites for one another.

The included Classroom sandbox records are fictional and safe for a submission walkthrough. The same product paths also operate on authenticated live source data; source writes, submissions, grade changes, and calendar edits are never requested.

### Operational Learning continuity

Emily can open any of her seven upcoming classes immediately after signing in:

- English I — claims and evidence;
- Algebra I — preserving equality;
- Biology — scientific reasoning;
- World Geography — reasoning from map evidence;
- Concert and Marching Band — pulse and rhythm rehearsal;
- Art I — observation before interpretation;
- Spanish I — conversational retrieval.

Each course has an allowlisted readiness mission, objective, source label, and subject-specific coaching mode. The current missions are explicitly labeled **Homeroom readiness mission**; the application never claims they came from a teacher or school. When Google Classroom is connected, the class hub uses the live Classroom name for every deterministic subject match while the readiness mission remains clearly Homeroom-authored. Unrecognized classes stay visible as **track mapping needed** instead of being guessed by a model.

The class grid is a navigation hub. Selecting a class opens a dedicated, full-screen **Learning Room** with focus transfer, a clear return path, keyboard Escape support during setup, and exit protection while the live coach is working. This keeps timeboxed dialogue, learner memory, and progress separate from the day dashboard instead of expanding an increasingly long card in place.

Emily chooses a 10, 15, or 20 minute timebox and an explicit support preference before opening the live coach. The server—not the model—owns the clock and advances the session through check-in, diagnostic, guided practice, transfer, and recap. Each model turn asks one next question and keeps the work with Emily. She can continue for multiple turns, end early, or let the last two minutes force a recap. Ending without answering does not inflate objective progress.

Homeroom owns learner continuity as transparent structured data. During an active session, only the last eight dialogue entries are retained for bounded coaching context. Completion atomically clears that dialogue, saves a recap, updates evidence-backed course progress, and stores only the support preference Emily explicitly selected. That memory is course-scoped, expires after 90 days, is visible in **What Homeroom remembers**, and can be deleted by Emily with an audit event. Homeroom does not persist diagnoses, intelligence labels, model-inferred personality, raw completed dialogue, or unsupported mastery claims.

Every Learning model call uses `gpt-5.6-sol`, one strict read-only `get_learning_session_context` tool, and `store: false`. Homeroom sends a fresh, application-built context on every turn instead of relying on provider-side conversation memory or `previous_response_id`. Learning sessions, learner signals, objective progress, and memory events have dedicated D1 tables and do not mutate planning, task, or family-reminder state.

## Technical foundation

- Next.js 16 application surface running on Vinext and Cloudflare Workers
- Cloudflare D1 for authoritative, versioned product-session state
- OpenAI Responses API targeting `gpt-5.6-sol`
- Strict, stage-scoped function tools with application-side validation
- Explicit approval receipts bound to actor, arguments, expected versions, expiry, and idempotency key
- Signed, role-scoped, `HttpOnly` session cookies plus same-origin and CSRF controls
- Google OpenID Connect with PKCE, nonce, signed one-time intent cookies, verified email, and exact role allowlists
- A persisted guardian inbox for independently approved family reminders
- An approved-only guardian email digest delivered by the scheduled Worker
- Durable, per-principal household identity instead of a global Emily/Matt actor mapping
- D1-backed rate limiting for public and OpenAI-spending endpoints
- Persisted focus blocks and shame-free student re-entry
- Seven independent, timeboxed Learning tracks with application-managed learner continuity
- Adapter boundaries for Google Classroom, BAND/iCalendar, official Comal ISD calendar records, and official school supply pages

The AI loop uses low reasoning effort, low verbosity, `store: false`, a four-round tool ceiling, and preserves complete response output items and tool call IDs across continuations. The model can propose and explain; the application remains authoritative for permissions, state transitions, source diffs, math grading, and writes.

## How Codex and GPT‑5.6 were used

Codex was the implementation partner across product specification, UI iteration, source-adapter debugging, migrations, security hardening, tests, and Build Week documentation. The repository preserves that work as normal reviewable source code and automated verification rather than hiding core behavior in prompts.

GPT‑5.6 Sol powers bounded proposal and coaching tasks through the OpenAI Responses API:

- live day planning must first read the server-built, read-only source projection;
- plan refreshes compare against the latest projection fingerprint and stage a new immutable version;
- Learning Rooms receive course-scoped objectives, the student's explicit support preference, bounded recent dialogue, and evidence-backed continuity; and
- Socratic practice can provide hints, while deterministic application code retains grading authority and rejects answer leakage.

Every model request uses strict structured output, stage-scoped read-only tools, `store: false`, a hashed safety identifier, and application-side validation. The model cannot save a plan, send a family note, acknowledge an inbox item, mutate a school source, grade work, or authorize itself. Source reads, model generation, proposal staging, one-time approval, and persistence remain separate boundaries.

The earlier deterministic Golden state machine is retained only as backend regression and audit evidence for approval receipts, versioning, privacy projections, and replay resistance. It is not exposed as a second product or required navigation path.

## Local setup

Requirements: Node.js 22 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Set a random `SESSION_SIGNING_SECRET` of at least 32 characters in `.dev.vars`. Add `OPENAI_API_KEY` only when exercising a live model turn. Secrets and local D1 state are ignored by Git.

For live read-only sources, also set:

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
```

In Google Cloud, enable the Classroom API, configure the OAuth consent screen, add both linked accounts as test users while the app remains in testing, and register the exact redirect URI above on the same **Web application** OAuth client. Identity and Classroom authorization return through that single hardened callback, then are separated by mutually exclusive HttpOnly intent cookies. Classroom requests only `classroom.courses.readonly` and `classroom.coursework.me.readonly`; identity sign-in requests only `openid email profile`.

`AUTH_GUARDIAN_EMAILS` and `AUTH_STUDENT_EMAILS` are comma-separated exact allowlists. A verified Google identity is resolved to a durable principal and household membership; a student account cannot open the guardian workspace and vice versa. Product sessions have no hostname- or environment-based fixture bypass. `RESEND_API_KEY` and `GUARDIAN_DIGEST_FROM` enable the weekly guardian digest; the scheduled Worker call is authenticated with `CRON_SECRET`.

For the Band of Warriors, paste the guardian-specific CutTime calendar subscription URL from CutTime's **Calendar Links** area into Homeroom's guardian source panel. Homeroom also accepts BAND's official calendar export URL when a program uses BAND for its calendar. Treat either subscription URL like a password: Homeroom encrypts it at rest and never returns it to the browser after connection.

Useful checks:

```bash
npm test
npm run test:e2e
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run security
```

## Read-only school sources

The source layer is operational and feeds the same live projection used by Today, Calendar, Classes, Supplies, Task Room, and the AI day planner.

### Official district dates and supply lists

The guardian workspace can connect Comal ISD's official calendar page and one or more official school/course supply-list pages. Homeroom stores attributed snapshots in D1 and exposes them to Emily without exposing source configuration controls:

- district holidays, first/last school days, staff/student holidays, and published early-release dates appear in **Calendar** with a distinct **School** color and an official-source label;
- grade-inapplicable dates are filtered—for example, an elementary-only early release is not presented as Emily's ninth-grade schedule;
- every supply line retains the official page URL and source title;
- missing quantities or missing items remain missing—Homeroom never asks a model to complete or infer a shopping list; and
- student checkmarks are private organizational state and never alter the official page.

The adapters accept only HTTPS Comal ISD/Pieper domains, reject credentials and nonstandard ports, manually revalidate redirects, enforce payload limits, and fail closed when the official publication is missing or changes shape. The initial verified sources are [Comal ISD calendars](https://www.comalisd.org/apps/pages/calendars) and Pieper High School's official course supply pages; guardians can add additional official Comal/Pieper supply pages without a code change.

Google Classroom uses Google's OAuth web-server flow with one-time hashed state, a confidential server-side client, an offline refresh token encrypted with AES-GCM, and a ten-minute callback-only session cookie. On connect or refresh, Homeroom:

1. lists Emily's active courses with `studentId=me`;
2. reads only published coursework for each course;
3. reads only Emily's own submission state with `userId=me`;
4. normalizes those records into D1 in one atomic snapshot;
5. maps recognized course names to the seven Learning tracks with deterministic application rules; and
6. returns only public class, coursework, event, connection-status, and last-sync fields to the browser.

The Band of Warriors source map keeps each real tool's job honest:

- CutTime contributes the live guardian-specific calendar feed for rehearsals, performances, competitions, call times, and schedule changes.
- The Weekly Sheet remains a linked, read-only source. The verified Drive folder currently contains archived seasons but no current-season sheet, so Homeroom shows a waiting state instead of inventing content.
- BAND announcements require a reviewed BAND developer application and member authorization. Until those credentials exist, Homeroom links the official path and does not claim announcements are connected. BAND's calendar export remains a supported alternative calendar feed.
- The Band of Warriors parent portal remains the verified hub for official family links and resources.

The calendar fetcher accepts only HTTPS `band.us` or `gocuttime.com` hosts, rejects credentials and nonstandard ports, manually revalidates every redirect, limits payload size, keeps the 500 most recent events, parses timed and all-day events, and stores the private feed URL only as encrypted ciphertext.

The current UI refreshes both sources on explicit student action and synchronizes immediately after connection. A production deployment can invoke the same idempotent sync service from a scheduled worker and refresh stale snapshots when the student opens Homeroom. Provider data remains read-only: Homeroom never posts, edits, submits, grades, or RSVPs. Plans, learner continuity, approvals, and guardian projections remain Homeroom-owned records.

## Public deployment checklist

Before exposing a persistent judge URL:

1. apply every D1 migration, including `0009_product_loops.sql`, to the remote `homeroom-build-week` database;
2. configure the production Google identity and Classroom callback URLs and exact student/guardian email allowlists;
3. set `SESSION_SIGNING_SECRET`, `SOURCE_TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `GUARDIAN_DIGEST_FROM`, and `CRON_SECRET` as Worker secrets;
4. verify the sending domain in Resend before enabling the weekly guardian digest;
5. smoke-test student sign-in, guardian sign-in, source refresh, live-plan approval, Task Room completion, family-note delivery, inbox acknowledgement, and the scheduled digest against the deployed origin; and
6. keep the D1-backed rate limiter and structured logging enabled on every public and model-spending endpoint.

No remote migration, deployment, or outbound email is performed by the local setup commands.

Official provider references:

- [Google Classroom authorization scopes](https://developers.google.com/workspace/classroom/guides/auth)
- [Google Classroom courses.list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses/list)
- [Google Classroom coursework list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork/list)
- [Google Classroom student submissions list](https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/list)
- [BAND calendar export instructions](https://help.mobilecore.naver.com/help/viewHelp.nhn?countryCode=EN&helpNo=1095&languageCode=en&serviceCode=band)
- [CutTime guardian calendar subscription](https://support.gocuttime.com/article/298-subscribing-to-individual-calendar)
- [BAND Open API guide](https://developers.band.us/develop/guide/api)
- [Band of Warriors parent resources](https://www.pieperbandofwarriors.com/parent-resources)

## Project documents

- [Build Week workspace](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/overview?homepageId=71925927)
- [Homeroom thin specification](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/pages/72843436)
- [Decision log](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/pages/72122369)

This repository is an OpenAI Build Week prototype, not a production student-information system.
