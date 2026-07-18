import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleApprovePlanV1 } from "../lib/http/plan-approval-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-plan-approval";
const expiresAt = Date.parse("2026-07-18T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "PLAN_PROPOSED", stateVersion: 6, sourceVersion: 1, activePlanVersion: null },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:05:00.000Z"
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
  return new Request("https://homeroom.example/api/morning-plan/approve", {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify({ actionId: "action_123456789012345678901234", receipt: "receipt-value-long-enough" })
  });
}

describe("Plan V1 approval HTTP handler", () => {
  it("authorizes Emily and returns the saved Plan V1 proof", async () => {
    const approve = vi.fn().mockResolvedValue({
      saved: true,
      planVersion: 1,
      phase: "PLAN_V1_SAVED",
      savedAt: "2026-07-18T12:06:00.000Z",
      proof: { approvalId: "action_123456789012345678901234", sourceVersion: 1, stateVersion: 7 }
    });
    const response = await handleApprovePlanV1(await request(), {
      store: new MemoryStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test-client",
      now: () => new Date("2026-07-18T12:06:00.000Z"),
      approve
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ saved: true, planVersion: 1, phase: "PLAN_V1_SAVED" });
    expect(approve).toHaveBeenCalledWith(session(), {
      actionId: "action_123456789012345678901234",
      receipt: "receipt-value-long-enough"
    });
  });

  it("rejects missing auth, guardian role, cross-origin, and invalid CSRF before approval", async () => {
    const approve = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now: () => new Date("2026-07-18T12:06:00.000Z"), approve };
    await expect(handleApprovePlanV1(await request({ includeCookie: false }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleApprovePlanV1(await request({ role: "guardian" }), {
      ...base, store: new MemoryStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleApprovePlanV1(await request({ origin: "https://attacker.example" }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleApprovePlanV1(await request({ csrf: "wrong" }), {
      ...base, store: new MemoryStore(session())
    })).resolves.toMatchObject({ status: 403 });
    expect(approve).not.toHaveBeenCalled();
  });

  it("rejects malformed or extra approval input and rate-limits requests", async () => {
    const approve = vi.fn();
    const base = { store: new MemoryStore(session()), signingSecret, clientKey: "test", approve };
    await expect(handleApprovePlanV1(await request({ body: JSON.stringify({
      actionId: "bad", receipt: "short", plan: { title: "tampered" }
    }) }), { ...base, rateLimiter: allow })).resolves.toMatchObject({ status: 400 });
    await expect(handleApprovePlanV1(await request(), {
      ...base, rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(approve).not.toHaveBeenCalled();
  });

  it("maps expired or stale approvals to a safe conflict response", async () => {
    const response = await handleApprovePlanV1(await request(), {
      store: new MemoryStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test",
      now: () => new Date("2026-07-18T12:06:00.000Z"),
      approve: vi.fn().mockRejectedValue(Object.assign(new Error("internal approval material"), {
        name: "ApprovalError",
        code: "APPROVAL_EXPIRED"
      }))
    });
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("internal approval material");
  });
});
