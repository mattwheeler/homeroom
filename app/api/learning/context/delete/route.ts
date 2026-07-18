import { env } from "cloudflare:workers";

import { handleDeleteLearnerSignal } from "../../../../../lib/http/learning-handler";
import { FixedWindowRateLimiter } from "../../../../../lib/security/rate-limit";
import { D1LearningStore } from "../../../../../lib/storage/learning-store";
import { D1SessionStore } from "../../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Learner context is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const learning = new D1LearningStore(env.HOMEROOM_DB);
  return handleDeleteLearnerSignal(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    deleteSignal: async (session, input) => {
      await learning.deleteSignal(
        session.actorId,
        input.signalId,
        new Date().toISOString(),
        `memory_${crypto.randomUUID()}`
      );
      return { deleted: true as const, signalId: input.signalId };
    }
  });
}
