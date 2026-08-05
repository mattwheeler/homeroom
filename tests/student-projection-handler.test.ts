import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleStudentProjection } from "../lib/http/student-projection-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-student-projection";
const expiresAt = Date.parse("2026-08-17T20:00:00.000Z");
const now = () => new Date("2026-08-17T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T13:00:00.000Z"
  };
}

class MemorySessionStore implements SessionStore {
  constructor(private readonly value: SessionRecord | null) {}
  async create() {}
  async findById() { return this.value; }
}

async function request(options: {
  role?: "student" | "guardian";
  csrf?: string;
  origin?: string;
  body?: string;
  includeCookie?: boolean;
  contentType?: string;
} = {}) {
  const role = options.role ?? "student";
  const token = await signSessionToken({ sessionId: "session_01", role, expiresAt }, signingSecret);
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://homeroom.example",
    "content-type": options.contentType ?? "application/json",
    "x-homeroom-csrf": options.csrf ?? csrfToken
  };
  if (options.includeCookie !== false) headers.cookie = `homeroom_session=${encodeURIComponent(token)}`;
  return new Request("https://homeroom.example/api/student/projection", {
    method: "POST",
    headers,
    body: options.body ?? "{}"
  });
}

describe("student source projection HTTP handler", () => {
  it("returns a no-store projection for Emily's authenticated student session", async () => {
    const projection = vi.fn().mockResolvedValue({
      context: { grade: 9 },
      today: { timeline: [] },
      priorities: []
    });
    const response = await handleStudentProjection(await request(), {
      store: new MemorySessionStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test",
      now,
      projection
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ context: { grade: 9 } });
    expect(projection).toHaveBeenCalledWith(session(), now());
  });

  it("rejects missing auth, guardian role, cross-origin, invalid CSRF, extra input, and rate limits", async () => {
    const projection = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now, projection };

    await expect(handleStudentProjection(await request({ includeCookie: false }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleStudentProjection(await request({ role: "guardian" }), {
      ...base, store: new MemorySessionStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleStudentProjection(await request({ origin: "https://attacker.example" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleStudentProjection(await request({ csrf: "wrong" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleStudentProjection(await request({ body: "{\"studentId\":\"student_other\"}" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 400 });
    await expect(handleStudentProjection(await request(), {
      ...base, store: new MemorySessionStore(session()), rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(projection).not.toHaveBeenCalled();
  });

  it("rejects malformed, unsupported, oversized, expired, and missing-session requests", async () => {
    const projection = vi.fn();
    const base = {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, projection
    };
    await expect(handleStudentProjection(await request({ body: "{" }), base))
      .resolves.toMatchObject({ status: 400 });
    await expect(handleStudentProjection(await request({ contentType: "text/plain" }), base))
      .resolves.toMatchObject({ status: 415 });

    const oversized = await request();
    oversized.headers.set("content-length", "1025");
    await expect(handleStudentProjection(oversized, base)).resolves.toMatchObject({ status: 413 });

    const expiredSession = session();
    expiredSession.expiresAt = "2026-08-17T13:59:59.000Z";
    await expect(handleStudentProjection(await request(), {
      ...base, store: new MemorySessionStore(expiredSession)
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleStudentProjection(await request(), {
      ...base, store: new MemorySessionStore(null)
    })).resolves.toMatchObject({ status: 401 });
    expect(projection).not.toHaveBeenCalled();
  });

  it("does not expose projection or storage failures", async () => {
    const logger = { error: vi.fn() };
    const response = await handleStudentProjection(await request(), {
      store: new MemorySessionStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test",
      now,
      logger,
      projection: vi.fn().mockRejectedValue(new Error("D1 secret table internals"))
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(JSON.stringify(await response.json())).not.toContain("D1 secret table internals");
    expect(logger.error).toHaveBeenCalledWith(
      "student_projection_failed",
      expect.any(Error),
      { sessionId: "session_01" }
    );
  });
});
