import { describe, expect, it, vi } from "vitest";

import type { MorningPlan } from "../lib/ai/morning-plan";
import { preparePlanV2Proposal } from "../lib/domain/plan-v2";
import type {
  PlanV2Store,
  SourceSyncWrite,
  StagedPlanWrite
} from "../lib/storage/plan-store";
import type { SessionRecord } from "../lib/storage/session-store";

const planV1: MorningPlan = {
  title: "Plan V1", intro: "Current plan",
  steps: [
    { time: "06:30", title: "Wake", detail: "Wake", sourceLabel: "Plan" },
    { time: "06:45", title: "Bag", detail: "Bag", sourceLabel: "Plan" },
    { time: "07:00", title: "Leave", detail: "Leave", sourceLabel: "BAND" },
    { time: "07:30", title: "Check in", detail: "Check in", sourceLabel: "BAND" }
  ],
  guardianNote: "Matt owns the form.", encouragement: "Ready.", approvalPrompt: "Save?"
};

const planV2: MorningPlan = {
  ...planV1,
  title: "Plan V2",
  steps: planV1.steps.map((step, index) => ({
    ...step,
    time: ["06:15", "06:30", "06:45", "07:15"][index]!
  }))
};

function session(): SessionRecord {
  return {
    id: "session_01", fixtureKey: "emily_band_camp_v1", actorId: "student_emily", role: "student",
    state: { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 },
    csrfHash: "hash", expiresAt: "2026-07-18T14:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z", updatedAt: "2026-07-18T12:06:00.000Z"
  };
}

class MemoryPlanV2Store implements PlanV2Store {
  sourceWrites: SourceSyncWrite[] = [];
  stagedWrites: StagedPlanWrite[] = [];
  approvedPlan: MorningPlan | null = planV1;
  async syncSourceV2(write: SourceSyncWrite) { this.sourceWrites.push(write); }
  async findApprovedPlan() { return this.approvedPlan; }
  async stageProposal(write: StagedPlanWrite) { this.stagedWrites.push(write); }
  async findPending() { return null; }
  async approvePlan(): Promise<never> { throw new Error("not used"); }
  async approvePlanV2(): Promise<never> { throw new Error("not used"); }
}

describe("Plan V2 orchestration recovery", () => {
  it("does not repeat an authoritative source sync when AI generation is retried", async () => {
    const store = new MemoryPlanV2Store();
    const initial = session();
    const failedGenerate = vi.fn().mockRejectedValue(new Error("temporary model failure"));

    await expect(preparePlanV2Proposal({
      session: initial,
      store,
      generate: failedGenerate,
      now: () => new Date("2026-07-18T12:07:00.000Z"),
      randomUUID: () => "audit_source_v2"
    })).rejects.toThrow("temporary model failure");
    expect(store.sourceWrites).toHaveLength(1);
    expect(store.stagedWrites).toHaveLength(0);

    const retriedSession: SessionRecord = {
      ...initial,
      state: store.sourceWrites[0]!.nextState,
      updatedAt: store.sourceWrites[0]!.syncedAt
    };
    const generated = {
      revision: { change: { before: "07:30", after: "07:15" }, plan: planV2 },
      proof: { sourceVersion: 2, previousPlanVersion: 1 }
    };
    await expect(preparePlanV2Proposal({
      session: retriedSession,
      store,
      generate: vi.fn().mockResolvedValue(generated),
      now: () => new Date("2026-07-18T12:08:00.000Z"),
      nonce: "fixed-v2-receipt"
    })).resolves.toMatchObject({
      ...generated,
      approval: { planVersion: 2, stateVersion: 9 }
    });
    expect(store.sourceWrites).toHaveLength(1);
    expect(store.stagedWrites).toHaveLength(1);
  });

  it("rejects a Plan V2 request before Plan V1 is saved", async () => {
    const initial = session();
    initial.state = {
      phase: "PLAN_PROPOSED",
      stateVersion: 6,
      sourceVersion: 1,
      activePlanVersion: null
    };

    await expect(preparePlanV2Proposal({
      session: initial,
      store: new MemoryPlanV2Store(),
      generate: vi.fn()
    })).rejects.toThrow("Plan V2 can only be proposed after Plan V1 is saved.");
  });

  it("stops before generation when immutable Plan V1 cannot be loaded", async () => {
    const initial = session();
    initial.state = {
      phase: "SOURCE_V2_SYNCED",
      stateVersion: 8,
      sourceVersion: 2,
      activePlanVersion: 1
    };
    const store = new MemoryPlanV2Store();
    store.approvedPlan = null;
    const generate = vi.fn();

    await expect(preparePlanV2Proposal({
      session: initial,
      store,
      generate
    })).rejects.toThrow("Approved Plan V1 could not be found.");
    expect(generate).not.toHaveBeenCalled();
    expect(store.stagedWrites).toHaveLength(0);
  });
});
