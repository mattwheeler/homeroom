import { describe, expect, it, vi } from "vitest";

import {
  handleGuardianDigestCron,
  type GuardianDigestCronDependencies
} from "../lib/http/guardian-digest-cron-handler";
import type {
  GuardianDigestRecipient,
  GuardianInboxStore,
  GuardianNotification
} from "../lib/storage/guardian-inbox-store";

const cronSecret = "guardian-digest-cron-secret-that-is-at-least-thirty-two-characters";

class DigestStore implements GuardianInboxStore {
  readonly deliveries: Array<Parameters<GuardianInboxStore["recordDigest"]>[0]> = [];

  constructor(
    readonly recipients: GuardianDigestRecipient[] = [],
    readonly notifications: GuardianNotification[] = []
  ) {}

  async list() { return this.notifications; }
  async acknowledge() { return null; }
  async recordDigest(input: Parameters<GuardianInboxStore["recordDigest"]>[0]) {
    this.deliveries.push(input);
  }
  async listDigestRecipients() { return this.recipients; }
}

function request(secret = cronSecret, ip = "203.0.113.9") {
  return new Request("https://homeroom.example/api/cron/guardian-digest", {
    method: "POST",
    headers: { "x-homeroom-cron": secret, "cf-connecting-ip": ip }
  });
}

function dependencies(overrides: Partial<GuardianDigestCronDependencies> = {}): GuardianDigestCronDependencies {
  return {
    cronSecret,
    resendApiKey: "resend-key",
    digestFrom: "Homeroom <updates@example.com>",
    rateLimiter: { consume: vi.fn(async () => true) },
    store: new DigestStore(),
    sendEmail: vi.fn(async () => ({ providerMessageId: "email_01" })),
    logger: { error: vi.fn() },
    randomUUID: () => "delivery_01",
    now: () => new Date("2026-07-20T16:00:00.000Z"),
    ...overrides
  };
}

describe("guardian digest cron handler", () => {
  it("fails closed when the cron secret is missing or shorter than 32 characters", async () => {
    const deps = dependencies({ cronSecret: "too-short" });
    const response = await handleGuardianDigestCron(request("too-short"), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SERVICE_NOT_CONFIGURED" } });
    expect(deps.rateLimiter.consume).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("rate limits the public route by edge-provided client address", async () => {
    const deps = dependencies({ rateLimiter: { consume: vi.fn(async () => false) } });
    const response = await handleGuardianDigestCron(request(cronSecret, "198.51.100.7"), deps);

    expect(response.status).toBe(429);
    expect(deps.rateLimiter.consume).toHaveBeenCalledWith("198.51.100.7");
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret after consuming the public rate limit", async () => {
    const deps = dependencies();
    const response = await handleGuardianDigestCron(request("x".repeat(40)), deps);

    expect(response.status).toBe(401);
    expect(deps.rateLimiter.consume).toHaveBeenCalledOnce();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("requires email delivery configuration after successful authorization", async () => {
    const deps = dependencies({ resendApiKey: "" });
    const response = await handleGuardianDigestCron(request(), deps);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EMAIL_NOT_CONFIGURED" } });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("sends approved digests and continues when one recipient delivery fails", async () => {
    const store = new DigestStore(
      [
        { recipientId: "guardian_01", recipientEmail: "one@example.com" },
        { recipientId: "guardian_02", recipientEmail: "two@example.com" }
      ],
      [{
        id: "note_01",
        recipientId: "guardian_01",
        studentId: "student_01",
        title: "A note",
        message: "Please review the form.",
        taskLabel: "School form",
        sourceLabel: "Student-approved reminder",
        sentAt: "2026-07-20T15:00:00.000Z",
        readAt: null
      }]
    );
    const sendEmail = vi.fn(async (input: { email: { to: string } }) => {
      if (input.email.to === "two@example.com") throw new Error("provider unavailable");
      return { providerMessageId: "email_01" };
    });
    const logger = { error: vi.fn() };
    const deps = dependencies({ store, sendEmail, logger });

    const response = await handleGuardianDigestCron(request(), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, recipients: 2, sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "delivery_failed",
      expect.any(Error),
      { recipientId: "guardian_02" }
    );
    expect(store.deliveries.filter((item) => item.status === "sent")).toHaveLength(1);
  });
});
