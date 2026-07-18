import { describe, expect, it } from "vitest";

import {
  startPracticeSession,
  submitPracticeAttempt
} from "../lib/domain/practice";
import type {
  CompletePracticeWrite,
  PracticeProgress,
  PracticeStore,
  RecordPracticeAttemptWrite,
  StartPracticeWrite
} from "../lib/storage/practice-store";
import type { SessionRecord } from "../lib/storage/session-store";

function session(phase: "PLAN_V2_SAVED" | "HINT_USED" = "PLAN_V2_SAVED"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: "student_emily",
    role: "student",
    state: {
      phase,
      stateVersion: phase === "PLAN_V2_SAVED" ? 10 : 11,
      sourceVersion: 2,
      activePlanVersion: 2
    },
    csrfHash: "hash",
    expiresAt: "2026-07-18T14:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:09:00.000Z"
  };
}

class MemoryPracticeStore implements PracticeStore {
  progress: PracticeProgress | null = null;
  starts: StartPracticeWrite[] = [];
  attempts: RecordPracticeAttemptWrite[] = [];
  completions: CompletePracticeWrite[] = [];

  async startPractice(write: StartPracticeWrite) {
    this.starts.push(write);
    this.progress = {
      sessionId: write.sessionId,
      exerciseId: write.exerciseId,
      status: "in_progress",
      hintsUsed: 1,
      attempts: 0,
      validatedSteps: [],
      finalAnswer: null,
      completedAt: null
    };
  }

  async findProgress() { return this.progress; }

  async recordAttempt(write: RecordPracticeAttemptWrite) {
    this.attempts.push(write);
    if (!this.progress) throw new Error("missing progress");
    this.progress = {
      ...this.progress,
      attempts: write.nextAttempts,
      validatedSteps: write.nextValidatedSteps
    };
  }

  async completePractice(write: CompletePracticeWrite) {
    this.completions.push(write);
    if (!this.progress) throw new Error("missing progress");
    this.progress = {
      ...this.progress,
      status: "completed",
      attempts: write.nextAttempts,
      validatedSteps: write.nextValidatedSteps,
      finalAnswer: write.finalAnswer,
      completedAt: write.completedAt
    };
  }
}

describe("deterministic Algebra practice", () => {
  it("starts exactly one private exercise after Plan V2 is active", async () => {
    const store = new MemoryPracticeStore();
    const result = await startPracticeSession({
      session: session(),
      store,
      now: () => new Date("2026-07-18T12:10:00.000Z")
    });

    expect(result).toEqual({
      exercise: {
        id: "linear_equation_01",
        course: "Algebra I",
        prompt: "3(x + 2) = 18"
      },
      progress: { hintsUsed: 1, attempts: 0, stateVersion: 11 }
    });
    expect(store.starts).toEqual([expect.objectContaining({
      sessionId: "session_01",
      previousStateVersion: 10,
      nextState: expect.objectContaining({ phase: "HINT_USED", stateVersion: 11 }),
      exerciseId: "linear_equation_01"
    })]);
  });

  it("validates the inverse-operation step without using a model as the grader", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });

    const result = await submitPracticeAttempt({
      session: session("HINT_USED"),
      store,
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    });

    expect(result).toMatchObject({
      correct: true,
      completed: false,
      equation: "x + 2 = 6",
      next: { kind: "final_answer" },
      proof: { grader: "homeroom-deterministic-v1", attempts: 1, stateVersion: 11 }
    });
    expect(store.progress?.validatedSteps).toEqual(["divide_both_sides_by_3"]);
  });

  it("does not reveal or save the answer after an incorrect attempt", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });

    const result = await submitPracticeAttempt({
      session: session("HINT_USED"),
      store,
      attempt: { kind: "first_step", answer: "subtract_3" }
    });

    expect(result).toMatchObject({ correct: false, completed: false });
    expect(JSON.stringify(result)).not.toContain("x = 4");
    expect(store.completions).toHaveLength(0);
    expect(store.progress).toMatchObject({ attempts: 1, validatedSteps: [], finalAnswer: null });
  });

  it("rejects a final answer before the first step is validated", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });

    await expect(submitPracticeAttempt({
      session: session("HINT_USED"),
      store,
      attempt: { kind: "final_answer", answer: "4" }
    })).rejects.toThrow(/first step/i);
  });

  it("keeps the answer hidden after an incorrect final value", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });
    await submitPracticeAttempt({
      session: session("HINT_USED"), store,
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    });

    const result = await submitPracticeAttempt({
      session: session("HINT_USED"), store,
      attempt: { kind: "final_answer", answer: "5" }
    });

    expect(result).toMatchObject({ correct: false, completed: false });
    expect(JSON.stringify(result)).not.toContain("x = 4");
    expect(store.progress).toMatchObject({ attempts: 2, finalAnswer: null });
    expect(store.completions).toHaveLength(0);
  });

  it("rejects cross-student and missing-progress attempts", async () => {
    const otherStudent = session("HINT_USED");
    otherStudent.actorId = "student_other";
    await expect(submitPracticeAttempt({
      session: otherStudent,
      store: new MemoryPracticeStore(),
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    })).rejects.toThrow(/outside this student/i);

    await expect(submitPracticeAttempt({
      session: session("HINT_USED"),
      store: new MemoryPracticeStore(),
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    })).rejects.toThrow(/not found/i);
  });

  it("does not accept the first-step action twice", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });
    await submitPracticeAttempt({
      session: session("HINT_USED"), store,
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    });

    await expect(submitPracticeAttempt({
      session: session("HINT_USED"), store,
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    })).rejects.toThrow(/already been validated/i);
  });

  it("completes only after deterministic validation and records exact proof", async () => {
    const store = new MemoryPracticeStore();
    await startPracticeSession({ session: session(), store });
    await submitPracticeAttempt({
      session: session("HINT_USED"), store,
      attempt: { kind: "first_step", answer: "divide_both_sides_by_3" }
    });

    const result = await submitPracticeAttempt({
      session: session("HINT_USED"),
      store,
      attempt: { kind: "final_answer", answer: "4" },
      now: () => new Date("2026-07-18T12:12:00.000Z"),
      randomUUID: () => "audit_practice_01"
    });

    expect(result).toEqual({
      correct: true,
      completed: true,
      answer: "x = 4",
      celebration: "You solved it one step at a time.",
      proof: {
        grader: "homeroom-deterministic-v1",
        exerciseId: "linear_equation_01",
        hintsUsed: 1,
        attempts: 2,
        stateVersion: 12,
        completedAt: "2026-07-18T12:12:00.000Z"
      }
    });
    expect(store.completions).toEqual([expect.objectContaining({
      previousStateVersion: 11,
      nextState: expect.objectContaining({ phase: "PRACTICE_COMPLETE", stateVersion: 12 }),
      nextValidatedSteps: ["divide_both_sides_by_3", "final_answer_4"],
      finalAnswer: "4",
      auditEventId: "audit_practice_01"
    })]);
  });
});
