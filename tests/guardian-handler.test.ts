import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  handleGuardianPreview,
  handleGuardianPublish
} from "../lib/http/guardian-handler";
import { GuardianProjectionError } from "../lib/domain/guardian-projection";
import { ApprovalError } from "../lib/security/approval";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-guardian";
const expiresAt = Date.parse("2026-07-18T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T12:13:00.000Z");

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "PRACTICE_COMPLETE", stateVersion: 12, sourceVersion: 2, activePlanVersion: 2 },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:12:00.000Z"
  };
}

class MemorySessionStore implements SessionStore {
  constructor(private readonly value: SessionRecord | null) {}
  async create() {}
  async findById() { return this.value; }
}

async function request(path: string, body: string, options: {
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
  return new Request(`https://homeroom.example${path}`, { method: "POST", headers, body });
}

describe("guardian preview and publish HTTP handlers", () => {
  it("previews only for Emily's authenticated session", async () => {
    const preview = vi.fn().mockResolvedValue({ preview: { recipient: { name: "Matt" } } });
    const response = await handleGuardianPreview(await request("/api/guardian/preview", "{}"), {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, preview
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ preview: { recipient: { name: "Matt" } } });
    expect(preview).toHaveBeenCalledWith(session());
  });

  it("publishes using only an action ID and one-time receipt", async () => {
    const publish = vi.fn().mockResolvedValue({ published: true, recipient: "Matt" });
    const body = JSON.stringify({
      actionId: "action_123456789012345678901234",
      receipt: "guardian-receipt-value-long-enough"
    });
    const response = await handleGuardianPublish(await request("/api/guardian/publish", body), {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, publish
    });

    expect(response.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(session(), {
      actionId: "action_123456789012345678901234",
      receipt: "guardian-receipt-value-long-enough"
    });
  });

  it("rejects missing auth, guardian role, cross-origin, CSRF, extra input, and rate limits", async () => {
    const preview = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now, preview };
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}", { includeCookie: false }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}", { role: "guardian" }), {
      ...base, store: new MemorySessionStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}", { origin: "https://attacker.example" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}", { csrf: "wrong" }), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{\"includePrivateWork\":true}"), {
      ...base, store: new MemorySessionStore(session())
    })).resolves.toMatchObject({ status: 400 });
    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}"), {
      ...base, store: new MemorySessionStore(session()), rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects projection content submitted by the browser", async () => {
    const publish = vi.fn();
    const body = JSON.stringify({
      actionId: "action_123456789012345678901234",
      receipt: "guardian-receipt-value-long-enough",
      projection: { practice: { answer: "4" } }
    });
    const response = await handleGuardianPublish(await request("/api/guardian/publish", body), {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, publish
    });

    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, unsupported media, oversized bodies, and missing sessions", async () => {
    const preview = vi.fn();
    const dependencies = {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now, preview
    };
    const malformed = await request("/api/guardian/preview", "{");
    await expect(handleGuardianPreview(malformed, dependencies)).resolves.toMatchObject({ status: 400 });

    const unsupported = new Request("https://homeroom.example/api/guardian/preview", {
      method: "POST",
      headers: { origin: "https://homeroom.example", "content-type": "text/plain" },
      body: "{}"
    });
    await expect(handleGuardianPreview(unsupported, dependencies)).resolves.toMatchObject({ status: 415 });

    const oversized = new Request("https://homeroom.example/api/guardian/preview", {
      method: "POST",
      headers: {
        origin: "https://homeroom.example",
        "content-type": "application/json",
        "content-length": "1025"
      },
      body: "{}"
    });
    await expect(handleGuardianPreview(oversized, dependencies)).resolves.toMatchObject({ status: 413 });

    await expect(handleGuardianPreview(await request("/api/guardian/preview", "{}"), {
      ...dependencies, store: new MemorySessionStore(null)
    })).resolves.toMatchObject({ status: 401 });
    expect(preview).not.toHaveBeenCalled();
  });

  it("maps approval, guardian-domain, and unexpected failures without leaking internals", async () => {
    const body = JSON.stringify({
      actionId: "action_123456789012345678901234",
      receipt: "guardian-receipt-value-long-enough"
    });
    const base = {
      store: new MemorySessionStore(session()), signingSecret, rateLimiter: allow,
      clientKey: "test", now
    };

    const invalidReceipt = await handleGuardianPublish(await request("/api/guardian/publish", body), {
      ...base,
      publish: vi.fn().mockRejectedValue(new ApprovalError("INVALID_RECEIPT", "secret detail"))
    });
    expect(invalidReceipt.status).toBe(403);
    expect(JSON.stringify(await invalidReceipt.json())).not.toContain("secret detail");

    await expect(handleGuardianPublish(await request("/api/guardian/publish", body), {
      ...base,
      publish: vi.fn().mockRejectedValue(new ApprovalError("APPROVAL_EXPIRED", "expired"))
    })).resolves.toMatchObject({ status: 409 });

    await expect(handleGuardianPublish(await request("/api/guardian/publish", body), {
      ...base,
      publish: vi.fn().mockRejectedValue(new GuardianProjectionError("GUARDIAN_CONTEXT_MISMATCH", "private"))
    })).resolves.toMatchObject({ status: 409 });

    await expect(handleGuardianPublish(await request("/api/guardian/publish", body), {
      ...base,
      publish: vi.fn().mockRejectedValue(new Error("database internals"))
    })).resolves.toMatchObject({ status: 500 });
  });
});
