import { env } from "cloudflare:workers";

import { generateMorningPlan } from "../../../lib/ai/morning-plan";
import { createOpenAIResponsesClient } from "../../../lib/ai/openai-client";
import { handleGenerateMorningPlan } from "../../../lib/http/morning-plan-handler";
import { FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../lib/storage/ai-turn-store";
import { D1SessionStore } from "../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 4, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 || !env.OPENAI_API_KEY) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The live plan service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const traceStore = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleGenerateMorningPlan(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    generate: (session) => generateMorningPlan({ session, client, traceStore })
  });
}
