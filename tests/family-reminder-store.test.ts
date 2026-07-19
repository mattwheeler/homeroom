import { describe, expect, it } from "vitest";

import type { FamilyReminder } from "../lib/domain/family-reminder";
import type { PendingAction } from "../lib/security/approval";
import {
  D1FamilyReminderStore,
  type SentFamilyReminderWrite,
  type StagedFamilyReminderWrite
} from "../lib/storage/family-reminder-store";
import type { D1BoundStatementLike, D1DatabaseLike, D1RunResult } from "../lib/storage/session-store";

const reminder: FamilyReminder = {
  reminderVersion: 1,
  recipient: { id: "guardian_matt", name: "Matt", relationship: "Parent" },
  sender: { id: "student_emily", name: "Emily" },
  task: { id: "google_classroom:coursework:physical_form", label: "Band physical form", dueAt: "2026-07-24T17:00:00" },
  source: { provider: "google_classroom", externalId: "physical_form", label: "Concert Band - Period 6 · Google Classroom" },
  title: "Band physical form may need your help",
  message: "Emily found a source-backed Concert Band item that may need a parent or guardian: Band physical form. It is due Friday, July 24.",
  createdAt: "2026-07-18T12:01:00.000Z"
};
const pending: PendingAction = {
  id: "action_123456789012345678901234", sessionId: "session_01", actor: "student_emily",
  actionType: "SEND_GUARDIAN_TASK_REMINDER", argsHash: "a".repeat(64),
  expected: { stateVersion: 5, sourceVersion: 1, planVersion: 0 },
  nonceHash: "b".repeat(64), idempotencyKey: "c".repeat(64), expiresAt: Date.parse("2026-07-18T12:06:00.000Z")
};

function fakeDatabase(firstRow?: Record<string, unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const batches: D1BoundStatementLike[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) { return { bind(...values) { calls.push({ sql, values }); return { async run() { return { success: true, meta: { changes: 1 } }; }, async first<T>() { return (firstRow ?? null) as T | null; } }; } }; },
    async batch(statements) { batches.push(statements); return statements.map(() => ({ success: true, meta: { changes: 1 } } satisfies D1RunResult)); }
  };
  return { database, calls, batches };
}

describe("D1 Family reminder store", () => {
  it("stages without updating the Golden session", async () => {
    const { database, calls, batches } = fakeDatabase();
    const write: StagedFamilyReminderWrite = { sessionId: "session_01", expectedStateVersion: 5, expectedPlanVersion: 0, reminder, pending, createdAt: reminder.createdAt };
    await new D1FamilyReminderStore(database).stageReminder(write);
    expect(batches).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("INSERT INTO pending_actions");
    expect(calls[0]?.sql).not.toContain("UPDATE demo_sessions");
  });

  it("atomically inserts the guardian inbox item, consumes approval, and audits delivery", async () => {
    const { database, calls, batches } = fakeDatabase();
    const write: SentFamilyReminderWrite = {
      sessionId: "session_01", expectedStateVersion: 5, expectedPlanVersion: 0,
      reminder, pending, notificationId: "notification_01", recipientId: "guardian_matt", sentBy: "student_emily",
      sentAt: "2026-07-18T12:02:00.000Z", auditEventId: "audit_reminder"
    };
    const result = await new D1FamilyReminderStore(database).sendReminder(write);
    expect(result).toMatchObject({ sent: true, recipient: "Matt", proof: { stateVersion: 5 } });
    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO guardian_notifications"),
      expect.stringContaining("UPDATE pending_actions"),
      expect.stringContaining("INSERT INTO audit_events")
    ]));
    expect(calls.every((call) => !call.sql.includes(reminder.message))).toBe(true);
  });
});
