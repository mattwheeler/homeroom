import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticatedSession, AuthenticatedSessionError } from "../lib/http/authenticated-session";
import { sendGuardianDigestEmail } from "../lib/notifications/guardian-digest-email";
import { StructuredLogger } from "../lib/observability/logger";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const secret = "runtime-seam-test-secret-that-is-at-least-thirty-two-characters";
const now = new Date("2026-07-19T16:00:00.000Z");

class Sessions implements SessionStore {
  constructor(readonly record: SessionRecord | null) {}
  async create() {}
  async findById() { return this.record; }
}

const record: SessionRecord = {
  id: "session_01", fixtureKey: "product", actorId: "student_01", principalId: "student_01",
  studentId: "student_01", role: "student", state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "unused", expiresAt: "2026-07-19T18:00:00.000Z", createdAt: now.toISOString(), updatedAt: now.toISOString()
};

async function request(role: "student" | "guardian" = "student") {
  const token = await signSessionToken({ sessionId: "session_01", role, expiresAt: Date.parse(record.expiresAt) }, secret);
  return new Request("https://homeroom.example/api", { headers: { cookie: `homeroom_session=${token}` } });
}

afterEach(() => vi.restoreAllMocks());

describe("runtime security and delivery seams", () => {
  it("authenticates the requested verified role without requiring CSRF for a read", async () => {
    await expect(authenticatedSession({
      request: await request(), store: new Sessions(record), signingSecret: secret,
      role: "student", requireCsrf: false, now
    })).resolves.toEqual(record);
  });

  it("rejects missing, mismatched, and expired sessions", async () => {
    await expect(authenticatedSession({
      request: new Request("https://homeroom.example/api"), store: new Sessions(record),
      signingSecret: secret, role: "student", requireCsrf: false, now
    })).rejects.toBeInstanceOf(AuthenticatedSessionError);
    await expect(authenticatedSession({
      request: await request("guardian"), store: new Sessions(record), signingSecret: secret,
      role: "student", requireCsrf: false, now
    })).rejects.toMatchObject({ status: 403 });
    await expect(authenticatedSession({
      request: await request(), store: new Sessions({ ...record, expiresAt: "2026-07-19T15:00:00.000Z" }),
      signingSecret: secret, role: "student", requireCsrf: false, now
    })).rejects.toMatchObject({ status: 401 });
    await expect(authenticatedSession({
      request: await request(), store: new Sessions(null), signingSecret: secret,
      role: "student", requireCsrf: false, now
    })).rejects.toMatchObject({ status: 401 });
    await expect(authenticatedSession({
      request: await request(), store: new Sessions({ ...record, role: "guardian" }), signingSecret: secret,
      role: "student", requireCsrf: false, now
    })).rejects.toMatchObject({ status: 401 });
    const longCsrfRequest = await request();
    longCsrfRequest.headers.set("x-homeroom-csrf", "x".repeat(257));
    await expect(authenticatedSession({
      request: longCsrfRequest, store: new Sessions(record), signingSecret: secret, role: "student", now
    })).rejects.toMatchObject({ status: 403 });
  });

  it("sends the exact approved digest through the configured provider", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "email_01" }));
    await expect(sendGuardianDigestEmail({
      apiKey: "resend-key", from: "Homeroom <updates@example.com>",
      email: { to: "guardian@example.com", subject: "Weekly notes", text: "Emily approved this." }, fetcher
    })).resolves.toEqual({ providerMessageId: "email_01" });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
  });

  it("fails closed for missing email configuration, provider rejection, and malformed receipts", async () => {
    await expect(sendGuardianDigestEmail({ apiKey: "", from: "", email: { to: "g@example.com", subject: "s", text: "t" } }))
      .rejects.toThrow(/not configured/);
    await expect(sendGuardianDigestEmail({
      apiKey: "key", from: "from@example.com", email: { to: "g@example.com", subject: "s", text: "t" },
      fetcher: async () => new Response("no", { status: 500 })
    })).rejects.toThrow(/rejected/);
    await expect(sendGuardianDigestEmail({
      apiKey: "key", from: "from@example.com", email: { to: "g@example.com", subject: "s", text: "t" },
      fetcher: async () => Response.json({})
    })).rejects.toThrow(/invalid receipt/);
  });

  it("writes structured error context without exposing arbitrary objects", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    new StructuredLogger("test-scope").error("failed", new Error("boom"), { sessionId: "session_01" });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[0])).toContain('"scope":"test-scope"');
    expect(String(spy.mock.calls[0]?.[0])).toContain('"sessionId":"session_01"');
    new StructuredLogger("test-scope").error("unknown", "plain failure");
    expect(String(spy.mock.calls[1]?.[0])).toContain('"name":"UnknownError"');
  });
});
