import { describe, expect, it } from "vitest";

import type { MorningPlan } from "../lib/ai/morning-plan";
import { createPendingAction } from "../lib/security/approval";
import { D1FocusBlockStore, type FocusBlockRecord } from "../lib/storage/focus-block-store";
import { D1GuardianInboxStore } from "../lib/storage/guardian-inbox-store";
import { D1LiveDayPlanStore } from "../lib/storage/live-day-plan-store";
import { D1PrincipalStore } from "../lib/storage/principal-store";
import type { D1BoundStatementLike, D1DatabaseLike, D1RunResult } from "../lib/storage/session-store";

function fakeDatabase(options: {
  rows?: Array<Record<string, unknown> | null>;
  run?: D1RunResult;
  batch?: D1RunResult[];
} = {}) {
  const rows = [...(options.rows ?? [])];
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      return { bind(...values) {
        calls.push({ sql, values });
        return {
          async run() { return options.run ?? { success: true, meta: { changes: 1 } }; },
          async first<T>() { return (rows.shift() ?? null) as T | null; }
        };
      } };
    },
    async batch(statements: D1BoundStatementLike[]) {
      return options.batch ?? statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  return { database, calls };
}

const focus: FocusBlockRecord = {
  id: "focus_01", studentId: "student_01", sessionId: "session_01", taskId: "task_01",
  taskTitle: "Summer Reading", courseName: "English I", sourceProvider: "google_classroom",
  sourceExternalId: "coursework_01", estimatedMinutes: 20, selectedMinutes: 15,
  elapsedSeconds: 720, completedChunkIds: ["chunk_1"], completedChunkCount: 1,
  plannedChunkCount: 3, taskKind: "writing", sourceStatus: "Not submitted",
  completedAt: "2026-07-19T16:00:00.000Z"
};

const plan: MorningPlan = {
  title: "Today", intro: "Four steps", guardianNote: "No guardian action", encouragement: "Begin small", approvalPrompt: "Use it?",
  steps: ["08:00", "08:05", "08:20", "08:25"].map((time, index) => ({
    time, title: `Step ${index + 1}`, detail: "A source-backed action", sourceLabel: "Google Classroom"
  }))
};

describe("D1 product-loop stores", () => {
  it("persists and reads focus history with bound values", async () => {
    const { database, calls } = fakeDatabase({ rows: [{ records_json: JSON.stringify([focus]) }] });
    const store = new D1FocusBlockStore(database);
    await expect(store.save(focus)).resolves.toEqual(focus);
    await expect(store.listRecent("student_01")).resolves.toEqual([focus]);
    expect(calls[0]?.values).toContain("student_01");
    expect(calls[1]?.values).toEqual(["student_01"]);
  });

  it("fails closed when focus persistence fails and returns an empty history", async () => {
    const failed = fakeDatabase({ run: { success: false } });
    await expect(new D1FocusBlockStore(failed.database).save(focus)).rejects.toThrow(/could not be saved/);
    const empty = fakeDatabase();
    await expect(new D1FocusBlockStore(empty.database).listRecent("student_01")).resolves.toEqual([]);
  });

  it("reads, acknowledges, and records only recipient-scoped guardian notes", async () => {
    const payload = {
      title: "A form needs help", message: "Emily sent this note.", taskLabel: "Physical form",
      sourceLabel: "Concert Band", studentId: "student_01"
    };
    const row = { records_json: JSON.stringify([{
      id: "notification_01", recipient_id: "guardian_01", student_id: "student_01",
      notification_json: JSON.stringify(payload), sent_at: "2026-07-19T16:00:00.000Z", read_at: null
    }]) };
    const { database, calls } = fakeDatabase({ rows: [row, row] });
    const store = new D1GuardianInboxStore(database);
    await expect(store.list("guardian_01")).resolves.toEqual([expect.objectContaining({ title: payload.title })]);
    await expect(store.acknowledge("guardian_01", "notification_01", "2026-07-19T17:00:00.000Z"))
      .resolves.toEqual(expect.objectContaining({ id: "notification_01" }));
    await expect(store.recordDigest({
      id: "digest_01", recipientId: "guardian_01", recipientEmail: "guardian@example.com",
      notificationIds: ["notification_01"], status: "sent", providerMessageId: "email_01",
      createdAt: "2026-07-19T17:00:00.000Z"
    })).resolves.toBeUndefined();
    expect(calls.some((call) => call.values.includes("guardian_01"))).toBe(true);
  });

  it("filters malformed inbox payloads and lists digest recipients", async () => {
    const { database } = fakeDatabase({ rows: [
      { records_json: JSON.stringify([{ id: "bad", recipient_id: "g", notification_json: "{", sent_at: "now" }]) },
      { records_json: JSON.stringify([{ recipientId: "g", recipientEmail: "g@example.com" }]) }
    ] });
    const store = new D1GuardianInboxStore(database);
    await expect(store.list("g")).resolves.toEqual([]);
    await expect(store.listDigestRecipients()).resolves.toEqual([{ recipientId: "g", recipientEmail: "g@example.com" }]);
  });

  it("normalizes older reminder payload shapes and fails closed on unsuccessful inbox writes", async () => {
    const legacyRows = { records_json: JSON.stringify([
      {
        id: "legacy_1", recipient_id: "g", student_id: "", sent_at: "2026-07-19T16:00:00.000Z",
        read_at: "2026-07-19T17:00:00.000Z",
        notification_json: JSON.stringify({
          studentId: "s", body: "Please look at this.", task: { label: "Permission form" },
          source: { label: "English I" }
        })
      },
      {
        id: "legacy_2", recipient_id: "g", student_id: "s", sent_at: "2026-07-19T16:00:00.000Z",
        read_at: null, notification_json: JSON.stringify({ taskLabel: "A family note" })
      }
    ]) };
    const readable = fakeDatabase({ rows: [legacyRows] });
    await expect(new D1GuardianInboxStore(readable.database).list("g")).resolves.toEqual([
      expect.objectContaining({ studentId: "s", message: "Please look at this.", taskLabel: "Permission form", sourceLabel: "English I", readAt: "2026-07-19T17:00:00.000Z" }),
      expect.objectContaining({ title: "A family note", message: "", sourceLabel: "Student-approved reminder", readAt: null })
    ]);

    const failed = fakeDatabase({ run: { success: false } });
    const failedStore = new D1GuardianInboxStore(failed.database);
    await expect(failedStore.acknowledge("g", "n", "now")).resolves.toBeNull();
    await expect(failedStore.recordDigest({
      id: "d", recipientId: "g", recipientEmail: "g@example.com", notificationIds: [],
      status: "failed", providerMessageId: null, createdAt: "now"
    })).rejects.toThrow(/could not be recorded/);
    const empty = new D1GuardianInboxStore(fakeDatabase().database);
    await expect(empty.list("g")).resolves.toEqual([]);
    await expect(empty.listDigestRecipients()).resolves.toEqual([]);
  });

  it("creates stable household principals for either verified family role", async () => {
    const first = fakeDatabase();
    const studentStore = new D1PrincipalStore(first.database, {
      guardianEmail: "matt@example.com", studentEmail: "emily@example.com",
      guardianName: "Matt", studentName: "Emily", householdName: "Wheeler"
    });
    const student = await studentStore.resolve({ provider: "google", subject: "sub-emily", email: "Emily@example.com", role: "student" });
    expect(student.principalId).toBe(student.studentId);
    expect(student.guardianId).toMatch(/^principal_/);

    const second = fakeDatabase();
    const guardian = await new D1PrincipalStore(second.database, {
      guardianEmail: "matt@example.com", studentEmail: "emily@example.com"
    }).resolve({ provider: "google", subject: "sub-matt", email: "matt@example.com", role: "guardian" });
    expect(guardian.principalId).toBe(guardian.guardianId);
    await expect(studentStore.resolve({ provider: "google", subject: "other", email: "other@example.com", role: "student" }))
      .rejects.toThrow(/not linked/);
  });

  it("stages, reads, and atomically approves versioned live plans", async () => {
    const created = await createPendingAction({
      sessionId: "session_01", actor: "student_01", actionType: "APPROVE_LIVE_DAY_PLAN",
      args: { planVersion: 1, sourceFingerprint: "a".repeat(64), plan },
      expected: { stateVersion: 4, sourceVersion: 1, planVersion: 1 },
      nowMs: Date.parse("2026-07-19T16:00:00.000Z"), nonce: "live-receipt"
    });
    const stored = {
      kind: "live_day_plan", plan, planVersion: 1, sourceFingerprint: "a".repeat(64),
      proposedAt: "2026-07-19T16:00:00.000Z", approvalResult: null
    };
    const pendingRow = {
      id: created.pending.id, session_id: "session_01", actor_id: "student_01",
      action_type: created.pending.actionType, args_hash: created.pending.argsHash,
      expected_state_version: 4, expected_plan_version: 1, expected_source_version: 1,
      approval_nonce_hash: created.pending.nonceHash, idempotency_key: created.pending.idempotencyKey,
      expires_at: new Date(created.pending.expiresAt).toISOString(), consumed_at: null,
      result_json: JSON.stringify(stored)
    };
    const { database } = fakeDatabase({ rows: [{ latest_version: null }, pendingRow] });
    const store = new D1LiveDayPlanStore(database);
    await expect(store.latestVersion("session_01")).resolves.toBe(0);
    await expect(store.stage({
      sessionId: "session_01", plan, planVersion: 1, sourceFingerprint: "a".repeat(64),
      pending: created.pending, proposedAt: stored.proposedAt
    })).resolves.toBeUndefined();
    await expect(store.findPending("session_01", created.pending.id)).resolves.toEqual(expect.objectContaining({ planVersion: 1 }));
    await expect(store.approve({
      sessionId: "session_01", plan, planVersion: 1, sourceFingerprint: "a".repeat(64),
      pending: created.pending, approvedBy: "student_01", proposedAt: stored.proposedAt,
      approvedAt: "2026-07-19T16:01:00.000Z", auditEventId: "audit_01"
    })).resolves.toEqual(expect.objectContaining({ saved: true, planVersion: 1 }));
  });
});
