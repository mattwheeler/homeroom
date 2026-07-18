import { describe, expect, it } from "vitest";

import {
  D1ProofStore,
  type AdvanceProofWrite
} from "../lib/storage/proof-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

function fakeDatabase(firstRows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const batches: D1BoundStatementLike[][] = [];
  let rowIndex = 0;
  const database: D1DatabaseLike = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes: 1 } }; },
            async first<T>() { return (firstRows[rowIndex++] ?? null) as T | null; }
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

const write: AdvanceProofWrite = {
  sessionId: "session_01",
  previousStateVersion: 14,
  nextState: { phase: "COMPLETE", stateVersion: 15, sourceVersion: 2, activePlanVersion: 2 },
  openedAt: "2026-07-18T12:15:00.000Z",
  auditEventId: "audit_proof_opened"
};

describe("D1 proof store", () => {
  it("atomically completes the Golden session and records proof access", async () => {
    const { database, calls, batches } = fakeDatabase();
    await new D1ProofStore(database).advanceToProof(write);

    expect(batches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("UPDATE demo_sessions");
    expect(calls[1]?.sql).toContain("INSERT INTO audit_events");
    expect(calls[1]?.values).toContain("PROOF_VIEW_OPENED");
    expect(calls.every((call) => !call.sql.includes("session_01"))).toBe(true);
  });

  it("reads only allowlisted audit and model trace fields", async () => {
    const { database, calls } = fakeDatabase([
      {
        id: "session_01", actor_id: "student_emily",
        state_json: JSON.stringify({ phase: "COMPLETE", stateVersion: 15, sourceVersion: 2, activePlanVersion: 2 }),
        created_at: "2026-07-18T12:00:00.000Z", updated_at: "2026-07-18T12:15:00.000Z"
      },
      { records_json: JSON.stringify([{ sequence: 6, actor: "student_emily", eventType: "PROOF_VIEW_OPENED", stateVersion: 15, createdAt: "2026-07-18T12:15:00.000Z", approvalId: null, argsHash: null, projectionHash: null, sourceVersion: null, planVersion: null, exerciseId: null, grader: null, privateExcluded: null }]) },
      { records_json: JSON.stringify([{ stage: "morning_plan", model: "gpt-5.6-sol", status: "completed", responseIds: ["resp_1"], toolTrace: [{ name: "get_morning_plan_context", callId: "call_1" }], latencyMs: 100, inputTokens: 20, outputTokens: 10, cachedTokens: 0, createdAt: "2026-07-18T12:05:00.000Z" }]) }
    ]);
    const result = await new D1ProofStore(database).readEvidence("session_01");

    expect(result).toMatchObject({
      session: { phase: "COMPLETE", stateVersion: 15 },
      audits: [{ eventType: "PROOF_VIEW_OPENED" }],
      aiTurns: [{ stage: "morning_plan", responseIds: ["resp_1"] }]
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]?.sql).not.toContain("evidence_json AS");
    expect(calls[1]?.sql).not.toContain("validatedSteps");
    expect(calls[1]?.sql).not.toContain("hintsUsed");
    expect(calls[1]?.sql).not.toContain("attempts");
    expect(calls[2]?.sql).not.toContain("output_text");
    expect(calls.every((call) => call.values.includes("session_01"))).toBe(true);
  });
});
