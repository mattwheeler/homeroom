import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleOpenProof } from "../lib/http/proof-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "proof-test-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-proof";
const expiresAt = Date.parse("2026-07-18T16:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T12:15:00.000Z");

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01", fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt", role,
    state: { phase: "GUARDIAN_PUBLISHED", stateVersion: 14, sourceVersion: 2, activePlanVersion: 2 },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T12:00:00.000Z", updatedAt: "2026-07-18T12:14:00.000Z"
  };
}

class MemorySessionStore implements SessionStore {
  constructor(private readonly value: SessionRecord | null) {}
  async create() {}
  async findById() { return this.value; }
}

async function request(body = "{}", options: {
  role?: "student" | "guardian";
  csrf?: string;
  origin?: string;
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
  return new Request("https://homeroom.example/api/proof/open", { method: "POST", headers, body });
}

describe("proof HTTP handler", () => {
  it("opens proof only for Emily's authenticated session", async () => {
    const open = vi.fn().mockResolvedValue({ headline: "Golden Experience verified" });
    const response = await handleOpenProof(await request(), {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, open
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(open).toHaveBeenCalledWith(session());
  });

  it("rejects missing auth, guardian role, cross-origin, CSRF, extra input, and rate limits", async () => {
    const open = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now, open };
    await expect(handleOpenProof(await request("{}", { includeCookie: false }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleOpenProof(await request("{}", { role: "guardian" }), {
      ...base, store: new MemorySessionStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleOpenProof(await request("{}", { origin: "https://attacker.example" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleOpenProof(await request("{}", { csrf: "wrong" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleOpenProof(await request('{"includePrivateWork":true}'), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 400 });
    await expect(handleOpenProof(await request(), {
      ...base, store: new MemorySessionStore(session()), rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(open).not.toHaveBeenCalled();
  });
});
