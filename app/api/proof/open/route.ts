import { env } from "cloudflare:workers";

import { openJudgeProof } from "../../../../lib/domain/proof-view";
import { handleOpenProof } from "../../../../lib/http/proof-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1ProofStore } from "../../../../lib/storage/proof-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 8, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The judge proof service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const proofStore = new D1ProofStore(env.HOMEROOM_DB);
  return handleOpenProof(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    open: (session) => openJudgeProof({ session, store: proofStore })
  });
}
