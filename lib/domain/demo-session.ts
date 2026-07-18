import { z } from "zod";

import { HOMEROOM_SEED_KEY, emilyFixture, mattFixture } from "./fixtures";
import { createInitialSessionState } from "./state-machine";
import { signSessionToken, type SessionRole } from "../security/session-token";
import type { SessionRecord, SessionStore } from "../storage/session-store";

const demoSessionRequest = z
  .object({
    fixtureKey: z.literal(HOMEROOM_SEED_KEY),
    role: z.enum(["student", "guardian"])
  })
  .strict();

export interface DemoSessionDependencies {
  store: SessionStore;
  signingSecret: string;
  now?: () => Date;
  randomUUID?: () => string;
  randomBytes?: () => Uint8Array;
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

export async function createDemoSession(input: unknown, dependencies: DemoSessionDependencies) {
  const request = demoSessionRequest.parse(input);
  const now = (dependencies.now ?? (() => new Date()))();
  const sessionId = dependencies.randomUUID?.() ?? crypto.randomUUID();
  const csrfToken = base64Url(dependencies.randomBytes?.() ?? randomCsrfBytes());
  const expiresAtMs = now.getTime() + 2 * 60 * 60 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const state = createInitialSessionState();
  const record: SessionRecord = {
    id: sessionId,
    fixtureKey: request.fixtureKey,
    actorId: actorIdFor(request.role),
    role: request.role,
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
