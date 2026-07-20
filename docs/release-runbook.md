# Homeroom release runbook

Target: `https://homeroom-build-week.riseuplabs-homeroom.workers.dev`

## 1. Preflight

```bash
npm ci
npm run verify:release
git status --short
git diff --check
```

Confirm that no `.dev.vars`, OAuth code, private calendar URL, cookie, API key, or student data is staged.

## 2. Database

List and apply remote migrations:

```bash
npx wrangler d1 migrations list homeroom-build-week --remote
npx wrangler d1 migrations apply homeroom-build-week --remote
```

The current release requires `0011_reviewer_identity_provider.sql`.

## 3. Required Worker secrets

```text
SESSION_SIGNING_SECRET
SOURCE_TOKEN_ENCRYPTION_KEY
OPENAI_API_KEY
GOOGLE_CLASSROOM_CLIENT_ID
GOOGLE_CLASSROOM_CLIENT_SECRET
GOOGLE_CLASSROOM_REDIRECT_URI
GOOGLE_IDENTITY_REDIRECT_URI
AUTH_GUARDIAN_EMAILS
AUTH_STUDENT_EMAILS
RESEND_API_KEY
GUARDIAN_DIGEST_FROM
CRON_SECRET
JUDGE_ACCESS_CODE
```

`JUDGE_ACCESS_CODE` must be a unique random value of at least 24 characters. Put it only in Devpost's private judge instructions—not in the repository, video, screenshots, or public project story.

## 4. Deploy

Build, then stamp the deployed commit into health output:

```bash
npm run build
npx wrangler deploy --var HOMEROOM_RELEASE_SHA:$(git rev-parse HEAD)
```

## 5. Automated deployed checks

```bash
curl -fsS https://homeroom-build-week.riseuplabs-homeroom.workers.dev/api/health
curl -sSI https://homeroom-build-week.riseuplabs-homeroom.workers.dev/ | sed -n '1,30p'
```

Confirm health returns `status: ok`, `database: ready`, and the deployed commit. Confirm root responses include CSP, HSTS, COOP, CORP, Referrer-Policy, Permissions-Policy, nosniff, and frame denial.

## 6. Identity and product smoke

In a clean browser profile:

1. enter the private judge code and open Emily;
2. confirm Today, Calendar, Classes, Supplies, and Learn load;
3. complete and save one focus session, then reopen it from activity history;
4. send one explicit family-help note;
5. switch through the root page, enter the code again, and open Matt;
6. confirm the note is in the family inbox and acknowledge it;
7. confirm guardian progress does not reveal Emily's private AI dialogue or answers;
8. preview the weekly digest;
9. test both allowlisted Google identities separately; and
10. refresh Classroom and the connected calendars once.

## 7. Scheduled digest

Trigger the authenticated digest route from an authorized shell or Cloudflare scheduled-event test, then verify the Worker log and Resend delivery event. Never paste `CRON_SECRET` into a browser URL or repository command history.

## 8. Rollback

Cloudflare deployment versions provide code rollback. D1 migrations are forward-only: do not delete release data or reverse a migration during judging. If a release fails, roll back the Worker version and leave the additive schema in place.

## 9. Freeze evidence

Record the commit SHA, Worker version, health JSON, migration list, verification output, deployed smoke result, video URL, Devpost preview, and final submission timestamp in the release audit.
