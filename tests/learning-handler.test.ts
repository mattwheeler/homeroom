import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { LearningSessionError } from "../lib/domain/learning-session";
import {
  handleCompleteLearning,
  handleDeleteLearnerSignal,
  handleLearningContext,
  handleLearningTurn,
  handleStartLearning
} from "../lib/http/learning-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-learning";
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

function dependencies() {
  return {
    store: new MemorySessionStore(session()),
    signingSecret,
    rateLimiter: allow,
    clientKey: "test",
    now
  };
}

describe("secure independent Learning HTTP handlers", () => {
  it("starts an allowlisted course, duration, and explicit support preference", async () => {
    const start = vi.fn().mockResolvedValue({
      learningSession: { id: "learning_123456789012345678901234", courseId: "course_algebra_1" }
    });
    const body = JSON.stringify({
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first"
    });
    const response = await handleStartLearning(
      await request("/api/learning/start", body),
      { ...dependencies(), start }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(start).toHaveBeenCalledWith(session(), {
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first"
    });
  });

  it("accepts a bounded student response for the next AI-led turn", async () => {
    const turn = vi.fn().mockResolvedValue({ turn: { phase: "diagnostic" } });
    const body = JSON.stringify({
      learningSessionId: "learning_123456789012345678901234",
      response: "I think both sides have to stay equal."
    });
    const result = await handleLearningTurn(
      await request("/api/learning/turn", body),
      { ...dependencies(), turn }
    );
    expect(result.status).toBe(200);
    expect(turn).toHaveBeenCalledWith(session(), {
      learningSessionId: "learning_123456789012345678901234",
      response: "I think both sides have to stay equal."
    });
  });

  it("completes sessions and lists or deletes transparent learner context", async () => {
    const complete = vi.fn().mockResolvedValue({ completed: true });
    const context = vi.fn().mockResolvedValue({ signals: [], progress: [] });
    const deleteSignal = vi.fn().mockResolvedValue({ deleted: true });
    const learningSessionId = "learning_123456789012345678901234";
    const signalId = "signal_abcdefabcdefabcdefabcdef";

    await expect(handleCompleteLearning(
      await request("/api/learning/complete", JSON.stringify({ learningSessionId })),
      { ...dependencies(), complete }
    )).resolves.toMatchObject({ status: 200 });
    await expect(handleLearningContext(
      await request("/api/learning/context", JSON.stringify({ courseId: "course_algebra_1" })),
      { ...dependencies(), context }
    )).resolves.toMatchObject({ status: 200 });
    await expect(handleDeleteLearnerSignal(
      await request("/api/learning/context/delete", JSON.stringify({ signalId })),
      { ...dependencies(), deleteSignal }
    )).resolves.toMatchObject({ status: 200 });

    expect(complete).toHaveBeenCalledWith(session(), { learningSessionId });
    expect(context).toHaveBeenCalledWith(session(), { courseId: "course_algebra_1" });
    expect(deleteSignal).toHaveBeenCalledWith(session(), { signalId });
  });

  it("rejects missing auth, guardian role, cross-origin, CSRF, extra input, and rate limits", async () => {
    const start = vi.fn();
    const body = JSON.stringify({
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first"
    });
    const base = { ...dependencies(), start };
    await expect(handleStartLearning(await request("/api/learning/start", body, { includeCookie: false }), base))
      .resolves.toMatchObject({ status: 401 });
    await expect(handleStartLearning(await request("/api/learning/start", body, { role: "guardian" }), {
      ...base, store: new MemorySessionStore(session("guardian"))
    })).resolves.toMatchObject({ status: 403 });
    await expect(handleStartLearning(await request("/api/learning/start", body, { origin: "https://attacker.example" }), base))
      .resolves.toMatchObject({ status: 403 });
    await expect(handleStartLearning(await request("/api/learning/start", body, { csrf: "wrong" }), base))
      .resolves.toMatchObject({ status: 403 });
    await expect(handleStartLearning(await request("/api/learning/start", JSON.stringify({
      courseId: "course_algebra_1", durationMinutes: 10,
      supportPreference: "example_first", inferredDiagnosis: "anxiety"
    })), base)).resolves.toMatchObject({ status: 400 });
    await expect(handleStartLearning(await request("/api/learning/start", body), {
      ...base, rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects unsupported classes, timeboxes, preferences, and oversized student text", async () => {
    const start = vi.fn();
    const turn = vi.fn();
    const context = vi.fn();
    const base = dependencies();
    for (const invalid of [
      { courseId: "course_chemistry", durationMinutes: 10, supportPreference: "example_first" },
      { courseId: "course_algebra_1", durationMinutes: 60, supportPreference: "example_first" },
      { courseId: "course_algebra_1", durationMinutes: 10, supportPreference: "tell_me_answers" }
    ]) {
      await expect(handleStartLearning(
        await request("/api/learning/start", JSON.stringify(invalid)),
        { ...base, start }
      )).resolves.toMatchObject({ status: 400 });
    }
    await expect(handleLearningTurn(
      await request("/api/learning/turn", JSON.stringify({
        learningSessionId: "learning_123456789012345678901234",
        response: "x".repeat(501)
      })),
      { ...base, turn }
    )).resolves.toMatchObject({ status: 400 });
    await expect(handleLearningContext(
      await request("/api/learning/context", JSON.stringify({})),
      { ...base, context }
    )).resolves.toMatchObject({ status: 400 });
    expect(start).not.toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
  });

  it("maps domain conflicts and provider failures without leaking internals", async () => {
    const body = JSON.stringify({
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first"
    });
    const conflict = await handleStartLearning(
      await request("/api/learning/start", body),
      {
        ...dependencies(),
        start: vi.fn().mockRejectedValue(new LearningSessionError("LEARNING_ALREADY_ACTIVE", "Active."))
      }
    );
    expect(conflict.status).toBe(409);

    const failed = await handleStartLearning(
      await request("/api/learning/start", body),
      { ...dependencies(), start: vi.fn().mockRejectedValue(new Error("private provider detail")) }
    );
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("private provider detail");
  });
});
