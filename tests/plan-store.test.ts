import { describe, expect, it } from "vitest";

import type { MorningPlan } from "../lib/ai/morning-plan";
import type { SessionState } from "../lib/domain/state-machine";
import type { PendingAction } from "../lib/security/approval";
import {
  D1PlanApprovalStore,
  type ApprovedPlanWrite,
  type StagedPlanWrite
} from "../lib/storage/plan-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

const plan: MorningPlan = {
  title: "Your band-camp morning",
  intro: "A calm start.",
  steps: [
    { time: "06:30", title: "Wake up", detail: "Get ready.", sourceLabel: "Homeroom" },
    { time: "06:45", title: "Bag check", detail: "Check your bag.", sourceLabel: "Packing list" },
    { time: "07:00", title: "Leave", detail: "Leave home.", sourceLabel: "Calendar" },
    { time: "07:30", title: "Check in", detail: "Check in.", sourceLabel: "Calendar" }
  ],
  guardianNote: "Matt owns the physical form.",
  encouragement: "You are ready.",
  approvalPrompt: "Save this plan?"
};

const pending: PendingAction = {
  id: "action_123456789012345678901234",
  sessionId: "session_01",
  actor: "student_emily",
  actionType: "APPROVE_PLAN_V1",
  argsHash: "a".repeat(64),
  expected: { stateVersion: 6, sourceVersion: 1, planVersion: 1 },
  nonceHash: "b".repeat(64),
  idempotencyKey: "c".repeat(64),
  expiresAt: Date.parse("2026-07-18T12:10:00.000Z")
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

describe("D1 plan approval store", () => {
  it("atomically stages the proposal and conditional session transition with bound parameters", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1PlanApprovalStore(database);
    const nextState: SessionState = {
      phase: "PLAN_PROPOSED", stateVersion: 6, sourceVersion: 1, activePlanVersion: null
    };
    const write: StagedPlanWrite = {
      sessionId: "session_01",
      previousStateVersion: 5,
      nextState,
      plan,
      pending,
      createdAt: "2026-07-18T12:05:00.000Z"
    };

    await store.stageProposal(write);

    expect(batches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("UPDATE demo_sessions");
    expect(calls[0]?.sql).toContain("state_version = ?");
    expect(calls[0]?.values).toContain(5);
    expect(calls[1]?.sql).toContain("INSERT INTO pending_actions");
    expect(calls[1]?.sql).toContain("SELECT");
    expect(calls[1]?.values).toContain(pending.nonceHash);
    expect(calls[1]?.values).not.toContain("fixed-approval-receipt");
  });

  it("reconstructs pending approval material without exposing a plaintext receipt", async () => {
    const { database } = fakeDatabase({
      id: pending.id,
      session_id: pending.sessionId,
      actor_id: pending.actor,
      action_type: pending.actionType,
      args_hash: pending.argsHash,
      expected_state_version: 6,
      expected_plan_version: 1,
      expected_source_version: 1,
      approval_nonce_hash: pending.nonceHash,
      idempotency_key: pending.idempotencyKey,
      expires_at: "2026-07-18T12:10:00.000Z",
      consumed_at: null,
      result_json: JSON.stringify({ plan })
    });
    const store = new D1PlanApprovalStore(database);

    await expect(store.findPending("session_01", pending.id)).resolves.toEqual({
      pending,
      plan,
      consumedAt: null,
      approvalResult: null
    });
  });

  it("atomically saves Plan V1, consumes the receipt, advances state, and writes audit evidence", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1PlanApprovalStore(database);
    const write: ApprovedPlanWrite = {
      sessionId: "session_01",
      previousStateVersion: 6,
      nextState: { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 },
      plan,
      pending,
      approvedBy: "student_emily",
      approvedAt: "2026-07-18T12:06:00.000Z",
      auditEventId: "audit_01"
    };

    const result = await store.approvePlan(write);

    expect(result).toMatchObject({ saved: true, planVersion: 1, phase: "PLAN_V1_SAVED" });
    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO plan_versions"),
      expect.stringContaining("UPDATE pending_actions"),
      expect.stringContaining("UPDATE demo_sessions"),
      expect.stringContaining("INSERT INTO audit_events")
    ]));
    expect(calls.every((call) => !call.sql.includes(pending.argsHash))).toBe(true);
  });
});
