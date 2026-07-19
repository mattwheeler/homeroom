import { env } from "cloudflare:workers";

import { createGoogleIdentityAuthorization } from "../../../../../lib/auth/google-identity";
import { handleGoogleIdentityStart } from "../../../../../lib/http/google-identity-handler";
import { D1FixedWindowRateLimiter } from "../../../../../lib/security/rate-limit";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 6, windowMs: 60_000, namespace: "identity-start" });

export async function POST(request: Request) {
  if (
    !env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.GOOGLE_CLASSROOM_CLIENT_ID ||
    !env.GOOGLE_IDENTITY_REDIRECT_URI
  ) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Google identity sign-in is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return handleGoogleIdentityStart(request, {
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-identity",
    secureCookie: new URL(request.url).protocol === "https:",
    start: (role) => createGoogleIdentityAuthorization({
      role,
      clientId: env.GOOGLE_CLASSROOM_CLIENT_ID!,
      redirectUri: env.GOOGLE_IDENTITY_REDIRECT_URI!,
      signingSecret: env.SESSION_SIGNING_SECRET!
    })
  });
}
