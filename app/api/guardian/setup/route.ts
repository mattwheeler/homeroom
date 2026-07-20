import { env } from "cloudflare:workers";

import {
  buildGuardianWorkspace,
  defaultGuardianSetupSettings
} from "../../../../lib/domain/guardian-setup-profile";
import { buildGuardianProgress } from "../../../../lib/domain/guardian-progress";
import { projectStudentSources } from "../../../../lib/domain/student-source-projection";
import { emilyFixture } from "../../../../lib/domain/fixtures";
import { emilyStudentSupportProfile } from "../../../../lib/domain/student-support-profile";
import { handleGuardianSetup } from "../../../../lib/http/guardian-setup-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1GuardianSetupStore } from "../../../../lib/storage/guardian-setup-store";
import { D1FocusBlockStore } from "../../../../lib/storage/focus-block-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import { D1SchoolSourceStore } from "../../../../lib/storage/school-source-store";
import { D1SourceConnectionStore } from "../../../../lib/storage/source-connection-store";

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Guardian setup is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const guardian = new D1GuardianSetupStore(env.HOMEROOM_DB);
  const school = new D1SchoolSourceStore(env.HOMEROOM_DB);
  const focus = new D1FocusBlockStore(env.HOMEROOM_DB);
  const source = new D1SourceConnectionStore(env.HOMEROOM_DB);
  const sourceStatuses = async (studentId: string) => {
    const [existing, official] = await Promise.all([
      guardian.listSourceStatuses(studentId),
      school.findConnections(studentId)
    ]);
    const latestOfficial = new Map(official.map((source) => [source.provider, source]));
    return [
      ...existing,
      ...[...latestOfficial.values()].map((source) => ({
        provider: source.provider,
        status: source.status,
        displayName: source.displayName,
        lastSyncAt: source.lastSyncAt
      }))
    ];
  };
  const progressFor = async (studentId: string, studentName: string) => {
    const [snapshot, schoolSnapshot, focusBlocks] = await Promise.all([
      source.getStudentSnapshot(studentId),
      school.getStudentSnapshot(studentId),
      focus.listRecent(studentId)
    ]);
    const projection = projectStudentSources({
      snapshot,
      schoolSnapshot,
      profile: {
        ...emilyStudentSupportProfile,
        studentId,
        name: studentName,
        timeZone: emilyFixture.timeZone,
        supportPreference: "example_first"
      },
      now: new Date()
    });
    return buildGuardianProgress({
      student: { id: studentId, name: studentName },
      projection,
      focusBlocks
    });
  };

  return handleGuardianSetup(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 20, windowMs: 60_000, namespace: "guardian-setup" }),
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-guardian",
    read: async (session) => {
      const studentId = session.studentId ?? session.actorId;
      const [stored, sources] = await Promise.all([
        guardian.findSettings(session.actorId, studentId),
        sourceStatuses(studentId)
      ]);
      const resolved = stored ?? { settings: defaultGuardianSetupSettings(), settingsVersion: 0, updatedAt: null };
      const progress = await progressFor(studentId, resolved.settings.profile.name);
      return buildGuardianWorkspace(
        resolved,
        sources,
        { guardianId: session.actorId, studentId },
        progress
      );
    },
    save: async (_session, input) => {
      const stored = await guardian.saveSettings({
        guardianId: _session.actorId,
        studentId: _session.studentId ?? _session.actorId,
        expectedVersion: input.expectedVersion,
        settings: input.settings,
        updatedAt: new Date().toISOString()
      });
      const studentId = _session.studentId ?? _session.actorId;
      const [sources, progress] = await Promise.all([
        sourceStatuses(studentId),
        progressFor(studentId, stored.settings.profile.name)
      ]);
      return buildGuardianWorkspace(stored, sources, {
        guardianId: _session.actorId,
        studentId
      }, progress);
    }
  });
}
