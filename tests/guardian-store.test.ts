import { describe, expect, it } from "vitest";

import type { GuardianProjection } from "../lib/domain/guardian-projection";
import type { PendingAction } from "../lib/security/approval";
import {
  D1GuardianProjectionStore,
  type PublishedGuardianProjectionWrite,
  type StagedGuardianPreviewWrite
} from "../lib/storage/guardian-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

const projection: GuardianProjection = {
  projectionVersion: 1,
  recipient: { id: "guardian_matt", name: "Matt", relationship: "Parent" },
  student: { id: "student_emily", name: "Emily", grade: 9 },
  headline: "Emily is on track for band camp.",
  shared: {
    bandCamp: { date: "2026-08-03", checkIn: "07:15", start: "08:00" },
    morningPlan: { planVersion: 2, wake: "06:15", leave: "06:45", status: "saved" },
    practice: { course: "Algebra I", status: "completed", summary: "One summer refresher completed." },
    guardianTask: { label: "Complete the band physical form", dueAt: "2026-07-24T17:00:00-05:00", status: "needs_guardian" }
  },
  privacy: { excluded: ["Algebra answer", "step-by-step work", "attempt count", "hint count", "private coaching"] },
  generatedAt: "2026-07-18T12:13:00.000Z"
};

const pending: PendingAction = {
  id: "action_123456789012345678901234",
  sessionId: "session_01",
  actor: "student_emily",
  actionType: "PUBLISH_GUARDIAN",
  argsHash: "a".repeat(64),
  expected: { stateVersion: 13, sourceVersion: 2, planVersion: 2 },
  nonceHash: "b".repeat(64),
  idempotencyKey: "c".repeat(64),
  expiresAt: Date.parse("2026-07-18T12:18:00.000Z")
};

const projectionHash = "d".repeat(64);

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

describe("D1 guardian projection store", () => {
  it("atomically stages the exact preview and pending approval", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1GuardianProjectionStore(database);
    const write: StagedGuardianPreviewWrite = {
      sessionId: "session_01",
      previousStateVersion: 12,
      nextState: { phase: "GUARDIAN_PREVIEWED", stateVersion: 13, sourceVersion: 2, activePlanVersion: 2 },
      projection,
      projectionHash,
      pending,
      createdAt: "2026-07-18T12:13:00.000Z"
    };

    await store.stagePreview(write);

    expect(batches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("UPDATE demo_sessions");
    expect(calls[1]?.sql).toContain("INSERT INTO pending_actions");
    expect(calls[1]?.values).toContain(projectionHash);
    expect(calls[1]?.values).not.toContain("fixed-guardian-receipt");
  });

  it("reconstructs only the server-stored preview and hashed approval material", async () => {
    const { database } = fakeDatabase({
      id: pending.id,
      session_id: pending.sessionId,
      actor_id: pending.actor,
      action_type: pending.actionType,
      args_hash: pending.argsHash,
      expected_state_version: 13,
      expected_plan_version: 2,
      expected_source_version: 2,
      approval_nonce_hash: pending.nonceHash,
      idempotency_key: pending.idempotencyKey,
      expires_at: "2026-07-18T12:18:00.000Z",
      consumed_at: null,
      result_json: JSON.stringify({ projection, projectionHash, publishResult: null })
    });
    const store = new D1GuardianProjectionStore(database);

    await expect(store.findPending("session_01", pending.id)).resolves.toEqual({
      pending,
      projection,
      projectionHash,
      consumedAt: null,
      publishResult: null
    });
  });

  it("atomically publishes, consumes approval, advances state, and records audit evidence", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1GuardianProjectionStore(database);
    const write: PublishedGuardianProjectionWrite = {
      sessionId: "session_01",
      previousStateVersion: 13,
      nextState: { phase: "GUARDIAN_PUBLISHED", stateVersion: 14, sourceVersion: 2, activePlanVersion: 2 },
      projection,
      projectionHash,
      pending,
      approvedBy: "student_emily",
      publishedAt: "2026-07-18T12:14:00.000Z",
      auditEventId: "audit_guardian_publish"
    };

    const result = await store.publishProjection(write);

    expect(result).toMatchObject({
      published: true,
      phase: "GUARDIAN_PUBLISHED",
      recipient: "Matt",
      proof: { projectionHash, stateVersion: 14 }
    });
    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO guardian_projections"),
      expect.stringContaining("UPDATE pending_actions"),
      expect.stringContaining("UPDATE demo_sessions"),
      expect.stringContaining("INSERT INTO audit_events")
    ]));
    expect(calls.some((call) => call.values.includes("GUARDIAN_SUMMARY_PUBLISHED"))).toBe(true);
    expect(calls.every((call) => !call.sql.includes(projectionHash))).toBe(true);
  });
});
