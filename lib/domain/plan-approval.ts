import { z } from "zod";

import { morningPlanSchema, type MorningPlan } from "../ai/morning-plan";
import {
  ApprovalError,
  createPendingAction,
  verifyApproval,
  type VersionExpectation
} from "../security/approval";
import type {
  ApprovedPlanWrite,
  PlanApprovalStore,
  PlanV1ApprovalResult
} from "../storage/plan-store";
import type { SessionRecord } from "../storage/session-store";
import { transitionSession } from "./state-machine";

const approvalResultSchema = z.object({
  saved: z.literal(true),
  planVersion: z.literal(1),
  phase: z.literal("PLAN_V1_SAVED"),
  savedAt: z.string().datetime(),
  proof: z.object({
    approvalId: z.string(),
    argsHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceVersion: z.literal(1),
    stateVersion: z.number().int().positive()
  }).strict()
}).strict();

export class PlanApprovalError extends Error {
  readonly code: "APPROVAL_NOT_FOUND" | "APPROVAL_SCOPE_MISMATCH";

  constructor(code: PlanApprovalError["code"], message: string) {
    super(message);
    this.name = "PlanApprovalError";
    this.code = code;
  }
}

function exactApprovalArgs(plan: MorningPlan, sourceVersion: 1) {
  return { planVersion: 1 as const, sourceVersion, plan };
}

function expectedVersions(stateVersion: number): VersionExpectation {
  return { stateVersion, sourceVersion: 1, planVersion: 1 };
}

export async function stagePlanV1Proposal(input: {
  session: SessionRecord;
  plan: MorningPlan;
  store: PlanApprovalStore;
  now?: () => Date;
  nonce?: string;
}) {
  if (input.session.role !== "student" || input.session.actorId !== "student_emily") {
    throw new PlanApprovalError("APPROVAL_SCOPE_MISMATCH", "The proposal is outside this student session.");
  }
  const validatedPlan = morningPlanSchema.parse(input.plan);
  const nextState = transitionSession(input.session.state, { type: "PROPOSE_PLAN" });
  if (nextState.sourceVersion !== 1) {
    throw new ApprovalError("VERSION_MISMATCH", "Plan V1 requires source version one.");
  }
  const now = (input.now ?? (() => new Date()))();
  const expected = expectedVersions(nextState.stateVersion);
  const created = await createPendingAction({
    sessionId: input.session.id,
    actor: input.session.actorId,
    actionType: "APPROVE_PLAN_V1",
    args: exactApprovalArgs(validatedPlan, 1),
    expected,
    nowMs: now.getTime(),
    nonce: input.nonce
  });
  await input.store.stageProposal({
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState,
    plan: validatedPlan,
    pending: created.pending,
    createdAt: now.toISOString()
  });
  return {
    approval: {
      actionId: created.pending.id,
      receipt: created.receipt,
      expiresAt: new Date(created.pending.expiresAt).toISOString(),
      planVersion: 1 as const,
      stateVersion: nextState.stateVersion
    }
  };
}

export async function approvePlanV1(input: {
  session: SessionRecord;
  actionId: string;
  receipt: string;
  store: PlanApprovalStore;
  now?: () => Date;
  randomUUID?: () => string;
}): Promise<PlanV1ApprovalResult> {
  const record = await input.store.findPending(input.session.id, input.actionId);
  if (!record) throw new PlanApprovalError("APPROVAL_NOT_FOUND", "The approval request was not found.");
  if (
    input.session.role !== "student" ||
    input.session.actorId !== "student_emily" ||
    record.pending.sessionId !== input.session.id ||
    record.pending.actor !== input.session.actorId ||
    record.pending.actionType !== "APPROVE_PLAN_V1"
  ) {
    throw new PlanApprovalError("APPROVAL_SCOPE_MISMATCH", "The approval is outside this student session.");
  }
  const plan = morningPlanSchema.parse(record.plan);
  const now = (input.now ?? (() => new Date()))();
  await verifyApproval({
    pending: record.pending,
    receipt: input.receipt,
    args: exactApprovalArgs(plan, 1),
    expected: record.pending.expected,
    nowMs: now.getTime()
  });

  if (record.consumedAt) {
    if (!record.approvalResult) {
      throw new PlanApprovalError("APPROVAL_NOT_FOUND", "The saved approval result is unavailable.");
    }
    return approvalResultSchema.parse(record.approvalResult);
  }
  if (
    input.session.state.stateVersion !== record.pending.expected.stateVersion ||
    input.session.state.sourceVersion !== record.pending.expected.sourceVersion ||
    input.session.state.activePlanVersion !== null
  ) {
    throw new ApprovalError("VERSION_MISMATCH", "The proposal is no longer current.");
  }
  const nextState = transitionSession(input.session.state, {
    type: "APPROVE_PLAN_V1",
    approvalVerified: true
  });
  if (
    nextState.phase !== "PLAN_V1_SAVED" ||
    nextState.sourceVersion !== 1 ||
    nextState.activePlanVersion !== 1
  ) {
    throw new ApprovalError("VERSION_MISMATCH", "The plan could not advance to version one.");
  }
  const write: ApprovedPlanWrite = {
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: { ...nextState, phase: "PLAN_V1_SAVED", sourceVersion: 1, activePlanVersion: 1 },
    plan,
    pending: record.pending,
    approvedBy: input.session.actorId,
    approvedAt: now.toISOString(),
    auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
  };
  return input.store.approvePlan(write);
}
