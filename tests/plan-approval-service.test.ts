import { describe, expect, it } from "vitest";

import { morningPlanSchema, type MorningPlan } from "../lib/ai/morning-plan";
import {
  approvePlanV1,
  stagePlanV1Proposal
} from "../lib/domain/plan-approval";
import type {
  ApprovedPlanWrite,
  PendingPlanRecord,
  PlanApprovalStore,
  StagedPlanWrite
} from "../lib/storage/plan-store";
import type { SessionRecord } from "../lib/storage/session-store";

const plan: MorningPlan = morningPlanSchema.parse({
  title: "Your band-camp morning",
  intro: "A calm start with enough time for the essentials.",
  steps: [
    { time: "06:30", title: "Wake up", detail: "Get dressed and have breakfast.", sourceLabel: "Homeroom plan" },
    { time: "06:45", title: "Final bag check", detail: "Bring your instrument, water, and music folder.", sourceLabel: "Band packing list" },
    { time: "07:00", title: "Leave home", detail: "Allow 20 minutes for travel and a 10-minute buffer.", sourceLabel: "Band calendar + preferences" },
    { time: "07:30", title: "Check in", detail: "You will be ready before the 8:00 AM start.", sourceLabel: "Band calendar" }
  ],
  guardianNote: "Matt owns the band physical form due July 24.",
  encouragement: "You have a clear plan—and you do not have to remember everything at once.",
  approvalPrompt: "Review this proposal. Would you like to save it?"
});

function orientationSession(): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: "student_emily",
    role: "student",
    state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
    csrfHash: "hash",
    expiresAt: "2026-07-18T14:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z"
  };
}

class MemoryPlanApprovalStore implements PlanApprovalStore {
  staged: StagedPlanWrite | null = null;
  approved: ApprovedPlanWrite[] = [];
  pending: PendingPlanRecord | null = null;

  async stageProposal(write: StagedPlanWrite) {
    this.staged = write;
    this.pending = { pending: write.pending, plan: write.plan, consumedAt: null, approvalResult: null };
  }

  async findPending(sessionId: string, actionId: string) {
    if (this.pending?.pending.sessionId !== sessionId || this.pending.pending.id !== actionId) return null;
    return this.pending;
  }

  async approvePlan(write: ApprovedPlanWrite) {
    this.approved.push(write);
    const result = {
      saved: true as const,
      planVersion: 1 as const,
      phase: write.nextState.phase,
      savedAt: write.approvedAt,
      proof: {
        approvalId: write.pending.id,
        argsHash: write.pending.argsHash,
        sourceVersion: write.nextState.sourceVersion,
        stateVersion: write.nextState.stateVersion
      }
    };
    this.pending = {
      pending: write.pending,
      plan: write.plan,
      consumedAt: write.approvedAt,
      approvalResult: result
    };
    return result;
  }
}

describe("Plan V1 exact-content approval", () => {
  it("stages the validated proposal and binds a receipt to its exact content and versions", async () => {
    const store = new MemoryPlanApprovalStore();
    const result = await stagePlanV1Proposal({
      session: orientationSession(),
      plan,
      store,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      nonce: "fixed-approval-receipt"
    });

    expect(store.staged).toMatchObject({
      sessionId: "session_01",
      previousStateVersion: 5,
      nextState: { phase: "PLAN_PROPOSED", stateVersion: 6, sourceVersion: 1 },
      plan
    });
    expect(store.staged?.pending).toMatchObject({
      sessionId: "session_01",
      actor: "student_emily",
      actionType: "APPROVE_PLAN_V1",
      expected: { stateVersion: 6, sourceVersion: 1, planVersion: 1 }
    });
    expect(result.approval).toMatchObject({
      actionId: store.staged?.pending.id,
      receipt: "fixed-approval-receipt",
      expiresAt: "2026-07-18T12:10:00.000Z",
      planVersion: 1,
      stateVersion: 6
    });
  });

  it("saves the exact server-stored proposal as Plan V1 after explicit approval", async () => {
    const store = new MemoryPlanApprovalStore();
    const session = orientationSession();
    const staged = await stagePlanV1Proposal({
      session,
      plan,
      store,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      nonce: "fixed-approval-receipt"
    });
    session.state = store.staged!.nextState;

    const result = await approvePlanV1({
      session,
      actionId: staged.approval.actionId,
      receipt: staged.approval.receipt,
      store,
      now: () => new Date("2026-07-18T12:06:00.000Z")
    });

    expect(result).toMatchObject({
      saved: true,
      planVersion: 1,
      phase: "PLAN_V1_SAVED",
      proof: { sourceVersion: 1, stateVersion: 7 }
    });
    expect(store.approved).toHaveLength(1);
    expect(store.approved[0]).toMatchObject({
      plan,
      nextState: { phase: "PLAN_V1_SAVED", activePlanVersion: 1, stateVersion: 7 },
      approvedBy: "student_emily"
    });
  });

  it("rejects a changed receipt and a stale session without writing", async () => {
    const store = new MemoryPlanApprovalStore();
    const session = orientationSession();
    const staged = await stagePlanV1Proposal({
      session,
      plan,
      store,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      nonce: "fixed-approval-receipt"
    });
    session.state = store.staged!.nextState;

    await expect(approvePlanV1({
      session,
      actionId: staged.approval.actionId,
      receipt: "changed-receipt",
      store,
      now: () => new Date("2026-07-18T12:06:00.000Z")
    })).rejects.toMatchObject({ code: "INVALID_RECEIPT" });

    session.state = { ...session.state, stateVersion: 99 };
    await expect(approvePlanV1({
      session,
      actionId: staged.approval.actionId,
      receipt: staged.approval.receipt,
      store,
      now: () => new Date("2026-07-18T12:06:00.000Z")
    })).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    expect(store.approved).toHaveLength(0);
  });

  it("returns the original result for an exact replay without a second write", async () => {
    const store = new MemoryPlanApprovalStore();
    const session = orientationSession();
    const staged = await stagePlanV1Proposal({
      session,
      plan,
      store,
      now: () => new Date("2026-07-18T12:05:00.000Z"),
      nonce: "fixed-approval-receipt"
    });
    session.state = store.staged!.nextState;
    const input = {
      session,
      actionId: staged.approval.actionId,
      receipt: staged.approval.receipt,
      store,
      now: () => new Date("2026-07-18T12:06:00.000Z")
    };
    const first = await approvePlanV1(input);
    session.state = { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 };
    const replay = await approvePlanV1(input);

    expect(replay).toEqual(first);
    expect(store.approved).toHaveLength(1);
  });
});
