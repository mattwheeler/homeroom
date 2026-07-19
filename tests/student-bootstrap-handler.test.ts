import { describe, expect, it } from "vitest";

import { handleStudentBootstrap } from "../lib/http/student-bootstrap-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import type { ResolvedPrincipal } from "../lib/storage/principal-store";
import type { ReusableSessionStore, SessionRecord } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const identity = {
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
const allow: RateLimiter = { consume: () => true };

class MemoryStore implements ReusableSessionStore {
  readonly records = new Map<string, SessionRecord>();
  async create(record: SessionRecord) { this.records.set(record.id, record); }
  async findById(id: string) { return this.records.get(id) ?? null; }
  async updateCsrfHash(id: string, csrfHash: string, updatedAt: string) {
    const record = this.records.get(id);
    if (!record) throw new Error("missing");
    this.records.set(id, { ...record, csrfHash, updatedAt });
  }
}

function request(cookie?: string, origin = "https://homeroom.example") {
  return new Request("https://homeroom.example/api/student/bootstrap", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: "{}"
  });
}

function dependencies(store = new MemoryStore()) {
  return {
    store,
    signingSecret,
    identity,
    principalResolver: { resolve: async () => principal },
    rateLimiter: allow,
    clientKey: "student-test",
    secureCookie: true,
    now: () => new Date("2026-08-17T14:00:00.000Z"),
    randomUUID: () => "student_session_01",
    randomBytes: () => Buffer.from("bootstrap-csrf-token"),
    projection: async (session: SessionRecord) => ({
      generatedAt: "2026-08-17T14:00:00.000Z",
      studentId: session.studentId,
      priorities: [{ id: "live-work-01" }]
    })
  };
}

describe("unified authenticated student bootstrap", () => {
  it("issues a hardened product-session cookie, CSRF token, and live projection in one response", async () => {
    const response = await handleStudentBootstrap(request(), dependencies());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      csrfToken: expect.any(String),
      profile: { name: "Emily", grade: 9 },
      session: { reused: false, expiresAt: "2026-08-17T16:00:00.000Z" },
      projection: { studentId: "student_emily", priorities: [{ id: "live-work-01" }] }
    });
    expect(body).not.toHaveProperty("sessionToken");
    expect(response.headers.get("set-cookie")).toContain("homeroom_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("requires a verified student identity and rejects guardian identities", async () => {
    const missing = await handleStudentBootstrap(request(), {
      ...dependencies(),
      identity: undefined
    });
    expect(missing.status).toBe(401);

    const guardian = await handleStudentBootstrap(request(), {
      ...dependencies(),
      identity: { provider: "google", subject: "guardian", email: "matt@example.com", role: "guardian" }
    });
    expect(guardian.status).toBe(403);
  });

  it("fails before state creation for cross-origin and rate-limited requests", async () => {
    const store = new MemoryStore();
    const crossOrigin = await handleStudentBootstrap(
      request(undefined, "https://attacker.example"),
      dependencies(store)
    );
    expect(crossOrigin.status).toBe(403);
    expect(store.records.size).toBe(0);

    const rateLimited = await handleStudentBootstrap(request(), {
      ...dependencies(store),
      rateLimiter: { consume: () => false }
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("30");
    expect(store.records.size).toBe(0);
  });

  it("returns a safe retryable response when live sources fail", async () => {
    const response = await handleStudentBootstrap(request(), {
      ...dependencies(),
      projection: async () => { throw new Error("private upstream detail"); }
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).not.toContain("private upstream detail");
  });
});
