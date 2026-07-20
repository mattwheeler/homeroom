import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleOfficialSchoolSource } from "../lib/http/official-school-source-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrf = "school-source-csrf";
const guardian: SessionRecord = {
  id: "session_guardian",
  fixtureKey: "emily_band_camp_v1",
  actorId: "guardian_matt",
  role: "guardian",
  state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
  csrfHash: createHash("sha256").update(csrf).digest("hex"),
  expiresAt: "2026-07-19T20:00:00.000Z",
  createdAt: "2026-07-19T18:00:00.000Z",
  updatedAt: "2026-07-19T18:00:00.000Z"
};

const allow: RateLimiter = { consume: () => true };
const store: SessionStore = { async create() {}, async findById() { return guardian; } };

async function request(body: unknown, session = guardian) {
  const token = await signSessionToken({
    sessionId: session.id,
    role: session.role,
    expiresAt: Date.parse(session.expiresAt)
  }, signingSecret);
  return new Request("https://homeroom.example/api/integrations/school", {
    method: "POST",
    headers: {
      origin: "https://homeroom.example",
      "content-type": "application/json",
      "x-homeroom-csrf": csrf,
      cookie: `homeroom_session=${token}`
    },
    body: JSON.stringify(body)
  });
}

describe("official school source HTTP boundary", () => {
  it("accepts a bounded guardian calendar connection request", async () => {
    const connectCalendar = vi.fn().mockResolvedValue({ connected: true, eventCount: 18 });
    const response = await handleOfficialSchoolSource(await request({
      action: "connect_calendar",
      schoolUrl: "https://phs.comalisd.org/",
      districtCalendarUrl: "https://www.comalisd.org/apps/pages/calendars"
    }), {
      store,
      signingSecret,
      rateLimiter: allow,
      clientKey: "guardian",
      now: () => new Date("2026-07-19T18:01:00.000Z"),
      connectCalendar,
      connectSupplies: vi.fn(),
      sync: vi.fn()
    });
    expect(response.status).toBe(200);
    expect(connectCalendar).toHaveBeenCalledWith(guardian, expect.objectContaining({
      schoolUrl: "https://phs.comalisd.org/"
    }));
  });

  it("rejects malformed URLs and a student role before touching a source", async () => {
    const connectSupplies = vi.fn();
    const malformed = await handleOfficialSchoolSource(await request({
      action: "connect_supplies",
      sourceUrl: "javascript:alert(1)"
    }), {
      store,
      signingSecret,
      rateLimiter: allow,
      clientKey: "guardian",
      connectCalendar: vi.fn(),
      connectSupplies,
      sync: vi.fn()
    });
    expect(malformed.status).toBe(400);
    expect(connectSupplies).not.toHaveBeenCalled();

    const student = { ...guardian, id: "session_student", role: "student" as const, actorId: "student_emily" };
    const denied = await handleOfficialSchoolSource(await request({
      action: "connect_supplies",
      sourceUrl: "https://phs.comalisd.org/apps/pages/supplies"
    }, student), {
      store: { ...store, async findById() { return student; } },
      signingSecret,
      rateLimiter: allow,
      clientKey: "student",
      now: () => new Date("2026-07-19T18:01:00.000Z"),
      connectCalendar: vi.fn(),
      connectSupplies,
      sync: vi.fn()
    });
    expect(denied.status).toBe(403);
    expect(connectSupplies).not.toHaveBeenCalled();
  });
});
