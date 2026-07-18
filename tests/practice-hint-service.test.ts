import { describe, expect, it, vi } from "vitest";

import { generatePracticeHint, practiceHintSchema } from "../lib/ai/practice-hint";
import type { AiTurnRecord, AiTurnStore } from "../lib/storage/ai-turn-store";
import type { SessionRecord } from "../lib/storage/session-store";

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "PLAN_V2_SAVED", stateVersion: 10, sourceVersion: 2, activePlanVersion: 2 },
  csrfHash: "hash",
  expiresAt: "2026-07-18T14:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:09:00.000Z"
};

const hint = practiceHintSchema.parse({
  title: "Undo one layer",
  encouragement: "You only need to choose the first move.",
  question: "Which operation would undo the multiplication wrapped around the parentheses?",
  concept: "inverse operations",
  answerPolicy: "hidden"
});

class CapturingAiTurnStore implements AiTurnStore {
  records: AiTurnRecord[] = [];
  async record(record: AiTurnRecord) { this.records.push(record); }
}

describe("live age-appropriate Algebra hint", () => {
  it("uses one read-only exercise tool without exposing grader-only facts", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_exercise",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{
          type: "function_call",
          call_id: "call_exercise",
          name: "get_practice_exercise",
          arguments: JSON.stringify({ sessionId: "session_01", exerciseId: "linear_equation_01" })
        }],
        usage: { inputTokens: 70, outputTokens: 15, cachedTokens: 0 }
      })
      .mockResolvedValueOnce({
        id: "resp_hint",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(hint) }] }],
        usage: { inputTokens: 110, outputTokens: 55, cachedTokens: 20 }
      });
    const traceStore = new CapturingAiTurnStore();

    const result = await generatePracticeHint({
      session,
      client: { create },
      traceStore,
      now: () => new Date("2026-07-18T12:10:00.000Z"),
      randomUUID: () => "turn_hint_01"
    });

    expect(result.hint).toEqual(hint);
    expect(result.proof).toEqual({
      model: "gpt-5.6-sol-2026-07-15",
      responseIds: ["resp_exercise", "resp_hint"],
      tools: ["get_practice_exercise"],
      exerciseId: "linear_equation_01"
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      reasoning: { effort: "low", context: "current_turn" },
      tools: [{ name: "get_practice_exercise", strict: true }],
      text: { format: { type: "json_schema", name: "practice_hint", strict: true } }
    });
    const toolOutput = String(create.mock.calls[1][0].input.find(
      (item: { type?: string }) => item.type === "function_call_output"
    )?.output);
    expect(toolOutput).toContain('"prompt":"3(x + 2) = 18"');
    expect(toolOutput).not.toContain("finalAnswer");
    expect(toolOutput).not.toContain("x + 2 = 6");
    expect(traceStore.records).toEqual([expect.objectContaining({
      id: "turn_hint_01",
      stage: "learning_hint",
      status: "completed",
      toolTrace: [{ name: "get_practice_exercise", callId: "call_exercise" }]
    })]);
  });

  it("fails closed if the model dumps the final answer", async () => {
    const unsafe = { ...hint, question: "The answer is x = 4." };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_exercise", model: "gpt-5.6-sol",
        output: [{
          type: "function_call", call_id: "call_exercise", name: "get_practice_exercise",
          arguments: JSON.stringify({ sessionId: "session_01", exerciseId: "linear_equation_01" })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_unsafe", model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(unsafe) }] }]
      });

    await expect(generatePracticeHint({
      session, client: { create }, traceStore: new CapturingAiTurnStore()
    })).rejects.toThrow(/revealed/i);
  });

  it("rejects a hint outside the exact active student context", async () => {
    const wrongSession: SessionRecord = {
      ...session,
      state: { ...session.state, phase: "HINT_USED", stateVersion: 11 }
    };

    await expect(generatePracticeHint({
      session: wrongSession,
      client: { create: vi.fn() },
      traceStore: new CapturingAiTurnStore()
    })).rejects.toThrow(/active Plan V2/i);
  });

  it("rejects a tool lookup for a different exercise", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      id: "resp_wrong_exercise",
      model: "gpt-5.6-sol",
      output: [{
        type: "function_call",
        call_id: "call_wrong_exercise",
        name: "get_practice_exercise",
        arguments: JSON.stringify({ sessionId: "session_01", exerciseId: "other_exercise" })
      }]
    });
    const traceStore = new CapturingAiTurnStore();

    await expect(generatePracticeHint({ session, client: { create }, traceStore }))
      .rejects.toThrow(/did not match/i);
    expect(traceStore.records).toEqual([expect.objectContaining({
      stage: "learning_hint",
      status: "failed",
      errorCode: "CONTEXT_MISMATCH"
    })]);
  });
});
