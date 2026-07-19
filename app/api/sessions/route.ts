import { env } from "cloudflare:workers";

import { handleCreateSession } from "../../../lib/http/session-handler";
import { D1FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { D1SessionStore } from "../../../lib/storage/session-store";
import { D1PrincipalStore } from "../../../lib/storage/principal-store";
import { readCookie } from "../../../lib/security/http";
import { verifyIdentityToken, type VerifiedIdentity } from "../../../lib/security/identity-token";
import { StructuredLogger } from "../../../lib/observability/logger";

function emails(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Homeroom is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const url = new URL(request.url);
  let identity: VerifiedIdentity | undefined;
  const identityToken = readCookie(request, "homeroom_identity");
  if (identityToken) {
    try {
      identity = await verifyIdentityToken(identityToken, env.SESSION_SIGNING_SECRET, Date.now());
    } catch {
      identity = undefined;
    }
  }
  const clientKey = request.headers.get("cf-connecting-ip") ?? "local-student";
  const guardianEmail = emails(env.AUTH_GUARDIAN_EMAILS)[0];
  const studentEmail = emails(env.AUTH_STUDENT_EMAILS)[0];
  if (!guardianEmail || !studentEmail) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The Homeroom household is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return handleCreateSession(request, {
    store: new D1SessionStore(env.HOMEROOM_DB),
    principalResolver: new D1PrincipalStore(env.HOMEROOM_DB, {
      guardianEmail,
      studentEmail,
      guardianName: "Matt",
      studentName: "Emily",
      householdName: "Wheeler family"
    }),
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, {
      limit: 8,
      windowMs: 60_000,
      namespace: "sessions"
    }),
    clientKey,
    secureCookie: url.protocol === "https:",
    identity,
    requireVerifiedIdentity: true,
    logger: new StructuredLogger("sessions")
  });
}
