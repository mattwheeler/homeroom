import { env } from "cloudflare:workers";

import { submitPracticeAttempt } from "../../../../lib/domain/practice";
import { handlePracticeAttempt } from "../../../../lib/http/practice-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1PracticeStore } from "../../../../lib/storage/practice-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 12, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The practice grader is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const practiceStore = new D1PracticeStore(env.HOMEROOM_DB);
  return handlePracticeAttempt(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    attempt: (session, attempt) => submitPracticeAttempt({ session, attempt, store: practiceStore })
  });
}
