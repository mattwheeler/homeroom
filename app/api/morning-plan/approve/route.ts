import { env } from "cloudflare:workers";

import { approvePlanV1 } from "../../../../lib/domain/plan-approval";
import { handleApprovePlanV1 } from "../../../../lib/http/plan-approval-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1PlanApprovalStore } from "../../../../lib/storage/plan-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 8, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The plan approval service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const planStore = new D1PlanApprovalStore(env.HOMEROOM_DB);
  return handleApprovePlanV1(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    approve: (session, approval) => approvePlanV1({ session, ...approval, store: planStore })
  });
}
