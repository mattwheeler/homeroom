import { describe, expect, it } from "vitest";

import {
  approveFamilyReminder,
  stageFamilyReminder
} from "../lib/domain/family-reminder";
import type {
  FamilyReminderStore,
  PendingFamilyReminder,
  SentFamilyReminderResult,
  SentFamilyReminderWrite,
  StagedFamilyReminderWrite
} from "../lib/storage/family-reminder-store";
import type { SessionRecord } from "../lib/storage/session-store";

function session(stateVersion = 5): SessionRecord {
  return {
    id: "session_01", fixtureKey: "emily_band_camp_v1", actorId: "student_emily", role: "student",
    state: { phase: "ORIENTATION_READY", stateVersion, sourceVersion: 1, activePlanVersion: null },
    csrfHash: "hash", expiresAt: "2026-07-18T16:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z", updatedAt: "2026-07-18T12:00:00.000Z"
  };
}

class MemoryFamilyStore implements FamilyReminderStore {
  staged: StagedFamilyReminderWrite[] = [];
  sent: SentFamilyReminderWrite[] = [];
  record: PendingFamilyReminder | null = null;
  async stageReminder(write: StagedFamilyReminderWrite) {
    this.staged.push(write);
    this.record = { pending: write.pending, reminder: write.reminder, consumedAt: null, sentResult: null };
  }
  async findPending() { return this.record; }
  async sendReminder(write: SentFamilyReminderWrite): Promise<SentFamilyReminderResult> {
    this.sent.push(write);
    return {
      sent: true, notificationId: write.notificationId, recipient: "Matt",
      channel: "Homeroom guardian inbox", sentAt: write.sentAt,
      reminder: write.reminder,
      proof: { approvalId: write.pending.id, argsHash: write.pending.argsHash, stateVersion: write.expectedStateVersion }
    };
  }
}

describe("independent Family reminder", () => {
  it("stages an exact reminder without changing the Golden session state", async () => {
    const store = new MemoryFamilyStore();
    const result = await stageFamilyReminder({
      session: session(), store,
      now: () => new Date("2026-07-18T12:01:00.000Z"),
      nonce: "family-reminder-receipt-long"
    });
    expect(result.preview).toEqual({
      reminderVersion: 1,
      recipient: { id: "guardian_matt", name: "Matt", relationship: "Parent" },
      sender: { id: "student_emily", name: "Emily" },
      task: { id: "guardian_action_physical_form", label: "Complete the band physical form", dueAt: "2026-07-24T17:00:00-05:00" },
      title: "Band physical form needs your help",
      message: "Emily needs your help completing the band physical form by Friday, July 24.",
      createdAt: "2026-07-18T12:01:00.000Z"
    });
    expect(result.proof).toEqual({ independentTrack: "family", stateUnchanged: true, stateVersion: 5 });
    expect(store.staged[0]).toMatchObject({ expectedStateVersion: 5, expectedPlanVersion: 0 });
  });

  it("delivers only the server-stored reminder after exact approval", async () => {
    const store = new MemoryFamilyStore();
    const staged = await stageFamilyReminder({ session: session(), store, nonce: "family-reminder-receipt-long" });
    const result = await approveFamilyReminder({
      session: session(), store,
      actionId: staged.approval.actionId, receipt: staged.approval.receipt,
      now: () => new Date("2026-07-18T12:02:00.000Z"), randomUUID: () => "notification_01"
    });
    expect(result).toMatchObject({ sent: true, notificationId: "notification_01", recipient: "Matt", channel: "Homeroom guardian inbox" });
    expect(store.sent).toEqual([expect.objectContaining({ expectedStateVersion: 5, sentBy: "student_emily" })]);
  });

  it("rejects stale state and invalid receipts", async () => {
    const store = new MemoryFamilyStore();
    const staged = await stageFamilyReminder({ session: session(), store, nonce: "family-reminder-receipt-long" });
    await expect(approveFamilyReminder({
      session: session(), store, actionId: staged.approval.actionId, receipt: "wrong-receipt-that-is-long-enough"
    })).rejects.toThrow(/receipt/i);
    await expect(approveFamilyReminder({
      session: session(6), store, actionId: staged.approval.actionId, receipt: staged.approval.receipt
    })).rejects.toThrow(/current/i);
    expect(store.sent).toHaveLength(0);
  });
});
