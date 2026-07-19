import { z } from "zod";

import { HOMEROOM_SEED_KEY, emilyFixture, mattFixture } from "./fixtures";
import { createGoldenDemoSessionState } from "./state-machine";
import { signSessionToken, type SessionRole } from "../security/session-token";
import type { SessionRecord, SessionStore } from "../storage/session-store";
import type { VerifiedIdentity } from "../security/identity-token";
import type { PrincipalResolver } from "../storage/principal-store";

const productSessionRequest = z
  .object({
    fixtureKey: z.literal(HOMEROOM_SEED_KEY),
    role: z.enum(["student", "guardian"])
  })
  .strict();

export interface ProductSessionDependencies {
  store: SessionStore;
  signingSecret: string;
  now?: () => Date;
  randomUUID?: () => string;
  randomBytes?: () => Uint8Array;
  identity?: VerifiedIdentity;
  principalResolver?: PrincipalResolver;
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

function actorIdFor(role: SessionRole): string {
  return role === "student" ? emilyFixture.id : mattFixture.id;
}

export async function createProductSession(input: unknown, dependencies: ProductSessionDependencies) {
  const request = productSessionRequest.parse(input);
  if (dependencies.identity && dependencies.identity.role !== request.role) {
    throw new Error("The verified identity does not match the requested workspace.");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const sessionId = dependencies.randomUUID?.() ?? crypto.randomUUID();
  const csrfToken = base64Url(dependencies.randomBytes?.() ?? randomCsrfBytes());
  const expiresAtMs = now.getTime() + 2 * 60 * 60 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  // Guardian setup is part of the fixture contract, so the student workspace
  // begins at the first student-controlled action rather than replaying setup.
  const state = createGoldenDemoSessionState();
  const principal = dependencies.identity && dependencies.principalResolver
    ? await dependencies.principalResolver.resolve(dependencies.identity)
    : null;
  const record: SessionRecord = {
    id: sessionId,
    fixtureKey: request.fixtureKey,
    actorId: principal?.principalId ?? actorIdFor(request.role),
    ...(principal ? {
      principalId: principal.principalId,
      householdId: principal.householdId,
      studentId: principal.studentId,
      ...(principal.guardianId ? { guardianId: principal.guardianId } : {})
    } : {}),
    role: request.role,
    ...(dependencies.identity ? {
      identityProvider: dependencies.identity.provider,
      identitySubject: dependencies.identity.subject,
      identityEmail: dependencies.identity.email
    } : {}),
    state,
    csrfHash: await sha256Hex(csrfToken),
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const sessionToken = await signSessionToken(
    { sessionId, role: request.role, expiresAt: expiresAtMs },
    dependencies.signingSecret
  );
  await dependencies.store.create(record);
  return {
    sessionId,
    sessionToken,
    csrfToken,
    expiresAt,
    phase: state.phase,
    profile: { name: emilyFixture.name, grade: emilyFixture.grade }
  };
}
