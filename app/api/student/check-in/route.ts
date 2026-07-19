import { env } from "cloudflare:workers";

import { generateStudentCheckInResponse } from "../../../../lib/ai/student-check-in-response";
import { createOpenAIResponsesClient } from "../../../../lib/ai/openai-client";
import { emilyFixture } from "../../../../lib/domain/fixtures";
import { projectStudentSources } from "../../../../lib/domain/student-source-projection";
import { emilyStudentSupportProfile } from "../../../../lib/domain/student-support-profile";
import { handleStudentCheckIn } from "../../../../lib/http/student-check-in-handler";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../../lib/storage/ai-turn-store";
import { D1SchoolSourceStore } from "../../../../lib/storage/school-source-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../lib/storage/source-connection-store";
import { D1StudentSafetyPolicyStore } from "../../../../lib/storage/student-safety-policy-store";

export async function POST(request: Request) {
  if (
    !env.SESSION_SIGNING_SECRET ||
    env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.OPENAI_API_KEY
  ) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The student check-in is not configured yet." } },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
  const schoolSources = new D1SchoolSourceStore(env.HOMEROOM_DB);
  const safetyPolicies = new D1StudentSafetyPolicyStore(env.HOMEROOM_DB);
  const traces = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleStudentCheckIn(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, {
      limit: 6,
      windowMs: 60_000,
      namespace: "student-check-in"
    }),
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-student",
    logger: new StructuredLogger("student-check-in"),
    respond: async (session, input) => {
      const studentId = session.studentId ?? session.actorId;
      const [snapshot, schoolSnapshot, externalLinkPolicy] = await Promise.all([
        sources.getStudentSnapshot(studentId),
        schoolSources.getStudentSnapshot(studentId),
        safetyPolicies.findExternalLinkPolicy(studentId).catch(() => "blocked" as const)
      ]);
      const projection = projectStudentSources({
        snapshot,
        schoolSnapshot,
        externalLinkPolicy: externalLinkPolicy ?? "blocked",
        profile: {
          ...emilyStudentSupportProfile,
          timeZone: emilyFixture.timeZone,
          supportPreference: "example_first"
        },
        now: new Date()
      });
      return generateStudentCheckInResponse({
        session,
        projection,
        focusState: input.focusState,
        message: input.message,
        client,
        traceStore: traces
      });
    }
  });
}
