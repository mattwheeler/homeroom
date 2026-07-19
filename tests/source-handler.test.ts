import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { SourceConnectionError } from "../lib/domain/source-connections";
import {
  handleBandCalendarConnection,
  handleGoogleClassroomCallback,
  handleGoogleClassroomStart,
  handleSourceStatus,
  handleSourceSync
} from "../lib/http/source-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-sources";
const expiresAt = Date.parse("2026-07-18T14:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T12:10:00.000Z");

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:09:00.000Z"
  };
}

class MemorySessionStore implements SessionStore {
  constructor(private readonly value: SessionRecord | null) {}
  async create() {}
  async findById() { return this.value; }
}

async function postRequest(path: string, body: unknown, options: {
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
  return new Request(`https://homeroom.example${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function callbackRequest(query: string, options: { includeCookie?: boolean; role?: "student" | "guardian" } = {}) {
  const role = options.role ?? "guardian";
  const token = await signSessionToken({ sessionId: "session_01", role, expiresAt }, signingSecret);
  const headers: Record<string, string> = {};
  if (options.includeCookie !== false) headers.cookie = `homeroom_oauth_session=${encodeURIComponent(token)}`;
  return new Request(`https://homeroom.example/api/integrations/google/callback?${query}`, { headers });
}

function base(role: "student" | "guardian" = "student") {
  return {
    store: new MemorySessionStore(session(role)),
    signingSecret,
    rateLimiter: allow,
    clientKey: "test",
    now
  };
}

describe("secure read-only source HTTP handlers", () => {
  it("returns only the public synchronized snapshot", async () => {
    const snapshot = vi.fn().mockResolvedValue({
      connections: [{ provider: "google_classroom", status: "active", displayName: "Google Classroom", lastSyncAt: "2026-07-18T12:00:00.000Z", lastErrorCode: null }],
      courses: [{ provider: "google_classroom", externalId: "course-1", name: "Algebra I - Period 2", section: null, subject: null, courseState: "ACTIVE", alternateLink: null, calendarId: null, trackCourseId: "course_algebra_1" }],
      coursework: [],
      events: []
    });
    const response = await handleSourceStatus(
      await postRequest("/api/integrations/status", {}),
      { ...base(), snapshot }
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(snapshot).toHaveBeenCalledWith(session());
    expect(JSON.stringify(body)).not.toMatch(/secret|token|calendarUrl/i);

    const guardianResponse = await handleSourceStatus(
      await postRequest("/api/integrations/status", {}, { role: "guardian" }),
      { ...base("guardian"), snapshot }
    );
    expect(guardianResponse.status).toBe(200);
    expect(snapshot).toHaveBeenLastCalledWith(session("guardian"));
  });

  it("keeps every connection-changing action out of the student role", async () => {
    const start = vi.fn();
    const connect = vi.fn();
    const sync = vi.fn();

    const responses = await Promise.all([
      handleGoogleClassroomStart(
        await postRequest("/api/integrations/google/start", {}),
        { ...base(), start }
      ),
      handleBandCalendarConnection(
        await postRequest("/api/integrations/band/connect", {
          calendarUrl: "webcal://api.band.us/feed/example.ics",
          displayName: "Emily's band"
        }),
        { ...base(), connect }
      ),
      handleSourceSync(
        await postRequest("/api/integrations/sync", { provider: "google_classroom" }),
        { ...base(), sync }
      )
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(start).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("starts Google OAuth and emits a short-lived callback-only Lax cookie", async () => {
    const start = vi.fn().mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" });
    const response = await handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { role: "guardian" }),
      { ...base("guardian"), start }
    );
    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledWith(session("guardian"));
    expect(response.headers.get("set-cookie")).toContain("homeroom_oauth_session=");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/auth/google/callback");
  });

  it("connects a bounded BAND URL and manually syncs either provider", async () => {
    const connect = vi.fn().mockResolvedValue({ connected: true, provider: "band_ical", eventCount: 2 });
    const sync = vi.fn().mockResolvedValue({ synced: true, provider: "band_ical", recordCount: 2 });
    const connected = await handleBandCalendarConnection(
      await postRequest("/api/integrations/band/connect", {
        calendarUrl: "webcal://api.band.us/feed/example.ics",
        displayName: "Emily's band"
      }, { role: "guardian" }),
      { ...base("guardian"), connect }
    );
    const synced = await handleSourceSync(
      await postRequest("/api/integrations/sync", { provider: "band_ical" }, { role: "guardian" }),
      { ...base("guardian"), sync }
    );
    expect(connected.status).toBe(200);
    expect(synced.status).toBe(200);
    expect(connect).toHaveBeenCalledWith(session("guardian"), {
      calendarUrl: "webcal://api.band.us/feed/example.ics",
      displayName: "Emily's band"
    });
    expect(sync).toHaveBeenCalledWith(session("guardian"), { provider: "band_ical" });
  });

  it("completes the OAuth callback with one-time state and clears the callback cookie", async () => {
    const complete = vi.fn().mockResolvedValue({ connected: true, provider: "google_classroom" });
    const response = await handleGoogleClassroomCallback(
      await callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`),
      { store: new MemorySessionStore(session("guardian")), signingSecret, now, complete }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homeroom.example/guardian?source=google-connected#school-sources");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(complete).toHaveBeenCalledWith(session("guardian"), {
      state: "s".repeat(43),
      code: "authorization-code"
    });
  });

  it("rejects failed callbacks without leaking provider details", async () => {
    const failedByGoogle = await handleGoogleClassroomCallback(
      await callbackRequest("error=access_denied&error_description=private-detail"),
      { store: new MemorySessionStore(session("guardian")), signingSecret, now, complete: vi.fn() }
    );
    expect(failedByGoogle.status).toBe(303);
    expect(failedByGoogle.headers.get("location")).toBe("https://homeroom.example/guardian?source=google-declined#school-sources");

    const failedInternally = await handleGoogleClassroomCallback(
      await callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`),
      { store: new MemorySessionStore(session("guardian")), signingSecret, now, complete: vi.fn().mockRejectedValue(new Error("refresh-secret")) }
    );
    expect(failedInternally.headers.get("location")).toBe("https://homeroom.example/guardian?source=google-error#school-sources");
    expect(await failedInternally.text()).not.toContain("refresh-secret");
  });

  it("returns safe, actionable callback results for each OAuth completion stage", async () => {
    const cases = [
      ["SOURCE_OAUTH_EXCHANGE_FAILED", "google-oauth-error"],
      ["SOURCE_OAUTH_INVALID_GRANT", "google-invalid-grant"],
      ["SOURCE_OAUTH_INVALID_CLIENT", "google-client-error"],
      ["SOURCE_OAUTH_TOKEN_REJECTED", "google-token-rejected"],
      ["SOURCE_OAUTH_NETWORK_FAILED", "google-network-error"],
      ["SOURCE_OAUTH_RESPONSE_INVALID", "google-response-error"],
      ["SOURCE_OAUTH_PROVIDER_UNAVAILABLE", "google-provider-unavailable"],
      ["SOURCE_CLASSROOM_READ_FAILED", "google-classroom-error"],
      ["SOURCE_CONNECTION_SAVE_FAILED", "google-storage-error"],
      ["SOURCE_REFRESH_MISSING", "google-refresh-error"]
    ] as const;

    for (const [code, result] of cases) {
      const response = await handleGoogleClassroomCallback(
        await callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`),
        {
          store: new MemorySessionStore(session("guardian")),
          signingSecret,
          now,
          complete: vi.fn().mockRejectedValue(new SourceConnectionError(code, "provider-secret"))
        }
      );
      expect(response.headers.get("location")).toBe(`https://homeroom.example/guardian?source=${result}#school-sources`);
      expect(await response.text()).not.toContain("provider-secret");
    }
  });

  it("rejects missing auth, students, cross-origin, invalid CSRF, extra fields, and rate limits", async () => {
    const start = vi.fn();
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { includeCookie: false, role: "guardian" }),
      { ...base("guardian"), start }
    )).resolves.toMatchObject({ status: 401 });
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { role: "student" }),
      { ...base("student"), start }
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { origin: "https://attacker.example", role: "guardian" }),
      { ...base("guardian"), start }
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { csrf: "bad", role: "guardian" }),
      { ...base("guardian"), start }
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", { role: "owner" }, { role: "guardian" }),
      { ...base("guardian"), start }
    )).resolves.toMatchObject({ status: 400 });
    await expect(handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { role: "guardian" }),
      { ...base("guardian"), start, rateLimiter: { consume: () => false } }
    )).resolves.toMatchObject({ status: 429 });
    expect(start).not.toHaveBeenCalled();
  });

  it("requires the callback-only session cookie and the same valid guardian session", async () => {
    const complete = vi.fn();
    await expect(handleGoogleClassroomCallback(
      await callbackRequest(`state=${"s".repeat(43)}&code=x`, { includeCookie: false }),
      { store: new MemorySessionStore(session("guardian")), signingSecret, now, complete }
    )).resolves.toMatchObject({ status: 303 });
    await expect(handleGoogleClassroomCallback(
      await callbackRequest(`state=${"s".repeat(43)}&code=x`, { role: "student" }),
      { store: new MemorySessionStore(session("student")), signingSecret, now, complete }
    )).resolves.toMatchObject({ status: 303 });
    expect(complete).not.toHaveBeenCalled();
  });

  it("bounds request parsing and safely maps source failures", async () => {
    const token = await signSessionToken({ sessionId: "session_01", role: "guardian", expiresAt }, signingSecret);
    const headers = {
      origin: "https://homeroom.example",
      "content-type": "application/json",
      "x-homeroom-csrf": csrfToken,
      cookie: `homeroom_session=${encodeURIComponent(token)}`
    };
    const invalidJson = new Request("https://homeroom.example/api/integrations/google/start", {
      method: "POST", headers, body: "{"
    });
    await expect(handleGoogleClassroomStart(invalidJson, { ...base("guardian"), start: vi.fn() }))
      .resolves.toMatchObject({ status: 400 });

    const oversized = new Request("https://homeroom.example/api/integrations/google/start", {
      method: "POST", headers: { ...headers, "content-length": "4097" }, body: "{}"
    });
    await expect(handleGoogleClassroomStart(oversized, { ...base("guardian"), start: vi.fn() }))
      .resolves.toMatchObject({ status: 413 });

    const wrongContent = new Request("https://homeroom.example/api/integrations/google/start", {
      method: "POST",
      headers: { origin: "https://homeroom.example", cookie: headers.cookie, "x-homeroom-csrf": csrfToken },
      body: "{}"
    });
    await expect(handleGoogleClassroomStart(wrongContent, { ...base("guardian"), start: vi.fn() }))
      .resolves.toMatchObject({ status: 415 });

    const conflict = await handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { role: "guardian" }),
      { ...base("guardian"), start: vi.fn().mockRejectedValue(new SourceConnectionError("SOURCE_NOT_CONNECTED", "Not connected.")) }
    );
    expect(conflict.status).toBe(409);
    const failure = await handleGoogleClassroomStart(
      await postRequest("/api/integrations/google/start", {}, { role: "guardian" }),
      { ...base("guardian"), start: vi.fn().mockRejectedValue(new Error("provider-secret")) }
    );
    expect(failure.status).toBe(502);
    expect(failure.headers.get("set-cookie")).toBeNull();
    expect(await failure.text()).not.toContain("provider-secret");
  });

  it("rejects missing, mismatched, and expired persisted sessions", async () => {
    const start = vi.fn();
    const request = await postRequest("/api/integrations/google/start", {}, { role: "guardian" });
    await expect(handleGoogleClassroomStart(request.clone(), { ...base("guardian"), store: new MemorySessionStore(null), start }))
      .resolves.toMatchObject({ status: 401 });
    await expect(handleGoogleClassroomStart(request.clone(), {
      ...base("guardian"),
      store: new MemorySessionStore({ ...session("guardian"), actorId: "student_emily" }),
      start
    })).resolves.toMatchObject({ status: 401 });
    await expect(handleGoogleClassroomStart(request.clone(), {
      ...base("guardian"),
      store: new MemorySessionStore({ ...session("guardian"), expiresAt: "2026-07-18T12:00:00.000Z" }),
      start
    })).resolves.toMatchObject({ status: 401 });
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects malformed OAuth callback parameters before source exchange", async () => {
    const complete = vi.fn();
    for (const query of [
      "state=short&code=code",
      `state=${"s".repeat(513)}&code=code`,
      `state=${"s".repeat(43)}`,
      `state=${"s".repeat(43)}&code=${"c".repeat(4_097)}`
    ]) {
      const response = await handleGoogleClassroomCallback(
        await callbackRequest(query),
        { store: new MemorySessionStore(session("guardian")), signingSecret, now, complete }
      );
      expect(response.headers.get("location")).toContain("source=google-error");
    }
    expect(complete).not.toHaveBeenCalled();
  });
});
