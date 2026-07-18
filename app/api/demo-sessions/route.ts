import { env } from "cloudflare:workers";

import { handleCreateDemoSession } from "../../../lib/http/demo-session-handler";
import { FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { D1SessionStore } from "../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 8, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The demo is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const clientKey = request.headers.get("cf-connecting-ip") ?? "local-preview";
  return handleCreateDemoSession(request, {
    store: new D1SessionStore(env.HOMEROOM_DB),
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey,
    secureCookie: new URL(request.url).protocol === "https:"
  });
}
