import { env } from "cloudflare:workers";

import { emilyFixture } from "../../../../lib/domain/fixtures";
import { projectStudentSources } from "../../../../lib/domain/student-source-projection";
import { emilyStudentSupportProfile } from "../../../../lib/domain/student-support-profile";
import { handleStudentProjection } from "../../../../lib/http/student-projection-handler";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import {
  activeSourceEventWindow,
  D1SourceConnectionStore
} from "../../../../lib/storage/source-connection-store";
import { D1SchoolSourceStore } from "../../../../lib/storage/school-source-store";
import { D1StudentSafetyPolicyStore } from "../../../../lib/storage/student-safety-policy-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 30, windowMs: 60_000, namespace: "student-projection" });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The live student plan is not configured yet." } },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
  const schoolSources = new D1SchoolSourceStore(env.HOMEROOM_DB);
  const safetyPolicies = new D1StudentSafetyPolicyStore(env.HOMEROOM_DB);
  return handleStudentProjection(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    logger: new StructuredLogger("student-projection"),
    projection: async (session, now) => {
      const studentId = session.studentId ?? session.actorId;
      const [snapshot, schoolSnapshot, externalLinkPolicy] = await Promise.all([
        sources.getStudentSnapshot(studentId, activeSourceEventWindow(now)),
        schoolSources.getStudentSnapshot(studentId),
        safetyPolicies.findExternalLinkPolicy(studentId).catch(() => "blocked" as const)
      ]);
      return projectStudentSources({
        snapshot,
        schoolSnapshot,
        externalLinkPolicy: externalLinkPolicy ?? "blocked",
        profile: {
          ...emilyStudentSupportProfile,
          timeZone: emilyFixture.timeZone,
          supportPreference: "example_first"
        },
        now
      });
    }
  });
}
