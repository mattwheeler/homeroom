import { describe, expect, it } from "vitest";

import type { MorningPlan } from "../lib/ai/morning-plan";
import {
  approveGuardianProjection,
  stageGuardianPreview
} from "../lib/domain/guardian-projection";
import type {
  GuardianProjectionStore,
  GuardianPublishedResult,
  PendingGuardianProjectionRecord,
  PublishedGuardianProjectionWrite,
  StagedGuardianPreviewWrite
} from "../lib/storage/guardian-store";
import type { PracticeProgress } from "../lib/storage/practice-store";
import type { SessionRecord } from "../lib/storage/session-store";

const planV2: MorningPlan = {
  title: "Plan V2",
  intro: "Updated morning plan.",
  steps: [
    { time: "06:15", title: "Wake up", detail: "Get ready.", sourceLabel: "Plan" },
    { time: "06:30", title: "Bag check", detail: "Check bag.", sourceLabel: "Plan" },
    { time: "06:45", title: "Leave home", detail: "Leave.", sourceLabel: "BAND" },
    { time: "07:15", title: "Check in", detail: "Check in.", sourceLabel: "BAND" }
  ],
  guardianNote: "Matt owns the physical form.",
  encouragement: "Ready.",
  approvalPrompt: "Save?"
};

const completedPractice: PracticeProgress = {
  sessionId: "session_01",
  exerciseId: "linear_equation_01",
  status: "completed",
  hintsUsed: 1,
  attempts: 2,
  validatedSteps: ["divide_both_sides_by_3", "final_answer_4"],
  finalAnswer: "4",
  completedAt: "2026-07-18T12:12:00.000Z"
};

function session(phase: "PRACTICE_COMPLETE" | "GUARDIAN_PREVIEWED" = "PRACTICE_COMPLETE"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: "student_emily",
    role: "student",
    state: {
      phase,
      stateVersion: phase === "PRACTICE_COMPLETE" ? 12 : 13,
      sourceVersion: 2,
      activePlanVersion: 2
    },
    csrfHash: "hash",
    expiresAt: "2026-07-18T14:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:12:00.000Z"
  };
}

class MemoryGuardianStore implements GuardianProjectionStore {
  staged: StagedGuardianPreviewWrite[] = [];
  published: PublishedGuardianProjectionWrite[] = [];
  record: PendingGuardianProjectionRecord | null = null;

  async stagePreview(write: StagedGuardianPreviewWrite) {
    this.staged.push(write);
    this.record = {
      pending: write.pending,
      projection: write.projection,
      projectionHash: write.projectionHash,
      consumedAt: null,
      publishResult: null
    };
  }

  async findPending() { return this.record; }

  async publishProjection(write: PublishedGuardianProjectionWrite): Promise<GuardianPublishedResult> {
    this.published.push(write);
    const result: GuardianPublishedResult = {
      published: true,
      projectionVersion: 1,
      phase: "GUARDIAN_PUBLISHED",
      publishedAt: write.publishedAt,
      recipient: "Matt",
      view: write.projection,
      proof: {
        approvalId: write.pending.id,
        argsHash: write.pending.argsHash,
        projectionHash: write.projectionHash,
        stateVersion: write.nextState.stateVersion
      }
    };
    if (this.record) {
      this.record = { ...this.record, consumedAt: write.publishedAt, publishResult: result };
    }
    return result;
  }
}

describe("guardian-safe projection and exact publish approval", () => {
  it("builds an exact preview while excluding private learning details", async () => {
    const store = new MemoryGuardianStore();
    const result = await stageGuardianPreview({
      session: session(),
      plan: planV2,
      practice: completedPractice,
      store,
      now: () => new Date("2026-07-18T12:13:00.000Z"),
      nonce: "fixed-guardian-receipt"
    });

    expect(result.preview).toEqual({
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
      privacy: {
        excluded: ["Algebra answer", "step-by-step work", "attempt count", "hint count", "private coaching"]
      },
      generatedAt: "2026-07-18T12:13:00.000Z"
    });
    const serialized = JSON.stringify(result.preview);
    expect(serialized).not.toContain('"finalAnswer"');
    expect(serialized).not.toContain('"attempts"');
    expect(serialized).not.toContain('"hintsUsed"');
    expect(serialized).not.toContain('"validatedSteps"');
    expect(result.approval).toMatchObject({
      receipt: "fixed-guardian-receipt",
      projectionVersion: 1,
      stateVersion: 13
    });
    expect(result.proof.projectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.staged).toEqual([expect.objectContaining({
      previousStateVersion: 12,
      nextState: expect.objectContaining({ phase: "GUARDIAN_PREVIEWED", stateVersion: 13 })
    })]);
  });

  it("publishes only the exact server-stored projection Emily approved", async () => {
    const store = new MemoryGuardianStore();
    const staged = await stageGuardianPreview({
      session: session(), plan: planV2, practice: completedPractice, store,
      now: () => new Date("2026-07-18T12:13:00.000Z"),
      nonce: "fixed-guardian-receipt"
    });

    const result = await approveGuardianProjection({
      session: session("GUARDIAN_PREVIEWED"),
      actionId: staged.approval.actionId,
      receipt: staged.approval.receipt,
      store,
      now: () => new Date("2026-07-18T12:14:00.000Z"),
      randomUUID: () => "audit_guardian_publish"
    });

    expect(result).toMatchObject({
      published: true,
      projectionVersion: 1,
      phase: "GUARDIAN_PUBLISHED",
      recipient: "Matt",
      proof: { stateVersion: 14, projectionHash: staged.proof.projectionHash }
    });
    expect(store.published).toEqual([expect.objectContaining({
      previousStateVersion: 13,
      nextState: expect.objectContaining({ phase: "GUARDIAN_PUBLISHED", stateVersion: 14 }),
      approvedBy: "student_emily",
      auditEventId: "audit_guardian_publish"
    })]);
  });

  it("rejects an invalid receipt without publishing", async () => {
    const store = new MemoryGuardianStore();
    const staged = await stageGuardianPreview({
      session: session(), plan: planV2, practice: completedPractice, store,
      nonce: "fixed-guardian-receipt"
    });

    await expect(approveGuardianProjection({
      session: session("GUARDIAN_PREVIEWED"),
      actionId: staged.approval.actionId,
      receipt: "wrong-receipt-that-is-long-enough",
      store
    })).rejects.toThrow(/receipt/i);
    expect(store.published).toHaveLength(0);
  });

  it("rejects a completed practice record from another student session", async () => {
    const store = new MemoryGuardianStore();
    await expect(stageGuardianPreview({
      session: session(),
      plan: planV2,
      practice: { ...completedPractice, sessionId: "session_other" },
      store
    })).rejects.toThrow(/contract/i);
    expect(store.staged).toHaveLength(0);
  });
});
