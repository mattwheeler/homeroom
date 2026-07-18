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

### Demo sequence versus product navigation

The numbered Golden Experience is a deterministic judge script, not the intended navigation model for Homeroom. Its linear state machine makes every source change, approval, model turn, and write reproducible in a short demo and prevents stale or out-of-order evidence from weakening the final proof.

In the product, planning, learning, and guardian tasks are separate tracks. Emily should be able to open Algebra without first saving a morning plan, and a physical-form reminder should be available without completing tutoring. Only a genuinely derived action stays dependent—for example, a guardian summary cannot claim that practice is complete until practice is actually complete. The Golden path stays narrow for reliability while product capabilities move to independent state and storage with the same approval and audit guarantees.

The first independent product track is live. Immediately after starting a session, Emily can select **Ask Matt**, review the exact notification that will be delivered, and explicitly approve it. Homeroom persists that notification to Matt's guardian inbox, consumes the one-time approval, and writes a dedicated audit event without changing the Golden state or requiring a plan or tutoring result. The later progress summary remains a separate, optional action because it contains facts derived from completed practice.

## Technical foundation

- Next.js 16 application surface running on Vinext and Cloudflare Workers
- Cloudflare D1 for authoritative, versioned demo-session state
- OpenAI Responses API targeting `gpt-5.6-sol`
- Strict, stage-scoped function tools with application-side validation
- Explicit approval receipts bound to actor, arguments, expected versions, expiry, and idempotency key
- Signed, role-scoped, `HttpOnly` session cookies plus same-origin and CSRF controls
- A persisted guardian inbox for independently approved family reminders
- Adapter boundaries for Google Classroom and BAND/iCalendar sources

The AI loop uses low reasoning effort, low verbosity, `store: false`, a four-round tool ceiling, and preserves complete response output items and tool call IDs across continuations. The model can propose and explain; the application remains authoritative for permissions, state transitions, source diffs, math grading, and writes.

## Live Golden Experience

The Golden Experience through guardian publishing is live end to end. After Emily starts a signed demo session, **Build my morning plan** calls `gpt-5.6-sol` through the OpenAI Responses API. The model must use one strict, read-only `get_morning_plan_context` function before returning a structured proposal.

The server—not the model—enforces the authenticated session, student role, same-origin and CSRF checks, fixture allowlist, source version, exact timeline values, and request limits. Each turn records the returned model name, OpenAI response IDs, tool call ID, latency, and token usage in D1 for the judge proof view. API requests use `store: false` and a hashed safety identifier; the OpenAI key never reaches the browser.

The proposal is staged in D1 with a short-lived approval challenge bound to Emily, the exact server-stored plan, and the expected state, source, and plan versions. The browser sends only the action ID and one-time receipt when Emily selects **Approve and save Plan V1**—it cannot submit replacement plan content. A verified approval atomically writes Plan V1, consumes the receipt, advances the authoritative session state, and adds an audit event. Exact retries within the receipt window return the original saved result without creating a second plan.

After Plan V1 is saved, **Check BAND for updates** advances the controlled calendar fixture from source V1 to V2 and records the sole validated difference: check-in moved from 7:30 AM to 7:15 AM. A second live Responses API turn must use the read-only `get_plan_revision_context` tool before explaining that change and proposing an exact 15-minute shift to the morning timeline. The application keeps Plan V1 active until Emily separately approves Plan V2.

Source sync, model generation, proposal staging, and approval are distinct boundaries. If generation fails after source V2 is committed, a retry resumes from `SOURCE_V2_SYNCED` without repeating the sync. Plan V2 approval is bound to the exact server-stored revision and source V2; the atomic D1 write activates Plan V2 while retaining Plan V1 as immutable history.

Once Plan V2 is active, **Start Algebra refresher** opens a live, hint-led exercise for `3(x + 2) = 18`. GPT-5.6 Sol must use the read-only `get_practice_exercise` tool and return one structured Socratic prompt about inverse operations. The tool context deliberately excludes the intermediate equation and final answer, and application validation rejects any model output that reveals either one.

Emily chooses the first transformation and enters the final value herself. Both responses are graded by deterministic Homeroom code—not by the model. The server reveals `x + 2 = 6` only after the first operation is verified, refuses out-of-order completion, keeps incorrect-answer responses answer-free, and advances the authoritative session only after the final value is correct. D1 stores the private practice result, validated steps, attempts, hint count, completion timestamp, and one audit event.

After practice, **Preview for Matt** builds a deterministic, server-owned guardian projection from an explicit allowlist. The preview contains the band-camp schedule, saved Plan V2 times, the fact that one Algebra I refresher was completed, and Matt's physical-form task. It deliberately excludes Emily's answer, step-by-step work, attempt count, hint count, and private coaching. No model writes or summarizes the guardian view, and the browser cannot submit replacement projection content.

Emily sees the exact guardian view and a visible **Not shared yet** boundary before any publish occurs. **Approve and share with Matt** sends only an action ID and one-time receipt. The server revalidates the stored projection and its SHA-256 hash, then atomically saves projection V1, consumes the approval, advances the session to `GUARDIAN_PUBLISHED`, and records `GUARDIAN_SUMMARY_PUBLISHED` audit evidence. The successful response returns that same stored view so Emily can confirm exactly what was shared.

Finally, **Open judge proof** advances the demo to `COMPLETE` and assembles a privacy-safe evidence ledger from D1. It shows the six authoritative transitions, three completed GPT-5.6 Sol traces, allowlisted source manifest, approval/hash evidence, and an integrity hash. The query layer extracts only approved audit fields and model metadata; raw model output, answers, worked steps, attempt counts, and hint counts never enter the proof response. Reopening the completed proof is idempotent and does not add another state transition or audit event.

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
