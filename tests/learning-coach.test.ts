import { describe, expect, it, vi } from "vitest";

import {
  generateLearningCoachTurn,
  learningCoachTurnSchema
} from "../lib/ai/learning-coach";
import { createLearningSession, type LearnerSignal } from "../lib/domain/learning-session";
import { getLearningTrack } from "../lib/domain/learning-tracks";
import type { AiTurnRecord, AiTurnStore } from "../lib/storage/ai-turn-store";
import type { SessionRecord } from "../lib/storage/session-store";

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "hash",
  expiresAt: "2026-07-18T14:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z"
};

class CapturingAiTurnStore implements AiTurnStore {
  records: AiTurnRecord[] = [];
  async record(record: AiTurnRecord) { this.records.push(record); }
}

const priorSignal: LearnerSignal = {
  id: "signal_algebra",
  studentId: "student_emily",
  scopeCourseId: "course_algebra_1",
  signalType: "support_preference",
  statement: "One worked example before independent practice.",
  evidenceKind: "student_stated_preference",
  evidenceLearningSessionId: "learning_previous",
  confidence: 1,
  visibility: "student_private",
  status: "active",
  learnedAt: "2026-07-17T12:00:00.000Z",
  expiresAt: "2026-10-15T12:00:00.000Z"
};

describe("live multi-turn Learning coach", () => {
  it("uses one strict read-only context tool and app-managed stateless context", async () => {
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [priorSignal],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const turn = learningCoachTurnSchema.parse({
      phase: "check_in",
      message: "We will use one quick example and then let you take the lead.",
      question: "When an equation changes on one side, what must happen on the other side?",
      encouragement: "There is no grade here—just a starting point.",
      answerPolicy: "coach_not_complete"
    });
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_context",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{
          type: "function_call",
          call_id: "call_context",
          name: "get_learning_session_context",
          arguments: JSON.stringify({
            sessionId: "session_01",
            learningSessionId: "learning_123456789012345678901234"
          })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_coach",
        model: "gpt-5.6-sol-2026-07-15",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(turn) }] }]
      });
    const traceStore = new CapturingAiTurnStore();

    const result = await generateLearningCoachTurn({
      session,
      learningSession: created.learningSession,
      track: getLearningTrack("course_algebra_1"),
      learnerContext: created.learnerContext,
      client: { create },
      traceStore,
      now: () => new Date("2026-07-18T12:00:10.000Z"),
      randomUUID: () => "turn_learning_01"
    });

    expect(result.turn).toEqual(turn);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      tools: [{ name: "get_learning_session_context", strict: true }],
      text: { format: { type: "json_schema", name: "learning_coach_turn", strict: true } }
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty("previous_response_id");
    const toolOutput = String(create.mock.calls[1][0].input.find(
      (item: { type?: string }) => item.type === "function_call_output"
    )?.output);
    expect(toolOutput).toContain("Homeroom readiness mission");
    expect(toolOutput).toContain(priorSignal.statement);
    expect(toolOutput).toContain('"remainingSeconds":590');
    expect(traceStore.records).toEqual([expect.objectContaining({
      id: "turn_learning_01",
      stage: "learning_session",
      status: "completed"
    })]);
  });

  it("rejects a model phase that disagrees with the server-owned clock", async () => {
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const wrongPhase = {
      phase: "recap",
      message: "Done.",
      question: "Ready to stop?",
      encouragement: "Nice work.",
      answerPolicy: "coach_not_complete"
    };
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_context", model: "gpt-5.6-sol",
        output: [{
          type: "function_call", call_id: "call_context", name: "get_learning_session_context",
          arguments: JSON.stringify({ sessionId: "session_01", learningSessionId: created.learningSession.id })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_bad", model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(wrongPhase) }] }]
      });

    await expect(generateLearningCoachTurn({
      session,
      learningSession: created.learningSession,
      track: created.track,
      learnerContext: [],
      client: { create },
      traceStore: new CapturingAiTurnStore(),
      now: () => new Date("2026-07-18T12:00:10.000Z")
    })).rejects.toThrow(/server-owned phase/i);
  });

  it("advances to diagnostic when Emily submits the first student turn", async () => {
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const diagnosticTurn = learningCoachTurnSchema.parse({
      phase: "diagnostic",
      message: "Right—both sides need the same change.",
      question: "What would you subtract from both sides of x + 3 = 7?",
      encouragement: "You are keeping the equation balanced.",
      answerPolicy: "coach_not_complete"
    });
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_context", model: "gpt-5.6-sol",
        output: [{
          type: "function_call", call_id: "call_context", name: "get_learning_session_context",
          arguments: JSON.stringify({ sessionId: "session_01", learningSessionId: created.learningSession.id })
        }]
      })
      .mockResolvedValueOnce({
        id: "resp_diagnostic", model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(diagnosticTurn) }] }]
      });

    const result = await generateLearningCoachTurn({
      session,
      learningSession: created.learningSession,
      track: created.track,
      learnerContext: [],
      studentResponse: "Subtract the same amount from the right side.",
      client: { create },
      traceStore: new CapturingAiTurnStore(),
      now: () => new Date("2026-07-18T12:00:10.000Z")
    });

    expect(result.turn.phase).toBe("diagnostic");
    const toolOutput = String(create.mock.calls[1][0].input.find(
      (item: { type?: string }) => item.type === "function_call_output"
    )?.output);
    expect(toolOutput).toContain('"phase":"diagnostic"');
    expect(toolOutput).toContain("Subtract the same amount from the right side.");
  });
});
