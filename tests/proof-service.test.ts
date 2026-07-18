import { describe, expect, it } from "vitest";

import { openJudgeProof } from "../lib/domain/proof-view";
import type {
  AdvanceProofWrite,
  ProofEvidenceBundle,
  ProofStore
} from "../lib/storage/proof-store";
import type { SessionRecord } from "../lib/storage/session-store";

const evidence: ProofEvidenceBundle = {
  session: {
    id: "session_01",
    actorId: "student_emily",
    phase: "COMPLETE",
    stateVersion: 15,
    sourceVersion: 2,
    activePlanVersion: 2,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:15:00.000Z"
  },
  audits: [
    { sequence: 1, actor: "student_emily", eventType: "PLAN_V1_APPROVED", stateVersion: 7, createdAt: "2026-07-18T12:06:00.000Z", approvalId: "action_111111111111111111111111", argsHash: "a".repeat(64), projectionHash: null, sourceVersion: 1, planVersion: 1, exerciseId: null, grader: null, privateExcluded: null },
    { sequence: 2, actor: "system_band_fixture", eventType: "SOURCE_V2_SYNCED", stateVersion: 8, createdAt: "2026-07-18T12:07:00.000Z", approvalId: null, argsHash: null, projectionHash: null, sourceVersion: null, planVersion: null, exerciseId: null, grader: null, privateExcluded: null },
    { sequence: 3, actor: "student_emily", eventType: "PLAN_V2_APPROVED", stateVersion: 10, createdAt: "2026-07-18T12:09:00.000Z", approvalId: "action_222222222222222222222222", argsHash: "b".repeat(64), projectionHash: null, sourceVersion: 2, planVersion: 2, exerciseId: null, grader: null, privateExcluded: null },
    { sequence: 4, actor: "student_emily", eventType: "PRACTICE_COMPLETED", stateVersion: 12, createdAt: "2026-07-18T12:12:00.000Z", approvalId: null, argsHash: null, projectionHash: null, sourceVersion: null, planVersion: null, exerciseId: "linear_equation_01", grader: "homeroom-deterministic-v1", privateExcluded: null },
    { sequence: 5, actor: "student_emily", eventType: "GUARDIAN_SUMMARY_PUBLISHED", stateVersion: 14, createdAt: "2026-07-18T12:14:00.000Z", approvalId: "action_333333333333333333333333", argsHash: "c".repeat(64), projectionHash: "d".repeat(64), sourceVersion: null, planVersion: null, exerciseId: null, grader: null, privateExcluded: 5 },
    { sequence: 6, actor: "student_emily", eventType: "PROOF_VIEW_OPENED", stateVersion: 15, createdAt: "2026-07-18T12:15:00.000Z", approvalId: null, argsHash: null, projectionHash: null, sourceVersion: null, planVersion: null, exerciseId: null, grader: null, privateExcluded: null }
  ],
  aiTurns: [
    { stage: "morning_plan", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_plan_1", "resp_plan_2"], toolTrace: [{ name: "get_morning_plan_context", callId: "call_plan" }], latencyMs: 8100, inputTokens: 900, outputTokens: 180, cachedTokens: 100, createdAt: "2026-07-18T12:05:00.000Z" },
    { stage: "plan_revision", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_revision_1", "resp_revision_2"], toolTrace: [{ name: "get_plan_revision_context", callId: "call_revision" }], latencyMs: 7600, inputTokens: 820, outputTokens: 165, cachedTokens: 80, createdAt: "2026-07-18T12:08:00.000Z" },
    { stage: "learning_hint", model: "gpt-5.6-sol-2026-07-15", status: "completed", responseIds: ["resp_hint_1", "resp_hint_2"], toolTrace: [{ name: "get_practice_exercise", callId: "call_hint" }], latencyMs: 3900, inputTokens: 610, outputTokens: 95, cachedTokens: 40, createdAt: "2026-07-18T12:10:00.000Z" }
  ]
};

function session(phase: "GUARDIAN_PUBLISHED" | "COMPLETE" = "GUARDIAN_PUBLISHED"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: "student_emily",
    role: "student",
    state: { phase, stateVersion: phase === "COMPLETE" ? 15 : 14, sourceVersion: 2, activePlanVersion: 2 },
    csrfHash: "hash",
    expiresAt: "2026-07-18T16:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:14:00.000Z"
  };
}

class MemoryProofStore implements ProofStore {
  advances: AdvanceProofWrite[] = [];
  async advanceToProof(write: AdvanceProofWrite) { this.advances.push(write); }
  async readEvidence() { return evidence; }
}

describe("privacy-safe judge proof", () => {
  it("advances to state 15 and builds a verifiable, allowlisted evidence view", async () => {
    const store = new MemoryProofStore();
    const result = await openJudgeProof({
      session: session(),
      store,
      now: () => new Date("2026-07-18T12:15:00.000Z"),
      randomUUID: () => "audit_proof_opened"
    });

    expect(store.advances).toEqual([expect.objectContaining({
      previousStateVersion: 14,
      nextState: expect.objectContaining({ phase: "COMPLETE", stateVersion: 15 }),
      auditEventId: "audit_proof_opened"
    })]);
    expect(result).toMatchObject({
      contractVersion: 1,
      headline: "Golden Experience verified",
      session: { student: "Emily", phase: "COMPLETE", stateVersion: 15, sourceVersion: 2, activePlanVersion: 2 },
      scorecard: { liveModelTurns: 3, auditedTransitions: 6, approvedWrites: 3, privateLearningDetailsExposed: 0 },
      privacy: { guardianProjection: "Server-built allowlist", modelStorage: "store: false" },
      integrity: { generatedAt: "2026-07-18T12:15:00.000Z" }
    });
    expect(result.integrity.proofHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.aiTurns.map((turn) => turn.tools)).toEqual([
      ["get_morning_plan_context"],
      ["get_plan_revision_context"],
      ["get_practice_exercise"]
    ]);
    expect(result.timeline.map((entry) => entry.label)).toEqual([
      "Emily approved Plan V1",
      "BAND source advanced to V2",
      "Emily approved Plan V2",
      "Algebra practice completed",
      "Guardian-safe view published",
      "Judge proof opened"
    ]);
  });

  it("never exposes private tutoring evidence or model output content", async () => {
    const result = await openJudgeProof({ session: session(), store: new MemoryProofStore() });
    const serialized = JSON.stringify(result);
    for (const privateValue of ["finalAnswer", "validatedSteps", "hintsUsed", "attempts", "x = 4"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toContain("output_text");
    expect(result.privacy.keptPrivate).toEqual([
      "answers",
      "step-by-step work",
      "attempt and hint counts",
      "private coaching content"
    ]);
  });

  it("reopens the completed proof idempotently without another state write", async () => {
    const store = new MemoryProofStore();
    const first = await openJudgeProof({ session: session("COMPLETE"), store });
    const second = await openJudgeProof({
      session: session("COMPLETE"),
      store,
      now: () => new Date("2026-07-18T13:00:00.000Z")
    });
    expect(store.advances).toHaveLength(0);
    expect(second.integrity.proofHash).toBe(first.integrity.proofHash);
    expect(second.integrity.generatedAt).toBe("2026-07-18T12:15:00.000Z");
  });
});
