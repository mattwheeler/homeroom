# OpenAI Build Week submission runbook

Use this page for the final Devpost review. It reflects the live submission form and organizer guidance fetched on 2026-07-20.

## Deadline

- Devpost closes edits at **Tuesday, July 21, 2026 at 5:00 PM Pacific / 7:00 PM Central**.
- The project is currently an editable submission draft: [Homeroom on Devpost](https://devpost.com/software/homeroom-uk57ep).

## Project fields already current

- **Project name:** Homeroom
- **Elevator pitch:** A student-safe AI workspace that turns school calendars, assignments, and family logistics into a calm daily plan with consent before anything is saved or shared.
- **Project story:** updated to the deployed product and current verification evidence
- **Built with:** TypeScript, React, Next.js, Vinext, Vite, Cloudflare Workers, Cloudflare D1, OpenAI Responses API, GPT-5.6, Codex, Zod, Google Classroom API, Google OAuth, iCalendar, Resend, Vitest, and Playwright
- **Try it:** <https://homeroom-build-week.riseuplabs-homeroom.workers.dev>
- **Code:** <https://github.com/mattwheeler/homeroom>

## Required submission answers

| Devpost field | Answer / owner action |
| --- | --- |
| Submitter Type | **Owner must select:** Individual, Team of Individuals, or Organization. Do not guess; this must match the accepted Devpost team. |
| Country of Residence | United States |
| Category | Education |
| Code repository | <https://github.com/mattwheeler/homeroom> |
| Judge project link and instructions | Use the private instructions below. |
| `/feedback` Session ID | **Owner must retrieve from the primary Codex build task and paste it.** |
| Plugin/dev-tool instructions | Leave blank; Homeroom is an education application, not a plugin or developer tool. |
| Video | **Owner must add a public YouTube URL under three minutes.** |

## Private judge instructions

Paste this in the judges-only testing field, then replace `[PRIVATE REVIEW CODE]` with the Keychain value. Never put that code in the public project story, repository, video, or screenshots.

```text
Open https://homeroom-build-week.riseuplabs-homeroom.workers.dev

Expand “OpenAI Build Week judge access” and enter:
[PRIVATE REVIEW CODE]

Choose Student view for Emily or Guardian view for Matt. The review identity expires after two hours and uses a fictional household with read-only school sources.

Recommended student path:
1. On Today, choose a private check-in or start the recommended assignment.
2. Complete a visible Task Room step, end the session, and confirm it appears in recent work.
3. Review Calendar, Classes, Supplies, and a class-scoped Learning Room.
4. Preview and send a guardian-help note.

Recommended guardian path:
1. Open Family inbox and acknowledge Emily’s note.
2. Review privacy-safe progress, guardian controls, and connected read-only sources.
3. Preview the approved-only weekly digest.

Homeroom never submits, grades, edits, posts, RSVPs, or changes an external school source. Private coaching dialogue and answers are not shown to guardians.
```

Retrieve the private review code locally without displaying it in a recording:

```bash
security find-generic-password -a "$(id -un)" -s homeroom-build-week-judge -w
```

## Organizer requirements confirmed

- Working project built with Codex and GPT-5.6.
- One category.
- Project description.
- Public YouTube demo shorter than three minutes.
- Voiceover must explain the product, how Codex was used, and how GPT-5.6 was used.
- Public repository must have a relevant open-source license.
- README must include setup, sample-data guidance, and Codex/GPT-5.6 usage.
- `/feedback` Session ID from the primary build task.

## Final owner checklist

- [ ] Confirm every teammate is present on Devpost and has accepted the invitation.
- [ ] Choose and add the repository license.
- [ ] Record, upload, and attach the public YouTube video.
- [ ] Add the `/feedback` Session ID.
- [ ] Select the correct submitter type.
- [ ] Add the private review code to the judges-only instructions.
- [ ] Upload a 3:2 thumbnail and selected gallery images.
- [ ] Preview the public project page and test every link in an incognito browser.
- [ ] Submit before the deadline and capture the confirmation.

