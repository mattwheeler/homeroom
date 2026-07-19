import { env } from "cloudflare:workers";

import { connectBandCalendar } from "../../../../../lib/domain/source-connections";
import { handleBandCalendarConnection } from "../../../../../lib/http/source-handler";
import { D1FixedWindowRateLimiter } from "../../../../../lib/security/rate-limit";
import { D1SessionStore } from "../../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../../lib/storage/source-connection-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 5, windowMs: 60_000, namespace: "band-connect" });

export async function POST(request: Request) {
  if (
    !env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.SOURCE_TOKEN_ENCRYPTION_KEY || env.SOURCE_TOKEN_ENCRYPTION_KEY.length < 32
  ) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "BAND calendar is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
  return handleBandCalendarConnection(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    connect: (session, input) => connectBandCalendar({
      session,
      ...input,
      store: sources,
      sourceEncryptionSecret: env.SOURCE_TOKEN_ENCRYPTION_KEY!
    })
  });
}
