import { describe, expect, it } from "vitest";

import {
  D1PracticeStore,
  type CompletePracticeWrite,
  type RecordPracticeAttemptWrite,
  type StartPracticeWrite
} from "../lib/storage/practice-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

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

describe("D1 private practice store", () => {
  it("atomically starts one exercise and advances to HINT_USED", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1PracticeStore(database);
    const write: StartPracticeWrite = {
      sessionId: "session_01",
      previousStateVersion: 10,
      nextState: { phase: "HINT_USED", stateVersion: 11, sourceVersion: 2, activePlanVersion: 2 },
      exerciseId: "linear_equation_01",
      startedAt: "2026-07-18T12:10:00.000Z"
    };

    await store.startPractice(write);

    expect(batches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("UPDATE demo_sessions");
    expect(calls[0]?.sql).toContain("state_version = ?");
    expect(calls[1]?.sql).toContain("INSERT INTO practice_results");
    expect(calls[1]?.sql).toContain("status");
    expect(calls[1]?.values).toContain("linear_equation_01");
  });

  it("reconstructs server-owned progress", async () => {
    const { database } = fakeDatabase({
      session_id: "session_01",
      exercise_id: "linear_equation_01",
      status: "in_progress",
      hints_used: 1,
      attempts: 2,
      validated_steps_json: JSON.stringify(["divide_both_sides_by_3"]),
      final_answer: null,
      completed_at: null
    });
    const store = new D1PracticeStore(database);

    await expect(store.findProgress("session_01", "linear_equation_01")).resolves.toEqual({
      sessionId: "session_01",
      exerciseId: "linear_equation_01",
      status: "in_progress",
      hintsUsed: 1,
      attempts: 2,
      validatedSteps: ["divide_both_sides_by_3"],
      finalAnswer: null,
      completedAt: null
    });
  });

  it("returns null when the exercise has not started", async () => {
    const { database } = fakeDatabase();
    const store = new D1PracticeStore(database);
    await expect(store.findProgress("session_01", "linear_equation_01")).resolves.toBeNull();
  });

  it("records an attempt with compare-and-set guards", async () => {
    const { database, calls } = fakeDatabase();
    const store = new D1PracticeStore(database);
    const write: RecordPracticeAttemptWrite = {
      sessionId: "session_01",
      exerciseId: "linear_equation_01",
      expectedAttempts: 0,
      expectedValidatedSteps: [],
      nextAttempts: 1,
      nextValidatedSteps: ["divide_both_sides_by_3"]
    };

    await store.recordAttempt(write);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("UPDATE practice_results");
    expect(calls[0]?.sql).toContain("attempts = ?");
    expect(calls[0]?.sql).toContain("validated_steps_json = ?");
    expect(calls[0]?.values).toContain(JSON.stringify([]));
  });

  it("atomically completes practice, advances state, and writes audit proof", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1PracticeStore(database);
    const write: CompletePracticeWrite = {
      sessionId: "session_01",
      previousStateVersion: 11,
      nextState: { phase: "PRACTICE_COMPLETE", stateVersion: 12, sourceVersion: 2, activePlanVersion: 2 },
      exerciseId: "linear_equation_01",
      expectedAttempts: 1,
      expectedValidatedSteps: ["divide_both_sides_by_3"],
      nextAttempts: 2,
      nextValidatedSteps: ["divide_both_sides_by_3", "final_answer_4"],
      finalAnswer: "4",
      completedAt: "2026-07-18T12:12:00.000Z",
      auditEventId: "audit_practice_01"
    };

    await store.completePractice(write);

    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("UPDATE practice_results"),
      expect.stringContaining("UPDATE demo_sessions"),
      expect.stringContaining("INSERT INTO audit_events")
    ]));
    expect(calls.some((call) => call.values.includes("PRACTICE_COMPLETED"))).toBe(true);
    expect(calls.every((call) => !call.sql.includes("x = 4"))).toBe(true);
  });
});
