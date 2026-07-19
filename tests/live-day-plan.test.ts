import { describe, expect, it } from "vitest";

import type { MorningPlan } from "../lib/ai/morning-plan";
import { approveLiveDayPlan, stageLiveDayPlan } from "../lib/domain/live-day-plan";
import type {
  LiveDayPlanApprovalResult,
  LiveDayPlanStore,
  PendingLiveDayPlan
} from "../lib/storage/live-day-plan-store";
import type { SessionRecord } from "../lib/storage/session-store";

const session: SessionRecord = {
  id: "session_live_01",
  fixtureKey: "product",
  actorId: "principal_student_01",
  principalId: "principal_student_01",
  studentId: "principal_student_01",
  guardianId: "principal_guardian_01",
  householdId: "household_01",
  role: "student",
  state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "csrf",
  expiresAt: "2026-07-20T00:00:00.000Z",
  createdAt: "2026-07-19T15:00:00.000Z",
  updatedAt: "2026-07-19T15:00:00.000Z"
};

const plan: MorningPlan = {
  title: "A small plan for today",
  intro: "Four source-backed steps.",
  steps: [
    { time: "08:00", title: "Check today", detail: "Look at the selected task.", sourceLabel: "Google Classroom" },
    { time: "08:05", title: "Set up", detail: "Gather what the directions name.", sourceLabel: "Google Classroom" },
    { time: "08:10", title: "Focus", detail: "Work on one visible section.", sourceLabel: "Google Classroom" },
    { time: "08:25", title: "Choose next", detail: "Stop, continue, or schedule another block.", sourceLabel: "Homeroom plan" }
  ],
  guardianNote: "No guardian action is included.",
  encouragement: "One step is enough to begin.",
  approvalPrompt: "Use this plan?"
};

class MemoryLivePlans implements LiveDayPlanStore {
  version = 0;
  pending: PendingLiveDayPlan | null = null;
  async latestVersion() { return this.version; }
  async stage(input: Parameters<LiveDayPlanStore["stage"]>[0]) {
    this.pending = { ...input, consumedAt: null, approvalResult: null };
  }
  async findPending(_sessionId: string, actionId: string) {
    return this.pending?.pending.id === actionId ? this.pending : null;
  }
  async approve(input: Parameters<LiveDayPlanStore["approve"]>[0]) {
    this.version = input.planVersion;
    const result: LiveDayPlanApprovalResult = {
      saved: true,
      planVersion: input.planVersion,
      savedAt: input.approvedAt,
      sourceFingerprint: input.sourceFingerprint,
      proof: { approvalId: input.pending.id, argsHash: input.pending.argsHash }
    };
    if (this.pending) {
      this.pending.consumedAt = input.approvedAt;
      this.pending.approvalResult = result;
    }
    return result;
  }
}

describe("live day plan approval", () => {
  it("binds a real principal, exact live projection, and immutable plan version to approval", async () => {
    const store = new MemoryLivePlans();
    const proposed = await stageLiveDayPlan({
      session,
      plan,
      sourceFingerprint: "a".repeat(64),
      store,
      now: () => new Date("2026-07-19T16:00:00.000Z"),
      nonce: "receipt-live-plan-01"
    });
    const saved = await approveLiveDayPlan({
      session,
      actionId: proposed.approval.actionId,
      receipt: proposed.approval.receipt,
      store,
      now: () => new Date("2026-07-19T16:01:00.000Z"),
      randomUUID: () => "audit_live_01"
    });
    expect(saved).toMatchObject({ saved: true, planVersion: 1, sourceFingerprint: "a".repeat(64) });
    expect(store.pending?.pending.actor).toBe("principal_student_01");
  });

  it("rejects an altered approval receipt", async () => {
    const store = new MemoryLivePlans();
    const proposed = await stageLiveDayPlan({
      session, plan, sourceFingerprint: "b".repeat(64), store,
      now: () => new Date("2026-07-19T16:00:00.000Z"), nonce: "receipt-live-plan-02"
    });
    await expect(approveLiveDayPlan({
      session, actionId: proposed.approval.actionId, receipt: "not-the-receipt", store,
      now: () => new Date("2026-07-19T16:01:00.000Z")
    })).rejects.toMatchObject({ code: "INVALID_RECEIPT" });
  });

  it("rejects non-students, missing approvals, and approvals outside the principal scope", async () => {
    const store = new MemoryLivePlans();
    await expect(stageLiveDayPlan({
      session: { ...session, role: "guardian" }, plan, sourceFingerprint: "c".repeat(64), store
    })).rejects.toMatchObject({ code: "APPROVAL_SCOPE_MISMATCH" });
    await expect(approveLiveDayPlan({
      session, actionId: "action_missing", receipt: "receipt", store
    })).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    const proposed = await stageLiveDayPlan({
      session, plan, sourceFingerprint: "d".repeat(64), store,
      now: () => new Date("2026-07-19T16:00:00.000Z"), nonce: "receipt-scope"
    });
    await expect(approveLiveDayPlan({
      session: { ...session, actorId: "another_student" }, actionId: proposed.approval.actionId,
      receipt: proposed.approval.receipt, store
    })).rejects.toMatchObject({ code: "APPROVAL_SCOPE_MISMATCH" });
  });

  it("returns the same immutable result on a replay and rejects a stale version", async () => {
    const store = new MemoryLivePlans();
    const proposed = await stageLiveDayPlan({
      session, plan, sourceFingerprint: "e".repeat(64), store,
      now: () => new Date("2026-07-19T16:00:00.000Z"), nonce: "receipt-replay"
    });
    const input = {
      session, actionId: proposed.approval.actionId, receipt: proposed.approval.receipt, store,
      now: () => new Date("2026-07-19T16:01:00.000Z")
    };
    const first = await approveLiveDayPlan(input);
    await expect(approveLiveDayPlan(input)).resolves.toEqual(first);

    const staleStore = new MemoryLivePlans();
    const stale = await stageLiveDayPlan({
      session, plan, sourceFingerprint: "f".repeat(64), store: staleStore,
      now: () => new Date("2026-07-19T16:00:00.000Z"), nonce: "receipt-stale"
    });
    staleStore.version = 4;
    await expect(approveLiveDayPlan({
      session, actionId: stale.approval.actionId, receipt: stale.approval.receipt,
      store: staleStore, now: () => new Date("2026-07-19T16:01:00.000Z")
    })).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
  });
});
