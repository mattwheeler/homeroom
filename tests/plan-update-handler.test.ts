import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleGeneratePlanUpdate } from "../lib/http/plan-update-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-plan-update";
const expiresAt = Date.parse("2026-07-18T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T12:07:00.000Z");

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:06:00.000Z"
  };
}

class MemoryStore implements SessionStore {
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
} = {}) {
  const role = options.role ?? "student";
  const token = await signSessionToken({ sessionId: "session_01", role, expiresAt }, signingSecret);
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://homeroom.example",
    "content-type": "application/json",
    "x-homeroom-csrf": options.csrf ?? csrfToken
  };
  if (options.includeCookie !== false) headers.cookie = `homeroom_session=${encodeURIComponent(token)}`;
  return new Request("https://homeroom.example/api/plan-update", {
    method: "POST", headers, body: options.body ?? "{}"
  });
}

describe("plan-update HTTP handler", () => {
  it("runs the controlled update only for Emily's authenticated session", async () => {
    const propose = vi.fn().mockResolvedValue({
      revision: { change: { before: "07:30", after: "07:15" } },
      approval: { actionId: "action_2", planVersion: 2 }
    });
    const response = await handleGeneratePlanUpdate(await request(), {
      store: new MemoryStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, propose
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      revision: { change: { before: "07:30", after: "07:15" } },
      approval: { planVersion: 2 }
    });
    expect(propose).toHaveBeenCalledWith(session());
  });

  it("rejects missing auth, guardian role, cross-origin, CSRF, extra input, and rate limits", async () => {
    const propose = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now, propose };
    await expect(handleGeneratePlanUpdate(await request({ includeCookie: false }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleGeneratePlanUpdate(await request({ role: "guardian" }), {
      ...base, store: new MemoryStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGeneratePlanUpdate(await request({ origin: "https://attacker.example" }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGeneratePlanUpdate(await request({ csrf: "wrong" }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGeneratePlanUpdate(await request({ body: '{"targetVersion":99}' }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 400 });
    await expect(handleGeneratePlanUpdate(await request(), {
      ...base, store: new MemoryStore(session()), rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(propose).not.toHaveBeenCalled();
  });

  it("returns a safe retryable response when generation fails after sync", async () => {
    const response = await handleGeneratePlanUpdate(await request(), {
      store: new MemoryStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now,
      propose: vi.fn().mockRejectedValue(new Error("private provider or D1 detail"))
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).not.toContain("private provider or D1 detail");
  });
});
