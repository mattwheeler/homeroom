import { env } from "cloudflare:workers";

import { generateMorningPlan } from "../../../lib/ai/morning-plan";
import { createOpenAIResponsesClient } from "../../../lib/ai/openai-client";
import { stageLiveDayPlan } from "../../../lib/domain/live-day-plan";
import { buildLivePlanContext } from "../../../lib/domain/live-plan-context";
import { emilyFixture } from "../../../lib/domain/fixtures";
import { emilyStudentSupportProfile } from "../../../lib/domain/student-support-profile";
import { projectStudentSources } from "../../../lib/domain/student-source-projection";
import { handleGeneratePlanUpdate } from "../../../lib/http/plan-update-handler";
import { D1FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../lib/storage/ai-turn-store";
import { D1LiveDayPlanStore } from "../../../lib/storage/live-day-plan-store";
import { D1SchoolSourceStore } from "../../../lib/storage/school-source-store";
import { D1SessionStore } from "../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../lib/storage/source-connection-store";
import { StructuredLogger } from "../../../lib/observability/logger";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 4, windowMs: 60_000, namespace: "plan-update" });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 || !env.OPENAI_API_KEY) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The live plan-update service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const planStore = new D1LiveDayPlanStore(env.HOMEROOM_DB);
  const traceStore = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleGeneratePlanUpdate(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    logger: new StructuredLogger("plan-update"),
    propose: async (session) => {
      const studentId = session.studentId ?? session.actorId;
      const [snapshot, schoolSnapshot] = await Promise.all([
        new D1SourceConnectionStore(env.HOMEROOM_DB).getStudentSnapshot(studentId),
        new D1SchoolSourceStore(env.HOMEROOM_DB).getStudentSnapshot(studentId)
      ]);
      const projection = projectStudentSources({
        snapshot,
        schoolSnapshot,
        profile: { ...emilyStudentSupportProfile, timeZone: emilyFixture.timeZone, supportPreference: "example_first" },
        now: new Date()
      });
      const liveContext = await buildLivePlanContext(projection, new Date());
      const generated = await generateMorningPlan({ session, client, traceStore, liveContext });
      const staged = await stageLiveDayPlan({
        session,
        plan: generated.plan,
        sourceFingerprint: liveContext.sourceFingerprint,
        store: planStore
      });
      return {
        revision: {
          change: {
            title: "Your live sources were checked again",
            summary: "This proposal uses the latest connected classes, assignments, school dates, and activities.",
            sourceLabel: "Live Classroom + connected calendars"
          },
          plan: generated.plan
        },
        ...staged,
        proof: generated.proof
      };
    }
  });
}
