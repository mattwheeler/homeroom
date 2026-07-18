import { env } from "cloudflare:workers";

import { generatePlanRevision } from "../../../lib/ai/plan-revision";
import { createOpenAIResponsesClient } from "../../../lib/ai/openai-client";
import { preparePlanV2Proposal } from "../../../lib/domain/plan-v2";
import { handleGeneratePlanUpdate } from "../../../lib/http/plan-update-handler";
import { FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../lib/storage/ai-turn-store";
import { D1PlanApprovalStore } from "../../../lib/storage/plan-store";
import { D1SessionStore } from "../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 4, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 || !env.OPENAI_API_KEY) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The live plan-update service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const planStore = new D1PlanApprovalStore(env.HOMEROOM_DB);
  const traceStore = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleGeneratePlanUpdate(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    propose: (session) => preparePlanV2Proposal({
      session,
      store: planStore,
      generate: (syncedSession, currentPlan) => generatePlanRevision({
        session: syncedSession,
        currentPlan,
        client,
        traceStore
      })
    })
  });
}
