import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { FamilyReminderError } from "../lib/domain/family-reminder";
import {
  handlePreviewFamilyReminder,
  handleSendFamilyReminder
} from "../lib/http/family-reminder-handler";
import { ApprovalError } from "../lib/security/approval";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-family-reminder";
const expiresAt = Date.parse("2026-07-18T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T12:13:00.000Z");

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: {
      phase: "ORIENTATION_READY",
      stateVersion: 5,
      sourceVersion: 1,
      activePlanVersion: null
    },
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
  cookie?: string;
} = {}) {
  const role = options.role ?? "student";
  const token = await signSessionToken({ sessionId: "session_01", role, expiresAt }, signingSecret);
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://homeroom.example",
    "content-type": "application/json",
    "x-homeroom-csrf": options.csrf ?? csrfToken
  };
  if (options.includeCookie !== false) {
    headers.cookie = `homeroom_session=${encodeURIComponent(options.cookie ?? token)}`;
  }
  return new Request(`https://homeroom.example${path}`, { method: "POST", headers, body });
}

describe("Family reminder HTTP handlers", () => {
  it("previews the exact reminder for Emily without requiring a plan", async () => {
    const preview = vi.fn().mockResolvedValue({
      preview: { title: "Band physical form needs your help" },
      proof: { independentTrack: "family", stateUnchanged: true }
    });
    const record = session();
    const response = await handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}"),
      {
        store: new MemorySessionStore(record),
        signingSecret,
        rateLimiter: allow,
        clientKey: "test",
        now,
        preview
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      preview: { title: "Band physical form needs your help" },
      proof: { independentTrack: "family", stateUnchanged: true }
    });
    expect(preview).toHaveBeenCalledWith(record);
  });

  it("sends only the staged action ID and one-time receipt", async () => {
    const send = vi.fn().mockResolvedValue({
      sent: true,
      channel: "Homeroom guardian inbox",
      recipient: "Matt"
    });
    const record = session();
    const approval = {
      actionId: "action_123456789012345678901234",
      receipt: "family-reminder-receipt-long-enough"
    };
    const response = await handleSendFamilyReminder(
      await request("/api/family/reminder/send", JSON.stringify(approval)),
      {
        store: new MemorySessionStore(record),
        signingSecret,
        rateLimiter: allow,
        clientKey: "test",
        now,
        send
      }
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(record, approval);
  });

  it("rejects missing auth, guardian role, cross-origin, CSRF, extra input, and rate limits", async () => {
    const preview = vi.fn();
    const base = { signingSecret, rateLimiter: allow, clientKey: "test", now, preview };

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}", { includeCookie: false }),
      { ...base, store: new MemorySessionStore(session()) }
    )).resolves.toMatchObject({ status: 401 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}", { role: "guardian" }),
      { ...base, store: new MemorySessionStore(session("guardian")) }
    )).resolves.toMatchObject({ status: 403 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}", { origin: "https://attacker.example" }),
      { ...base, store: new MemorySessionStore(session()) }
    )).resolves.toMatchObject({ status: 403 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}", { csrf: "wrong" }),
      { ...base, store: new MemorySessionStore(session()) }
    )).resolves.toMatchObject({ status: 403 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{\"includePrivateWork\":true}"),
      { ...base, store: new MemorySessionStore(session()) }
    )).resolves.toMatchObject({ status: 400 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}"),
      { ...base, store: new MemorySessionStore(session()), rateLimiter: { consume: () => false } }
    )).resolves.toMatchObject({ status: 429 });

    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects browser-supplied reminder content", async () => {
    const send = vi.fn();
    const response = await handleSendFamilyReminder(
      await request("/api/family/reminder/send", JSON.stringify({
        actionId: "action_123456789012345678901234",
        receipt: "family-reminder-receipt-long-enough",
        reminder: { message: "Send a different message" }
      })),
      {
        store: new MemorySessionStore(session()),
        signingSecret,
        rateLimiter: allow,
        clientKey: "test",
        now,
        send
      }
    );

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed, unsupported, oversized, expired, and missing sessions", async () => {
    const preview = vi.fn();
    const dependencies = {
      store: new MemorySessionStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test",
      now,
      preview
    };

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{"),
      dependencies
    )).resolves.toMatchObject({ status: 400 });

    const unsupported = new Request("https://homeroom.example/api/family/reminder/preview", {
      method: "POST",
      headers: { origin: "https://homeroom.example", "content-type": "text/plain" },
      body: "{}"
    });
    await expect(handlePreviewFamilyReminder(unsupported, dependencies))
      .resolves.toMatchObject({ status: 415 });

    const oversized = new Request("https://homeroom.example/api/family/reminder/preview", {
      method: "POST",
      headers: {
        origin: "https://homeroom.example",
        "content-type": "application/json",
        "content-length": "1025"
      },
      body: "{}"
    });
    await expect(handlePreviewFamilyReminder(oversized, dependencies))
      .resolves.toMatchObject({ status: 413 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}", { cookie: "not-a-session-token" }),
      dependencies
    )).resolves.toMatchObject({ status: 401 });

    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}"),
      { ...dependencies, store: new MemorySessionStore(null) }
    )).resolves.toMatchObject({ status: 401 });

    const expiredRecord = { ...session(), expiresAt: "2026-07-18T12:00:00.000Z" };
    await expect(handlePreviewFamilyReminder(
      await request("/api/family/reminder/preview", "{}"),
      { ...dependencies, store: new MemorySessionStore(expiredRecord) }
    )).resolves.toMatchObject({ status: 401 });

    expect(preview).not.toHaveBeenCalled();
  });

  it("maps approval, Family-domain, and unexpected failures without leaking internals", async () => {
    const body = JSON.stringify({
      actionId: "action_123456789012345678901234",
      receipt: "family-reminder-receipt-long-enough"
    });
    const base = {
      store: new MemorySessionStore(session()),
      signingSecret,
      rateLimiter: allow,
      clientKey: "test",
      now
    };

    const invalidReceipt = await handleSendFamilyReminder(
      await request("/api/family/reminder/send", body),
      { ...base, send: vi.fn().mockRejectedValue(new ApprovalError("INVALID_RECEIPT", "secret detail")) }
    );
    expect(invalidReceipt.status).toBe(403);
    expect(JSON.stringify(await invalidReceipt.json())).not.toContain("secret detail");

    await expect(handleSendFamilyReminder(
      await request("/api/family/reminder/send", body),
      { ...base, send: vi.fn().mockRejectedValue(new ApprovalError("APPROVAL_EXPIRED", "expired")) }
    )).resolves.toMatchObject({ status: 409 });

    await expect(handleSendFamilyReminder(
      await request("/api/family/reminder/send", body),
      { ...base, send: vi.fn().mockRejectedValue(new FamilyReminderError("FAMILY_APPROVAL_NOT_FOUND", "private")) }
    )).resolves.toMatchObject({ status: 409 });

    const unexpected = await handleSendFamilyReminder(
      await request("/api/family/reminder/send", body),
      { ...base, send: vi.fn().mockRejectedValue(new Error("database internals")) }
    );
    expect(unexpected.status).toBe(500);
    expect(JSON.stringify(await unexpected.json())).not.toContain("database internals");
  });
});
