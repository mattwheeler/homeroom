import { describe, expect, it } from "vitest";

import { handleCreateDemoSession } from "../lib/http/demo-session-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";

class CapturingStore implements SessionStore {
  record: SessionRecord | null = null;

  async create(record: SessionRecord) {
    this.record = record;
  }

  async findById() {
    return this.record;
  }
}

const allow: RateLimiter = { consume: () => true };

function request(body: unknown, origin = "https://homeroom.example") {
  return new Request("https://homeroom.example/api/demo-sessions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("demo-session HTTP handler", () => {
  it("returns only browser-safe session data and a hardened cookie", async () => {
    const store = new CapturingStore();
    const response = await handleCreateDemoSession(
      request({ fixtureKey: "emily_band_camp_v1", role: "student" }),
      {
        store,
        signingSecret,
        rateLimiter: allow,
        clientKey: "test-client",
        secureCookie: true,
        now: () => new Date("2026-07-18T12:00:00.000Z"),
        randomUUID: () => "session_01",
        randomBytes: () => Buffer.from("csrf-test-value")
      }
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      sessionId: "session_01",
      csrfToken: expect.any(String),
      phase: "ORIENTATION_READY",
      profile: { name: "Emily", grade: 9 }
    });
    expect(body).not.toHaveProperty("sessionToken");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store.record?.actorId).toBe("student_emily");
  });

  it("rejects cross-origin requests before creating state", async () => {
    const store = new CapturingStore();
    const response = await handleCreateDemoSession(
      request({ fixtureKey: "emily_band_camp_v1", role: "student" }, "https://attacker.example"),
      { store, signingSecret, rateLimiter: allow, clientKey: "test-client", secureCookie: true }
    );
    expect(response.status).toBe(403);
    expect(store.record).toBeNull();
  });

  it("returns a safe validation error and never echoes bad input", async () => {
    const response = await handleCreateDemoSession(
      request({ fixtureKey: "private-school-record", role: "admin" }),
      {
        store: new CapturingStore(),
        signingSecret,
        rateLimiter: allow,
        clientKey: "test-client",
        secureCookie: true
      }
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-school-record");
  });

  it("rate-limits before parsing or writing", async () => {
    const response = await handleCreateDemoSession(
      request({ fixtureKey: "emily_band_camp_v1", role: "student" }),
      {
        store: new CapturingStore(),
        signingSecret,
        rateLimiter: { consume: () => false },
        clientKey: "busy-client",
        secureCookie: true
      }
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("rejects oversized and malformed JSON bodies", async () => {
    const oversized = request({ fixtureKey: "emily_band_camp_v1", role: "student" });
    oversized.headers.set("content-length", "4096");
    await expect(
      handleCreateDemoSession(oversized, {
        store: new CapturingStore(), signingSecret, rateLimiter: allow, clientKey: "test", secureCookie: false
      })
    ).resolves.toMatchObject({ status: 413 });

    const malformed = new Request("https://homeroom.example/api/demo-sessions", {
      method: "POST",
      headers: { origin: "https://homeroom.example", "content-type": "application/json" },
      body: "{"
    });
    await expect(
      handleCreateDemoSession(malformed, {
        store: new CapturingStore(), signingSecret, rateLimiter: allow, clientKey: "test", secureCookie: false
      })
    ).resolves.toMatchObject({ status: 400 });
  });

  it("maps unexpected storage failures to a generic server error", async () => {
    const failingStore: SessionStore = {
      async create() { throw new Error("internal database detail"); },
      async findById() { return null; }
    };
    const response = await handleCreateDemoSession(
      request({ fixtureKey: "emily_band_camp_v1", role: "student" }),
      { store: failingStore, signingSecret, rateLimiter: allow, clientKey: "test", secureCookie: false }
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal database detail");
  });
});
