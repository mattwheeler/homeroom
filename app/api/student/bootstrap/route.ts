import { env } from "cloudflare:workers";

import { emilyFixture } from "../../../../lib/domain/fixtures";
import { projectStudentSources } from "../../../../lib/domain/student-source-projection";
import { emilyStudentSupportProfile } from "../../../../lib/domain/student-support-profile";
import { handleStudentBootstrap } from "../../../../lib/http/student-bootstrap-handler";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { readCookie } from "../../../../lib/security/http";
import { verifyIdentityToken, type VerifiedIdentity } from "../../../../lib/security/identity-token";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import {
  D1ExistingHouseholdPrincipalResolver,
  D1PrincipalStore,
  type HouseholdBootstrap
} from "../../../../lib/storage/principal-store";
import { D1SchoolSourceStore } from "../../../../lib/storage/school-source-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../lib/storage/source-connection-store";
import { D1StudentSafetyPolicyStore } from "../../../../lib/storage/student-safety-policy-store";

function emails(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The student workspace is not configured yet." } },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  }
  const guardianEmail = emails(env.AUTH_GUARDIAN_EMAILS)[0];
  const studentEmail = emails(env.AUTH_STUDENT_EMAILS)[0];
  if (!guardianEmail || !studentEmail) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The Homeroom household is not configured yet." } },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  }

  let identity: VerifiedIdentity | undefined;
  const identityToken = readCookie(request, "homeroom_identity");
  if (identityToken) {
    try {
      identity = await verifyIdentityToken(identityToken, env.SESSION_SIGNING_SECRET, Date.now());
    } catch {
      identity = undefined;
    }
  }
  if (
    identity?.role === "student" &&
    !emails(env.AUTH_STUDENT_EMAILS).includes(identity.email.trim().toLowerCase())
  ) {
    identity = undefined;
  }

  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
  const schoolSources = new D1SchoolSourceStore(env.HOMEROOM_DB);
  const safetyPolicies = new D1StudentSafetyPolicyStore(env.HOMEROOM_DB);
  const url = new URL(request.url);
  const household: HouseholdBootstrap = {
    guardianEmail,
    studentEmail,
    guardianName: "Matt",
    studentName: "Emily",
    householdName: "Wheeler family"
  };
  return handleStudentBootstrap(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    identity,
    principalResolver: identity?.provider === "judge"
      ? new D1ExistingHouseholdPrincipalResolver(household)
      : new D1PrincipalStore(env.HOMEROOM_DB, household),
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, {
      limit: 12,
      windowMs: 60_000,
      namespace: "student-bootstrap"
    }),
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-student",
    secureCookie: url.protocol === "https:",
    logger: new StructuredLogger("student-bootstrap"),
    projection: async (session, now) => {
      const studentId = session.studentId ?? session.actorId;
      const [snapshot, schoolSnapshot, externalLinkPolicy] = await Promise.all([
        sources.getStudentSnapshot(studentId),
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
