import { env } from "cloudflare:workers";

import { approveLiveDayPlan } from "../../../../lib/domain/live-day-plan";
import { handleApprovePlanV1 } from "../../../../lib/http/plan-approval-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1LiveDayPlanStore } from "../../../../lib/storage/live-day-plan-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import { StructuredLogger } from "../../../../lib/observability/logger";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 8, windowMs: 60_000, namespace: "morning-plan-approve" });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The plan approval service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const planStore = new D1LiveDayPlanStore(env.HOMEROOM_DB);
  return handleApprovePlanV1(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    logger: new StructuredLogger("morning-plan-approval"),
    approve: (session, approval) => approveLiveDayPlan({ session, ...approval, store: planStore })
  });
}
