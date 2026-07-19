import { describe, expect, it } from "vitest";

import type { LearningCoachTurn } from "../lib/ai/learning-coach";
import {
  completeLearningSession,
  createLearningSession
} from "../lib/domain/learning-session";
import {
  D1LearningStore,
  LearningStoreError,
  type AppendLearningTurnWrite,
  type CompleteLearningWrite,
  type StartLearningWrite
} from "../lib/storage/learning-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult,
  SessionRecord
} from "../lib/storage/session-store";

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "hash",
  expiresAt: "2026-07-18T16:00:00.000Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z"
};

const initialTurn: LearningCoachTurn = {
  phase: "check_in",
  message: "Let’s start with one example.",
  question: "What do you notice?",
  encouragement: "This is a starting point, not a grade.",
  executiveSkill: "organization",
  nextAction: "Set up one example and identify what you notice.",
  visualScaffold: {
    kind: "sequence",
    title: "Start with one example",
    items: [
      { label: "Look", detail: "Notice the two sides." },
      { label: "Choose", detail: "Pick one next step." }
    ]
  },
  answerPolicy: "coach_not_complete"
};

function fakeDatabase(firstRow?: Record<string, unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const batches: D1BoundStatementLike[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes: 1 } }; },
            async first<T>() { return (firstRow ?? null) as T | null; }
          };
        }
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } } satisfies D1RunResult));
    }
  };
  return { database, calls, batches };
}

function learningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "learning_123456789012345678901234",
    demo_session_id: "session_01",
    student_id: "student_emily",
    course_id: "course_algebra_1",
    mission_id: "mission_algebra_balance_v1",
    objective_id: "objective_equations_stay_balanced",
    status: "active",
    duration_minutes: 10,
    support_preference: "example_first",
    source_label: "Homeroom readiness mission",
    started_at: "2026-07-18T12:00:00.000Z",
    target_ends_at: "2026-07-18T12:10:00.000Z",
    completed_at: null,
    turn_count: 0,
    context_json: JSON.stringify([{ role: "coach", content: "Start here." }]),
    summary_json: null,
    ...overrides
  };
}

describe("D1 Learning continuity store", () => {
  it("starts an independent timed session without updating Golden state", async () => {
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const { database, calls } = fakeDatabase();
    const write: StartLearningWrite = {
      learningSession: created.learningSession,
      initialTurn,
      updatedAt: "2026-07-18T12:00:10.000Z"
    };

    await new D1LearningStore(database).startSession(write);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("INSERT INTO learning_sessions");
    expect(calls[0]?.sql).not.toContain("UPDATE demo_sessions");
    expect(JSON.stringify(calls[0]?.values)).not.toContain("previous_response_id");
  });

  it("atomically clears active dialogue and saves only summary, progress, and explicit memory", async () => {
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const completed = completeLearningSession({
      learningSession: { ...created.learningSession, turnCount: 3 },
      priorSessionsCompleted: 0,
      now: () => new Date("2026-07-18T12:09:00.000Z"),
      randomUUID: () => "abcdefabcdefabcdefabcdef"
    });
    const write: CompleteLearningWrite = {
      demoSessionId: "session_01",
      learningSessionId: created.learningSession.id,
      expectedTurnCount: 3,
      completedAt: "2026-07-18T12:09:00.000Z",
      summary: completed.summary,
      signal: completed.signal,
      progress: completed.progress,
      memoryEventId: "memory_event_01"
    };
    const { database, calls, batches } = fakeDatabase();

    await new D1LearningStore(database).completeSession(write);

    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("UPDATE learning_sessions"),
      expect.stringContaining("INSERT INTO learner_signals"),
      expect.stringContaining("INSERT INTO learning_progress"),
      expect.stringContaining("INSERT INTO learner_memory_events")
    ]));
    expect(calls.find((call) => call.sql.includes("UPDATE learning_sessions"))?.values)
      .toContain("[]");
    expect(calls.every((call) => !call.sql.includes("My private answer"))).toBe(true);
  });

  it("queries learner context by student and optional course scope", async () => {
    const { database, calls } = fakeDatabase();
    await new D1LearningStore(database).listLearnerContext("student_emily", "course_algebra_1");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("FROM learner_signals");
    expect(calls[0]?.sql).toContain("student_id = ?");
    expect(calls[0]?.sql).toContain("scope_course_id = ?");
    expect(calls[1]?.sql).toContain("FROM learning_progress");
  });

  it("finds and parses both active and summarized Learning sessions", async () => {
    const summary = {
      courseName: "Algebra I",
      missionTitle: "Equations stay balanced",
      objective: "Explain why equivalent changes preserve equality.",
      objectiveStatus: "exploring",
      completedTurns: 2,
      sourceLabel: "Homeroom readiness mission",
      memoryStatement: "One worked example before independent practice."
    };
    const { database } = fakeDatabase(learningRow({
      status: "completed",
      completed_at: "2026-07-18T12:09:00.000Z",
      summary_json: JSON.stringify(summary)
    }));

    await expect(new D1LearningStore(database).findSession("session_01", "learning_123456789012345678901234"))
      .resolves.toMatchObject({ status: "completed", summary });

    const missing = fakeDatabase();
    await expect(new D1LearningStore(missing.database).findSession("session_01", "missing"))
      .resolves.toBeNull();
  });

  it("appends a bounded dialogue turn with optimistic concurrency", async () => {
    const priorDialogue = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "coach" : "student",
      content: `turn ${index}`
    }));
    const { database, calls } = fakeDatabase(learningRow({
      turn_count: 2,
      context_json: JSON.stringify(priorDialogue)
    }));
    const write: AppendLearningTurnWrite = {
      demoSessionId: "session_01",
      learningSessionId: "learning_123456789012345678901234",
      expectedTurnCount: 2,
      studentResponse: "I would subtract three from both sides.",
      coachTurn: initialTurn,
      nextTurnCount: 3,
      updatedAt: "2026-07-18T12:03:00.000Z"
    };

    await new D1LearningStore(database).appendTurn(write);

    const update = calls.find((call) => call.sql.includes("UPDATE learning_sessions"));
    const persisted = JSON.parse(String(update?.values[1])) as Array<{ content: string }>;
    expect(persisted).toHaveLength(8);
    expect(persisted.at(-2)?.content).toBe(write.studentResponse);
    expect(persisted.at(-1)?.content).toContain(initialTurn.question);
  });

  it("rejects stale Learning turns and failed single-row writes", async () => {
    const stale = fakeDatabase(learningRow({ turn_count: 1 }));
    await expect(new D1LearningStore(stale.database).appendTurn({
      demoSessionId: "session_01",
      learningSessionId: "learning_123456789012345678901234",
      expectedTurnCount: 2,
      studentResponse: "response",
      coachTurn: initialTurn,
      nextTurnCount: 3,
      updatedAt: "2026-07-18T12:03:00.000Z"
    })).rejects.toThrow(/no longer current/i);

    const failedDatabase: D1DatabaseLike = {
      prepare() {
        return {
          bind() {
            return {
              async run() { return { success: false, meta: { changes: 0 } }; },
              async first<T>() { return null as T | null; }
            };
          }
        };
      }
    };
    const created = createLearningSession({
      session,
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: []
    });
    await expect(new D1LearningStore(failedDatabase).startSession({
      learningSession: created.learningSession,
      initialTurn,
      updatedAt: "2026-07-18T12:00:00.000Z"
    })).rejects.toThrow(/unable to start/i);
  });

  it("returns empty unscoped context when no durable records exist", async () => {
    const { database, calls } = fakeDatabase();
    await expect(new D1LearningStore(database).listLearnerContext("student_emily"))
      .resolves.toEqual({ signals: [], progress: [] });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.values.length === 1)).toBe(true);
    expect(calls.every((call) => !call.sql.includes("scope_course_id = ?"))).toBe(true);
  });

  it("deletes a visible learner signal and writes its audit event atomically", async () => {
    const { database, calls, batches } = fakeDatabase();
    await new D1LearningStore(database).deleteSignal(
      "student_emily",
      "signal_algebra",
      "2026-07-18T12:10:00.000Z",
      "memory_event_delete_01"
    );
    expect(batches[0]).toHaveLength(2);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("UPDATE learner_signals"),
      expect.stringContaining("INSERT INTO learner_memory_events")
    ]));
  });

  it("fails closed when the database cannot provide atomic Learning writes", async () => {
    const noBatch: D1DatabaseLike = {
      prepare() {
        return {
          bind() {
            return {
              async run() { return { success: true, meta: { changes: 1 } }; },
              async first<T>() { return null as T | null; }
            };
          }
        };
      }
    };

    await expect(new D1LearningStore(noBatch).deleteSignal(
      "student_emily", "signal_algebra", "2026-07-18T12:10:00.000Z", "memory_event_delete_01"
    )).rejects.toEqual(expect.objectContaining({
      name: "LearningStoreError",
      message: expect.stringMatching(/atomic batch/i)
    } satisfies Partial<LearningStoreError>));
  });
});
