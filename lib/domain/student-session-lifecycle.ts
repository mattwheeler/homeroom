import { HOMEROOM_SEED_KEY } from "./fixtures";
import { createProductSession } from "./product-session";
import type { VerifiedIdentity } from "../security/identity-token";
import { verifySessionToken } from "../security/session-token";
import type { PrincipalResolver } from "../storage/principal-store";
import type { ReusableSessionStore, SessionRecord } from "../storage/session-store";

export interface StudentSessionLifecycleDependencies {
  store: ReusableSessionStore;
  signingSecret: string;
  identity: VerifiedIdentity;
  principalResolver: PrincipalResolver;
  now?: () => Date;
  randomUUID?: () => string;
  randomBytes?: () => Uint8Array;
}

export interface EstablishedStudentSession {
  reused: boolean;
  sessionToken: string;
  csrfToken: string;
  session: SessionRecord;
  profile: { name: string; grade: number };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function randomCsrfBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identityMatches(session: SessionRecord, identity: VerifiedIdentity): boolean {
  return session.role === "student" &&
    session.identityProvider === identity.provider &&
    session.identitySubject === identity.subject &&
    session.identityEmail?.trim().toLowerCase() === identity.email.trim().toLowerCase();
}

async function reusableSession(
  token: string | null,
  dependencies: StudentSessionLifecycleDependencies,
  now: Date
): Promise<{ token: string; session: SessionRecord } | null> {
  if (!token) return null;
  try {
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") return null;
    const session = await dependencies.store.findById(payload.sessionId);
    if (!session || Date.parse(session.expiresAt) < now.getTime()) return null;
    if (!identityMatches(session, dependencies.identity)) return null;
    return { token, session };
  } catch {
    return null;
  }
}

export async function establishStudentSession(
  existingSessionToken: string | null,
  dependencies: StudentSessionLifecycleDependencies
): Promise<EstablishedStudentSession> {
  if (dependencies.identity.role !== "student") {
    throw new Error("The verified identity is not linked to the student workspace.");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const reusable = await reusableSession(existingSessionToken, dependencies, now);
  if (reusable) {
    const csrfToken = base64Url(dependencies.randomBytes?.() ?? randomCsrfBytes());
    const updatedAt = now.toISOString();
    await dependencies.store.updateCsrfHash(reusable.session.id, await sha256Hex(csrfToken), updatedAt);
    return {
      reused: true,
      sessionToken: reusable.token,
      csrfToken,
      session: { ...reusable.session, csrfHash: await sha256Hex(csrfToken), updatedAt },
      profile: { name: "Emily", grade: 9 }
    };
  }

  const created = await createProductSession(
    { fixtureKey: HOMEROOM_SEED_KEY, role: "student" },
    {
      store: dependencies.store,
      signingSecret: dependencies.signingSecret,
      identity: dependencies.identity,
      principalResolver: dependencies.principalResolver,
      now: () => now,
      randomUUID: dependencies.randomUUID,
      randomBytes: dependencies.randomBytes
    }
  );
  const session = await dependencies.store.findById(created.sessionId);
  if (!session || !identityMatches(session, dependencies.identity)) {
    throw new Error("The student session could not be verified after creation.");
  }
  return {
    reused: false,
    sessionToken: created.sessionToken,
    csrfToken: created.csrfToken,
    session,
    profile: created.profile
  };
}
