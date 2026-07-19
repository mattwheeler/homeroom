import { describe, expect, it } from "vitest";

import {
  acknowledgeGuardianNotification,
  buildGuardianDigest,
  listGuardianInbox
} from "../lib/domain/guardian-inbox";
import type { GuardianInboxStore } from "../lib/storage/guardian-inbox-store";

const notification = {
  id: "notification_01",
  recipientId: "principal_guardian",
  studentId: "principal_student",
  title: "Band physical form needs your help",
  message: "Emily needs your help completing the band physical form.",
  taskLabel: "Complete the band physical form",
  sourceLabel: "Concert Band · guardian-only form",
  sentAt: "2026-07-19T15:00:00.000Z",
  readAt: null as string | null
};

class MemoryInbox implements GuardianInboxStore {
  rows = [{ ...notification }];
  async list(recipientId: string) { return this.rows.filter((row) => row.recipientId === recipientId); }
  async acknowledge(recipientId: string, id: string, readAt: string) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.recipientId === recipientId);
    if (!row) return null;
    row.readAt = readAt;
    return row;
  }
  async recordDigest() { return undefined; }
}

describe("guardian inbox and approved weekly digest", () => {
  it("lists only reminders addressed to the authenticated guardian", async () => {
    const result = await listGuardianInbox({ recipientId: "principal_guardian", store: new MemoryInbox() });
    expect(result.unreadCount).toBe(1);
    expect(result.notifications[0]).toMatchObject({ title: notification.title, readAt: null });
  });

  it("acknowledges one reminder without mutating its student-approved content", async () => {
    const store = new MemoryInbox();
    const result = await acknowledgeGuardianNotification({
      recipientId: "principal_guardian",
      notificationId: "notification_01",
      store,
      now: () => new Date("2026-07-19T16:00:00.000Z")
    });
    expect(result).toMatchObject({ readAt: "2026-07-19T16:00:00.000Z", message: notification.message });
  });

  it("builds a digest from student-approved reminders only", async () => {
    const result = await buildGuardianDigest({
      recipientId: "principal_guardian",
      recipientEmail: "guardian@example.com",
      store: new MemoryInbox(),
      now: () => new Date("2026-07-19T16:00:00.000Z")
    });
    expect(result.subject).toContain("Homeroom weekly family notes");
    expect(result.text).toContain(notification.message);
    expect(result.text).toContain("Only notes your student explicitly sent");
  });

  it("builds a calm empty digest and rejects a missing reminder", async () => {
    const empty = new MemoryInbox();
    empty.rows = [];
    const digest = await buildGuardianDigest({
      recipientId: "principal_guardian", recipientEmail: "guardian@example.com", store: empty,
      now: () => new Date("2026-07-19T16:00:00.000Z"), randomUUID: () => "digest_empty"
    });
    expect(digest.text).toContain("No student-approved family notes");
    await expect(acknowledgeGuardianNotification({
      recipientId: "principal_guardian", notificationId: "missing", store: empty
    })).rejects.toThrow(/not found/);
  });
});
