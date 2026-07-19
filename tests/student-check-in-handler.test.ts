import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleStudentCheckIn } from "../lib/http/student-check-in-handler";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrf = "csrf-student-checkin";

class Store implements SessionStore {
  constructor(readonly record: SessionRecord) {}
  async create() {}
  async findById(id: string) { return id === this.record.id ? this.record : null; }
}

async function setup(role: "student" | "guardian" = "student") {
  const now = Date.parse("2026-08-17T14:00:00.000Z");
  const record: SessionRecord = {
    id: `${role}_session`,
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
    csrfHash: createHash("sha256").update(csrf).digest("hex"),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
  return {
    record,
    token: await signSessionToken({ sessionId: record.id, role, expiresAt: now + 60 * 60 * 1000 }, signingSecret)
  };
}

function request(token: string, body: unknown, options?: { csrf?: string; origin?: string }) {
  return new Request("https://homeroom.example/api/student/check-in", {
    method: "POST",
    headers: {
      origin: options?.origin ?? "https://homeroom.example",
      "content-type": "application/json",
      cookie: `homeroom_session=${encodeURIComponent(token)}`,
      "x-homeroom-csrf": options?.csrf ?? csrf
    },
    body: JSON.stringify(body)
  });
}

describe("student check-in HTTP boundary", () => {
  it("accepts only a short feeling message from an authenticated student", async () => {
    const { record, token } = await setup();
    let received: unknown;
    const response = await handleStudentCheckIn(
      request(token, { focusState: "scattered", message: "I do not know where to start." }),
      {
        store: new Store(record), signingSecret, rateLimiter: { consume: () => true }, clientKey: "test",
        now: () => new Date("2026-08-17T14:00:00.000Z"),
        respond: async (_session, input) => {
          received = input;
          return { reply: { acknowledgement: "That makes sense.", nextStepLead: "Keep one step visible.", suggestedAction: "start_recommended" } };
        }
      }
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ focusState: "scattered", message: "I do not know where to start." });
  });

  it("rejects missing CSRF, guardian sessions, oversized text, and distributed rate-limit exhaustion", async () => {
    const student = await setup();
    const guardian = await setup("guardian");
    const base = {
      signingSecret,
      rateLimiter: { consume: () => true },
      clientKey: "test",
      now: () => new Date("2026-08-17T14:00:00.000Z"),
      respond: async () => ({ ok: true })
    };

    const missingCsrf = await handleStudentCheckIn(
      request(student.token, { focusState: "ready", message: "Ready." }, { csrf: "wrong" }),
      { ...base, store: new Store(student.record) }
    );
    expect(missingCsrf.status).toBe(403);

    const wrongRole = await handleStudentCheckIn(
      request(guardian.token, { focusState: "ready", message: "Ready." }),
      { ...base, store: new Store(guardian.record) }
    );
    expect(wrongRole.status).toBe(403);

    const tooLong = await handleStudentCheckIn(
      request(student.token, { focusState: "ready", message: "x".repeat(281) }),
      { ...base, store: new Store(student.record) }
    );
    expect(tooLong.status).toBe(400);

    const limited = await handleStudentCheckIn(
      request(student.token, { focusState: "ready", message: "Ready." }),
      { ...base, store: new Store(student.record), rateLimiter: { consume: () => false } }
    );
    expect(limited.status).toBe(429);
  });
});
