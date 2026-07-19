import { describe, expect, it, vi } from "vitest";

import { generateStudentCheckInResponse } from "../lib/ai/student-check-in-response";
import type { ResponsesClient } from "../lib/ai/responses-loop";
import type { AiTurnRecord, AiTurnStore } from "../lib/storage/ai-turn-store";
import type { SessionRecord } from "../lib/storage/session-store";
import { navigationProjection } from "./student-navigation-fixture";

const session: SessionRecord = {
  id: "session_emily",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "0".repeat(64),
  expiresAt: "2026-08-17T16:00:00.000Z",
  createdAt: "2026-08-17T14:00:00.000Z",
  updatedAt: "2026-08-17T14:00:00.000Z"
};

class MemoryTraceStore implements AiTurnStore {
  records: AiTurnRecord[] = [];
  async record(record: AiTurnRecord) { this.records.push(record); }
}

describe("short age-aware AI coaching conversation", () => {
  it("uses server-projected evidence and bounded conversation history without tools or storage", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_checkin_01",
      model: "gpt-5.6-sol-2026-07-15",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        message: "You already know the task, so let’s work on the stuck-at-the-start part.",
        followUpQuestion: "Would making the first move tiny or choosing a two-minute timer feel easier?",
        suggestedAction: "none"
      }) }] }],
      usage: { inputTokens: 120, outputTokens: 40, cachedTokens: 10 }
    });
    const client: ResponsesClient = { create };
    const traces = new MemoryTraceStore();

    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: null,
      message: "I can't figure out where to start.",
      history: [
        { role: "student", text: "I know what the assignment is." },
        { role: "homeroom", text: "What part feels hardest right now?" }
      ],
      client,
      traceStore: traces,
      now: () => new Date("2026-08-17T14:00:00.000Z"),
      randomUUID: () => "turn_checkin_01"
    });

    expect(result.reply).toMatchObject({
      suggestedAction: "none",
      followUpQuestion: expect.stringContaining("timer")
    });
    expect(result.proof.mode).toBe("live");
    const payload = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.store).toBe(false);
    expect(payload.max_output_tokens).toBeLessThanOrEqual(400);
    expect(JSON.stringify(payload)).toContain("Balancing Equations Readiness Check");
    expect(JSON.stringify(payload)).toContain("Marching band rehearsal");
    expect(JSON.stringify(payload)).toContain("What part feels hardest right now?");
    expect(payload).not.toHaveProperty("tools");
    expect(traces.records[0]).toMatchObject({ stage: "student_check_in", status: "completed" });
  });

  it("returns a deterministic supportive fallback without inventing school facts when the model fails", async () => {
    const traces = new MemoryTraceStore();
    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: "low_energy",
      message: "I am tired.",
      history: [],
      client: { create: vi.fn().mockRejectedValue(new Error("upstream unavailable")) },
      traceStore: traces,
      now: () => new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result).toMatchObject({
      reply: {
        suggestedAction: "take_two_minutes",
        followUpQuestion: expect.any(String)
      },
      proof: { mode: "fallback" }
    });
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/quiz|test|rehearsal|due today/);
    expect(traces.records[0]).toMatchObject({ stage: "student_check_in", status: "failed" });
  });

  it("offers one small first step when a scattered check-in falls back", async () => {
    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: "scattered",
      message: "Everything feels mixed together.",
      history: [],
      client: { create: vi.fn().mockRejectedValue(new Error("upstream unavailable")) },
      traceStore: new MemoryTraceStore(),
      now: () => new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result).toMatchObject({
      reply: {
        suggestedAction: "start_recommended",
        followUpQuestion: expect.any(String)
      },
      proof: { mode: "fallback" }
    });
  });

  it("routes immediate-safety language to a trusted adult without calling the model", async () => {
    const create = vi.fn();
    const traces = new MemoryTraceStore();
    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: "low_energy",
      message: "I am not safe and someone is hurting me.",
      history: [],
      client: { create },
      traceStore: traces,
      now: () => new Date("2026-08-17T14:00:00.000Z")
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reply: { suggestedAction: "ask_trusted_adult" },
      proof: { mode: "safety" }
    });
  });
});
