# Homeroom

Homeroom is a guardian-connected AI workspace designed specifically for K–12 students. The Build Week prototype follows Emily, a fictional 14-year-old starting ninth grade, as she prepares for band camp and seven upcoming classes.

The product thesis is simple: students should not have to translate a pile of school portals, calendars, assignments, and family logistics into a workable day by themselves. Homeroom turns approved source records into a calm, age-appropriate plan while keeping consequential actions explicit, reviewable, and reversible.

## Golden experience

The demo is a single rehearsable contract:

1. Emily starts a private student session.
2. Homeroom reads seven fictional Google Classroom-style course records and a BAND calendar event.
3. Emily reviews and approves a personalized band-camp morning plan.
4. A controlled calendar change moves check-in from 7:30 AM to 7:15 AM.
5. Homeroom explains the source change and asks before saving plan version two.
6. Emily practices one algebra problem with hints instead of answer dumping.
7. Emily previews exactly what Matt can see, then explicitly publishes the guardian-safe summary.
8. The proof view exposes source, approval, version, and model traces for judges.

All names and school records in the repository are fictional fixtures. No real student data is required for the submission demo.

## Technical foundation

- Next.js 16 application surface running on Vinext and Cloudflare Workers
- Cloudflare D1 for authoritative, versioned demo-session state
- OpenAI Responses API targeting `gpt-5.6-sol`
- Strict, stage-scoped function tools with application-side validation
- Explicit approval receipts bound to actor, arguments, expected versions, expiry, and idempotency key
- Signed, role-scoped, `HttpOnly` session cookies plus same-origin and CSRF controls
- Adapter boundaries for Google Classroom and BAND/iCalendar sources

The AI loop uses low reasoning effort, low verbosity, `store: false`, a four-round tool ceiling, and preserves complete response output items and tool call IDs across continuations. The model can propose and explain; the application remains authoritative for permissions, state transitions, source diffs, math grading, and writes.

## Live Golden Experience slice

The first three Golden Experience interactions are live end to end. After Emily starts a signed demo session, **Build my morning plan** calls `gpt-5.6-sol` through the OpenAI Responses API. The model must use one strict, read-only `get_morning_plan_context` function before returning a structured proposal.

The server—not the model—enforces the authenticated session, student role, same-origin and CSRF checks, fixture allowlist, source version, exact timeline values, and request limits. Each turn records the returned model name, OpenAI response IDs, tool call ID, latency, and token usage in D1 for the judge proof view. API requests use `store: false` and a hashed safety identifier; the OpenAI key never reaches the browser.

The proposal is staged in D1 with a short-lived approval challenge bound to Emily, the exact server-stored plan, and the expected state, source, and plan versions. The browser sends only the action ID and one-time receipt when Emily selects **Approve and save Plan V1**—it cannot submit replacement plan content. A verified approval atomically writes Plan V1, consumes the receipt, advances the authoritative session state, and adds an audit event. Exact retries within the receipt window return the original saved result without creating a second plan.

After Plan V1 is saved, **Check BAND for updates** advances the controlled calendar fixture from source V1 to V2 and records the sole validated difference: check-in moved from 7:30 AM to 7:15 AM. A second live Responses API turn must use the read-only `get_plan_revision_context` tool before explaining that change and proposing an exact 15-minute shift to the morning timeline. The application keeps Plan V1 active until Emily separately approves Plan V2.

Source sync, model generation, proposal staging, and approval are distinct boundaries. If generation fails after source V2 is committed, a retry resumes from `SOURCE_V2_SYNCED` without repeating the sync. Plan V2 approval is bound to the exact server-stored revision and source V2; the atomic D1 write activates Plan V2 while retaining Plan V1 as immutable history.

Once Plan V2 is active, **Start Algebra refresher** opens a live, hint-led exercise for `3(x + 2) = 18`. GPT-5.6 Sol must use the read-only `get_practice_exercise` tool and return one structured Socratic prompt about inverse operations. The tool context deliberately excludes the intermediate equation and final answer, and application validation rejects any model output that reveals either one.

Emily chooses the first transformation and enters the final value herself. Both responses are graded by deterministic Homeroom code—not by the model. The server reveals `x + 2 = 6` only after the first operation is verified, refuses out-of-order completion, keeps incorrect-answer responses answer-free, and advances the authoritative session only after the final value is correct. D1 stores the private practice result, validated steps, attempts, hint count, completion timestamp, and one audit event.

## Local setup

Requirements: Node.js 22 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Set a random `SESSION_SIGNING_SECRET` of at least 32 characters in `.dev.vars`. Add `OPENAI_API_KEY` only when exercising a live model turn. Secrets and local D1 state are ignored by Git.

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

## Source integration plan

The golden demo begins with deterministic fixture adapters so the judge experience cannot be broken by school permissions or event drift. The same normalized source interfaces are the seam for:

- a read-only Google Classroom OAuth adapter for courses, coursework, and due dates;
- a BAND calendar subscription adapter when a team calendar feed is available;
- controlled fixture replay for the recorded video and on-stage fallback.

External school systems remain read-only in this prototype. Plans, practice results, approvals, and guardian projections are Homeroom-owned records.

## Project documents

- [Build Week workspace](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/overview?homepageId=71925927)
- [Homeroom thin specification](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/pages/72843436)
- [Decision log](https://riseuplabsllc.atlassian.net/wiki/spaces/OBW/pages/72122369)

This repository is an OpenAI Build Week prototype, not a production student-information system.
