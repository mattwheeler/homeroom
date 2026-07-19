import { z } from "zod";

import { morningPlanSchema, type MorningPlan } from "../ai/morning-plan";
import { ApprovalError, createPendingAction, verifyApproval } from "../security/approval";
import type {
  LiveDayPlanApprovalResult,
  LiveDayPlanStore
} from "../storage/live-day-plan-store";
import type { SessionRecord } from "../storage/session-store";

const savedResultSchema = z.object({
  saved: z.literal(true),
  planVersion: z.number().int().positive(),
  savedAt: z.string().datetime(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  proof: z.object({
    approvalId: z.string(),
    argsHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()
}).strict();

export class LiveDayPlanError extends Error {
  constructor(
    readonly code: "APPROVAL_NOT_FOUND" | "APPROVAL_SCOPE_MISMATCH" | "VERSION_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "LiveDayPlanError";
  }
}

function exactArgs(plan: MorningPlan, planVersion: number, sourceFingerprint: string) {
  return { planVersion, sourceFingerprint, plan };
}

export async function stageLiveDayPlan(input: {
  session: SessionRecord;
  plan: MorningPlan;
  sourceFingerprint: string;
  store: LiveDayPlanStore;
  now?: () => Date;
  nonce?: string;
}) {
  if (input.session.role !== "student") {
    throw new LiveDayPlanError("APPROVAL_SCOPE_MISMATCH", "The proposal is outside this student session.");
  }
  const plan = morningPlanSchema.parse(input.plan);
  const latestVersion = await input.store.latestVersion(input.session.id);
  const planVersion = latestVersion + 1;
  const now = (input.now ?? (() => new Date()))();
  const expected = {
    stateVersion: input.session.state.stateVersion,
    sourceVersion: input.session.state.sourceVersion,
    planVersion
  };
  const created = await createPendingAction({
    sessionId: input.session.id,
    actor: input.session.actorId,
    actionType: "APPROVE_LIVE_DAY_PLAN",
    args: exactArgs(plan, planVersion, input.sourceFingerprint),
    expected,
    nowMs: now.getTime(),
    nonce: input.nonce
  });
  await input.store.stage({
    sessionId: input.session.id,
    plan,
    planVersion,
    sourceFingerprint: input.sourceFingerprint,
    pending: created.pending,
    proposedAt: now.toISOString()
  });
  return {
    approval: {
      actionId: created.pending.id,
      receipt: created.receipt,
      expiresAt: new Date(created.pending.expiresAt).toISOString(),
      planVersion
    }
  };
}

export async function approveLiveDayPlan(input: {
  session: SessionRecord;
  actionId: string;
  receipt: string;
  store: LiveDayPlanStore;
  now?: () => Date;
  randomUUID?: () => string;
}): Promise<LiveDayPlanApprovalResult> {
  const record = await input.store.findPending(input.session.id, input.actionId);
  if (!record) throw new LiveDayPlanError("APPROVAL_NOT_FOUND", "The approval request was not found.");
  if (
    input.session.role !== "student" ||
    record.pending.sessionId !== input.session.id ||
    record.pending.actor !== input.session.actorId ||
    record.pending.actionType !== "APPROVE_LIVE_DAY_PLAN"
  ) {
    throw new LiveDayPlanError("APPROVAL_SCOPE_MISMATCH", "The approval is outside this student session.");
  }
  const plan = morningPlanSchema.parse(record.plan);
  const now = (input.now ?? (() => new Date()))();
  await verifyApproval({
    pending: record.pending,
    receipt: input.receipt,
    args: exactArgs(plan, record.planVersion, record.sourceFingerprint),
    expected: record.pending.expected,
    nowMs: now.getTime()
  });
  if (record.consumedAt) {
    if (!record.approvalResult) {
      throw new LiveDayPlanError("APPROVAL_NOT_FOUND", "The saved approval result is unavailable.");
    }
    return savedResultSchema.parse(record.approvalResult);
  }
  const currentVersion = await input.store.latestVersion(input.session.id);
  if (currentVersion + 1 !== record.planVersion) {
    throw new ApprovalError("VERSION_MISMATCH", "A newer live plan already exists.");
  }
  return input.store.approve({
    sessionId: input.session.id,
    plan,
    planVersion: record.planVersion,
    sourceFingerprint: record.sourceFingerprint,
    pending: record.pending,
    approvedBy: input.session.actorId,
    proposedAt: record.proposedAt,
    approvedAt: now.toISOString(),
    auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
  });
}
