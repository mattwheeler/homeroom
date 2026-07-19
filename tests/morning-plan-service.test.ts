import { describe, expect, it, vi } from "vitest";

import { generateMorningPlan } from "../lib/ai/morning-plan";
import type { AiTurnRecord, AiTurnStore } from "../lib/storage/ai-turn-store";
import type { SessionRecord } from "../lib/storage/session-store";

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "hash",
  expiresAt: "2026-07-18T14:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z"
};

const validPlan = {
  title: "Your band-camp morning",
  intro: "A calm start with enough time for the essentials.",
  steps: [
    { time: "06:30", title: "Wake up", detail: "Get dressed and have breakfast.", sourceLabel: "Homeroom plan" },
    { time: "06:45", title: "Final bag check", detail: "Bring your instrument, water, and music folder.", sourceLabel: "Band packing list" },
    { time: "07:00", title: "Leave home", detail: "Allow 20 minutes for travel and a 10-minute buffer.", sourceLabel: "Band calendar + preferences" },
    { time: "07:30", title: "Check in", detail: "You will be ready before the 8:00 AM start.", sourceLabel: "Band calendar" }
  ],
  guardianNote: "Matt owns the band physical form due July 24.",
  encouragement: "You have a clear plan—and you do not have to remember everything at once.",
  approvalPrompt: "Review this proposal. Would you like to adjust anything before saving it?"
};

class CapturingAiTurnStore implements AiTurnStore {
  records: AiTurnRecord[] = [];
  async record(record: AiTurnRecord) {
    this.records.push(record);
  }
}

describe("live morning-plan generation", () => {
  it("uses one allowlisted source tool, structured output, and persists a judge-visible trace", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: "resp_context",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{
          type: "function_call",
          call_id: "call_context",
          name: "get_morning_plan_context",
          arguments: JSON.stringify({ sessionId: "session_01", studentId: "student_emily" })
        }],
        usage: { inputTokens: 120, outputTokens: 18, cachedTokens: 20 }
      })
      .mockResolvedValueOnce({
        id: "resp_plan",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validPlan) }] }],
        usage: { inputTokens: 210, outputTokens: 140, cachedTokens: 80 }
      });
    const traceStore = new CapturingAiTurnStore();

    const result = await generateMorningPlan({
      session,
      client: { create },
      traceStore,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      randomUUID: () => "turn_01"
    });

    expect(result.plan).toEqual(validPlan);
    expect(result.proof).toEqual({
      model: "gpt-5.6-sol-2026-07-15",
      responseIds: ["resp_context", "resp_plan"],
      tools: ["get_morning_plan_context"],
      sourceVersion: 1
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "low", context: "current_turn" },
      safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      tools: [{ name: "get_morning_plan_context", strict: true }],
      text: { format: { type: "json_schema", name: "morning_plan", strict: true } }
    });
    expect(create.mock.calls[0][0].text.format.schema.properties.steps.items.properties.time.enum)
      .toEqual(["06:30", "06:45", "07:00", "07:30"]);
    expect(create.mock.calls[0][0].instructions).toContain("proposal only");
    expect(create.mock.calls[0][0].input).toContainEqual({
      role: "user",
      content: "Build my band-camp morning plan using sessionId=session_01 and studentId=student_emily."
    });
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call_context",
      output: expect.stringContaining("event_band_camp_day_1")
    }));
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      output: expect.stringContaining('"developmentalStage":"early_high_school"')
    }));
    expect(create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({
      output: expect.stringContaining('"skill":"prioritization"')
    }));
    expect(traceStore.records).toEqual([
      expect.objectContaining({
        id: "turn_01",
        sessionId: "session_01",
        stage: "morning_plan",
        model: "gpt-5.6-sol-2026-07-15",
        status: "completed",
        responseIds: ["resp_context", "resp_plan"],
        toolTrace: [{ name: "get_morning_plan_context", callId: "call_context" }],
        inputTokens: 330,
        outputTokens: 158,
        cachedTokens: 100
      })
    ]);
  });

  it("rejects cross-session tool arguments and records a safe failure trace", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_bad",
      model: "gpt-5.6-sol",
      output: [{
        type: "function_call",
        call_id: "call_bad",
        name: "get_morning_plan_context",
        arguments: JSON.stringify({ sessionId: "another_session", studentId: "student_emily" })
      }]
    });
    const traceStore = new CapturingAiTurnStore();

    await expect(generateMorningPlan({
      session,
      client: { create },
      traceStore,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      randomUUID: () => "turn_bad"
    })).rejects.toThrow("context");

    expect(traceStore.records).toEqual([
      expect.objectContaining({
        id: "turn_bad",
        status: "failed",
        errorCode: "CONTEXT_MISMATCH"
      })
    ]);
  });

  it("fails closed when the final structured plan violates the source times", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: "resp_context",
        model: "gpt-5.6-sol",
        output: [{
          type: "function_call",
          call_id: "call_context",
          name: "get_morning_plan_context",
          arguments: JSON.stringify({ sessionId: "session_01", studentId: "student_emily" })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_invalid",
        model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
          ...validPlan,
          steps: validPlan.steps.map((step, index) => index === 2 ? { ...step, time: "07:10" } : step)
        }) }] }]
      });

    await expect(generateMorningPlan({
      session,
      client: { create },
      traceStore: new CapturingAiTurnStore()
    })).rejects.toThrow("source times");
  });
});
