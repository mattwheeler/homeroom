import { env } from "cloudflare:workers";

import { stageGuardianPreview, GuardianProjectionError } from "../../../../lib/domain/guardian-projection";
import { algebraExercise } from "../../../../lib/domain/fixtures";
import { handleGuardianPreview } from "../../../../lib/http/guardian-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1GuardianProjectionStore } from "../../../../lib/storage/guardian-store";
import { D1PlanApprovalStore } from "../../../../lib/storage/plan-store";
import { D1PracticeStore } from "../../../../lib/storage/practice-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 6, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The guardian preview service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const planStore = new D1PlanApprovalStore(env.HOMEROOM_DB);
  const practiceStore = new D1PracticeStore(env.HOMEROOM_DB);
  const guardianStore = new D1GuardianProjectionStore(env.HOMEROOM_DB);
  return handleGuardianPreview(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    preview: async (session) => {
      const [plan, practice] = await Promise.all([
        planStore.findApprovedPlan(session.id, 2),
        practiceStore.findProgress(session.id, algebraExercise.id)
      ]);
      if (!plan || !practice) {
        throw new GuardianProjectionError(
          "GUARDIAN_CONTEXT_MISMATCH",
          "The approved plan or completed practice record was not found."
        );
      }
      return stageGuardianPreview({ session, plan, practice, store: guardianStore });
    }
  });
}
