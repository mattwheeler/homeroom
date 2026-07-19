import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { establishStudentSession } from "../lib/domain/student-session-lifecycle";
import { signSessionToken } from "../lib/security/session-token";
import type { ResolvedPrincipal } from "../lib/storage/principal-store";
import type { ReusableSessionStore } from "../lib/storage/session-store";
import type { SessionRecord } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const studentIdentity = {
  provider: "google" as const,
  subject: "google-student-01",
  email: "emily@example.com",
  role: "student" as const
};
const principal: ResolvedPrincipal = {
  principalId: "principal_emily",
  householdId: "household_wheeler",
  studentId: "student_emily",
  guardianId: "guardian_matt"
};

class MemoryReusableStore implements ReusableSessionStore {
  readonly records = new Map<string, SessionRecord>();
  createCount = 0;
  rotateCount = 0;

  async create(record: SessionRecord) {
    this.createCount += 1;
    this.records.set(record.id, record);
  }

  async findById(id: string) {
    return this.records.get(id) ?? null;
  }

  async updateCsrfHash(id: string, csrfHash: string, updatedAt: string) {
    this.rotateCount += 1;
    const current = this.records.get(id);
    if (!current) throw new Error("missing session");
    this.records.set(id, { ...current, csrfHash, updatedAt });
  }
}

function dependencies(store: MemoryReusableStore) {
  return {
    store,
    signingSecret,
    identity: studentIdentity,
    principalResolver: { resolve: async () => principal },
    now: () => new Date("2026-08-17T14:00:00.000Z"),
    randomUUID: () => "session_new",
    randomBytes: () => Buffer.from("new-csrf-token")
  };
}

describe("authenticated student session lifecycle", () => {
  it("creates a student session bound to the verified identity when none exists", async () => {
    const store = new MemoryReusableStore();
    const result = await establishStudentSession(null, dependencies(store));

    expect(result).toMatchObject({
      reused: false,
      sessionToken: expect.any(String),
      csrfToken: expect.any(String),
      session: {
        id: "session_new",
        role: "student",
        identitySubject: "google-student-01",
        studentId: "student_emily"
      }
    });
    expect(store.createCount).toBe(1);
    expect(store.rotateCount).toBe(0);
  });

  it("reuses the matching unexpired product session and rotates its CSRF secret", async () => {
    const store = new MemoryReusableStore();
    const first = await establishStudentSession(null, dependencies(store));
    const reused = await establishStudentSession(first.sessionToken, {
      ...dependencies(store),
      randomBytes: () => Buffer.from("rotated-csrf-token")
    });

    expect(reused.reused).toBe(true);
    expect(reused.session.id).toBe("session_new");
    expect(reused.sessionToken).toBe(first.sessionToken);
    expect(reused.csrfToken).not.toBe(first.csrfToken);
    expect(store.createCount).toBe(1);
    expect(store.rotateCount).toBe(1);
    expect(store.records.get("session_new")?.csrfHash).toBe(
      createHash("sha256").update(reused.csrfToken).digest("hex")
    );
  });

  it("never reuses a session belonging to a different verified identity", async () => {
    const store = new MemoryReusableStore();
    const now = Date.parse("2026-08-17T14:00:00.000Z");
    const mismatched: SessionRecord = {
      id: "session_other_student",
      fixtureKey: "emily_band_camp_v1",
      actorId: "principal_other",
      role: "student",
      identityProvider: "google",
      identitySubject: "google-other-student",
      identityEmail: "other@example.com",
      state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
      csrfHash: "0".repeat(64),
      expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    store.records.set(mismatched.id, mismatched);
    const mismatchedToken = await signSessionToken(
      { sessionId: mismatched.id, role: "student", expiresAt: now + 60 * 60 * 1000 },
      signingSecret
    );

    const result = await establishStudentSession(mismatchedToken, dependencies(store));

    expect(result.reused).toBe(false);
    expect(result.session.id).toBe("session_new");
    expect(store.rotateCount).toBe(0);
    expect(store.records.get("session_other_student")?.csrfHash).toBe("0".repeat(64));
  });

  it("does not reuse a guardian-role cookie in the student lifecycle", async () => {
    const store = new MemoryReusableStore();
    const now = Date.parse("2026-08-17T14:00:00.000Z");
    const guardianToken = await signSessionToken(
      { sessionId: "guardian_session", role: "guardian", expiresAt: now + 60 * 60 * 1000 },
      signingSecret
    );

    const result = await establishStudentSession(guardianToken, dependencies(store));

    expect(result.reused).toBe(false);
    expect(result.session.role).toBe("student");
    expect(store.rotateCount).toBe(0);
  });
});
