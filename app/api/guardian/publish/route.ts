import { env } from "cloudflare:workers";

import { approveGuardianProjection } from "../../../../lib/domain/guardian-projection";
import { handleGuardianPublish } from "../../../../lib/http/guardian-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1GuardianProjectionStore } from "../../../../lib/storage/guardian-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 8, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The guardian sharing service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const guardianStore = new D1GuardianProjectionStore(env.HOMEROOM_DB);
  return handleGuardianPublish(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    publish: (session, approval) => approveGuardianProjection({ session, ...approval, store: guardianStore })
  });
}
