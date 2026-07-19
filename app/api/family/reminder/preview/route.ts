import { env } from "cloudflare:workers";

import { FamilyReminderError, stageFamilyReminder } from "../../../../../lib/domain/family-reminder";
import { emilyFixture } from "../../../../../lib/domain/fixtures";
import { projectStudentSources } from "../../../../../lib/domain/student-source-projection";
import { emilyStudentSupportProfile } from "../../../../../lib/domain/student-support-profile";
import { handlePreviewFamilyReminder } from "../../../../../lib/http/family-reminder-handler";
import { D1FixedWindowRateLimiter } from "../../../../../lib/security/rate-limit";
import { D1FamilyReminderStore } from "../../../../../lib/storage/family-reminder-store";
import { D1SessionStore } from "../../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../../lib/storage/source-connection-store";

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The Family service is not configured." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const reminders = new D1FamilyReminderStore(env.HOMEROOM_DB);
  const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
  return handlePreviewFamilyReminder(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 6, windowMs: 60_000, namespace: "family-preview" }),
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    preview: async (session, body) => {
      const snapshot = await sources.getStudentSnapshot(session.studentId ?? session.actorId);
      const projection = projectStudentSources({
        snapshot,
        profile: {
          ...emilyStudentSupportProfile,
          studentId: session.studentId ?? session.actorId,
          timeZone: emilyFixture.timeZone,
          supportPreference: "example_first"
        }
      });
      const candidate = projection.guardianAssistCandidates?.find((item) => item.taskId === body.taskId);
      if (!candidate) {
        throw new FamilyReminderError("FAMILY_SOURCE_NOT_FOUND", "The connected source no longer supports this guardian request.");
      }
      return stageFamilyReminder({ session, store: reminders, candidate });
    }
  });
}
