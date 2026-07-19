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

describe("short age-aware AI check-in response", () => {
  it("uses server-projected evidence, store:false, and a strict bounded response", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_checkin_01",
      model: "gpt-5.6-sol-2026-07-15",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        acknowledgement: "Feeling scattered after a long morning makes sense.",
        nextStepLead: "Keep only the first Algebra step in view.",
        suggestedAction: "start_recommended"
      }) }] }],
      usage: { inputTokens: 120, outputTokens: 40, cachedTokens: 10 }
    });
    const client: ResponsesClient = { create };
    const traces = new MemoryTraceStore();

    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: "scattered",
      message: "I can't figure out where to start.",
      client,
      traceStore: traces,
      now: () => new Date("2026-08-17T14:00:00.000Z"),
      randomUUID: () => "turn_checkin_01"
    });

    expect(result.reply.suggestedAction).toBe("start_recommended");
    expect(result.proof.mode).toBe("live");
    const payload = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.store).toBe(false);
    expect(payload.max_output_tokens).toBeLessThanOrEqual(220);
    expect(JSON.stringify(payload)).toContain("Balancing Equations Readiness Check");
    expect(JSON.stringify(payload)).toContain("Marching band rehearsal");
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
      client: { create: vi.fn().mockRejectedValue(new Error("upstream unavailable")) },
      traceStore: traces,
      now: () => new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result).toMatchObject({
      reply: {
        suggestedAction: "take_two_minutes"
      },
      proof: { mode: "fallback" }
    });
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/quiz|test|rehearsal|due today/);
    expect(traces.records[0]).toMatchObject({ stage: "student_check_in", status: "failed" });
  });

  it("routes immediate-safety language to a trusted adult without calling the model", async () => {
    const create = vi.fn();
    const traces = new MemoryTraceStore();
    const result = await generateStudentCheckInResponse({
      session,
      projection: navigationProjection,
      focusState: "low_energy",
      message: "I am not safe and someone is hurting me.",
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
