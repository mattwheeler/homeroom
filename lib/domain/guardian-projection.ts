import { z } from "zod";

import { morningPlanSchema, type MorningPlan } from "../ai/morning-plan";
import {
  ApprovalError,
  canonicalJson,
  createPendingAction,
  verifyApproval,
  type VersionExpectation
} from "../security/approval";
import type {
  GuardianProjectionStore,
  GuardianPublishedResult,
  PublishedGuardianProjectionWrite
} from "../storage/guardian-store";
import type { PracticeProgress } from "../storage/practice-store";
import type { SessionRecord } from "../storage/session-store";
import { bandCampV2, emilyFixture, guardianAction, mattFixture } from "./fixtures";
import { transitionSession } from "./state-machine";

export const guardianProjectionSchema = z.object({
  projectionVersion: z.literal(1),
  recipient: z.object({
    id: z.literal("guardian_matt"),
    name: z.literal("Matt"),
    relationship: z.literal("Parent")
  }).strict(),
  student: z.object({
    id: z.literal("student_emily"),
    name: z.literal("Emily"),
    grade: z.literal(9)
  }).strict(),
  headline: z.literal("Emily is on track for band camp."),
  shared: z.object({
    bandCamp: z.object({
      date: z.literal("2026-08-03"),
      checkIn: z.literal("07:15"),
      start: z.literal("08:00")
    }).strict(),
    morningPlan: z.object({
      planVersion: z.literal(2),
      wake: z.literal("06:15"),
      leave: z.literal("06:45"),
      status: z.literal("saved")
    }).strict(),
    practice: z.object({
      course: z.literal("Algebra I"),
      status: z.literal("completed"),
      summary: z.literal("One summer refresher completed.")
    }).strict(),
    guardianTask: z.object({
      label: z.literal("Complete the band physical form"),
      dueAt: z.literal("2026-07-24T17:00:00-05:00"),
      status: z.literal("needs_guardian")
    }).strict()
  }).strict(),
  privacy: z.object({
    excluded: z.tuple([
      z.literal("Algebra answer"),
      z.literal("step-by-step work"),
      z.literal("attempt count"),
      z.literal("hint count"),
      z.literal("private coaching")
    ])
  }).strict(),
  generatedAt: z.string().datetime()
}).strict();

export type GuardianProjection = z.infer<typeof guardianProjectionSchema>;

const guardianPublishedResultSchema: z.ZodType<GuardianPublishedResult> = z.object({
  published: z.literal(true),
  projectionVersion: z.literal(1),
  phase: z.literal("GUARDIAN_PUBLISHED"),
  publishedAt: z.string().datetime(),
  recipient: z.literal("Matt"),
  view: guardianProjectionSchema,
  proof: z.object({
    approvalId: z.string().regex(/^action_[a-f0-9]{24}$/),
    argsHash: z.string().regex(/^[a-f0-9]{64}$/),
    projectionHash: z.string().regex(/^[a-f0-9]{64}$/),
    stateVersion: z.number().int().positive()
  }).strict()
}).strict();

export class GuardianProjectionError extends Error {
  readonly code:
    | "GUARDIAN_SCOPE_MISMATCH"
    | "GUARDIAN_CONTEXT_MISMATCH"
    | "GUARDIAN_APPROVAL_NOT_FOUND";

  constructor(code: GuardianProjectionError["code"], message: string) {
    super(message);
    this.name = "GuardianProjectionError";
    this.code = code;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertStudentScope(session: SessionRecord): void {
  if (session.role !== "student" || session.actorId !== emilyFixture.id) {
    throw new GuardianProjectionError(
      "GUARDIAN_SCOPE_MISMATCH",
      "The guardian view is outside this student session."
    );
  }
}

function buildProjection(
  sessionId: string,
  plan: MorningPlan,
  practice: PracticeProgress,
  generatedAt: string
): GuardianProjection {
  if (
    plan.steps[0]?.time !== bandCampV2.wake ||
    plan.steps[1]?.time !== "06:30" ||
    plan.steps[2]?.time !== bandCampV2.departure ||
    plan.steps[3]?.time !== bandCampV2.checkIn ||
    practice.sessionId !== sessionId ||
    practice.exerciseId !== "linear_equation_01" ||
    practice.status !== "completed"
  ) {
    throw new GuardianProjectionError(
      "GUARDIAN_CONTEXT_MISMATCH",
      "The saved plan and completed practice do not match the guardian preview contract."
    );
  }
  return guardianProjectionSchema.parse({
    projectionVersion: 1,
    recipient: { id: mattFixture.id, name: mattFixture.name, relationship: mattFixture.relationship },
    student: { id: emilyFixture.id, name: emilyFixture.name, grade: emilyFixture.grade },
    headline: "Emily is on track for band camp.",
    shared: {
      bandCamp: { date: bandCampV2.date, checkIn: bandCampV2.checkIn, start: bandCampV2.start },
      morningPlan: {
        planVersion: 2,
        wake: plan.steps[0].time,
        leave: plan.steps[2].time,
        status: "saved"
      },
      practice: {
        course: "Algebra I",
        status: "completed",
        summary: "One summer refresher completed."
      },
      guardianTask: {
        label: guardianAction.label,
        dueAt: guardianAction.dueAt,
        status: guardianAction.status
      }
    },
    privacy: {
      excluded: ["Algebra answer", "step-by-step work", "attempt count", "hint count", "private coaching"]
    },
    generatedAt
  });
}

function exactApprovalArgs(projection: GuardianProjection, projectionHash: string) {
  return { projectionVersion: 1 as const, projectionHash, projection };
}

function expectedVersions(stateVersion: number): VersionExpectation {
  return { stateVersion, sourceVersion: 2, planVersion: 2 };
}

export async function stageGuardianPreview(input: {
  session: SessionRecord;
  plan: MorningPlan;
  practice: PracticeProgress;
  store: GuardianProjectionStore;
  now?: () => Date;
  nonce?: string;
}) {
  assertStudentScope(input.session);
  const plan = morningPlanSchema.parse(input.plan);
  const nextState = transitionSession(input.session.state, { type: "PREVIEW_GUARDIAN" });
  if (
    nextState.phase !== "GUARDIAN_PREVIEWED" ||
    nextState.sourceVersion !== 2 ||
    nextState.activePlanVersion !== 2
  ) {
    throw new GuardianProjectionError("GUARDIAN_CONTEXT_MISMATCH", "Guardian preview requires completed Plan V2 practice.");
  }
  const now = (input.now ?? (() => new Date()))();
  const projection = buildProjection(input.session.id, plan, input.practice, now.toISOString());
  const projectionHash = await sha256Hex(canonicalJson(projection));
  const expected = expectedVersions(nextState.stateVersion);
  const created = await createPendingAction({
    sessionId: input.session.id,
    actor: input.session.actorId,
    actionType: "PUBLISH_GUARDIAN",
    args: exactApprovalArgs(projection, projectionHash),
    expected,
    nowMs: now.getTime(),
    nonce: input.nonce
  });
  await input.store.stagePreview({
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: { ...nextState, phase: "GUARDIAN_PREVIEWED", sourceVersion: 2, activePlanVersion: 2 },
    projection,
    projectionHash,
    pending: created.pending,
    createdAt: now.toISOString()
  });
  return {
    preview: projection,
    approval: {
      actionId: created.pending.id,
      receipt: created.receipt,
      expiresAt: new Date(created.pending.expiresAt).toISOString(),
      projectionVersion: 1 as const,
      stateVersion: nextState.stateVersion
    },
    proof: {
      projectionHash,
      sourceVersion: 2 as const,
      activePlanVersion: 2 as const,
      privateFieldCount: projection.privacy.excluded.length
    }
  };
}

export async function approveGuardianProjection(input: {
  session: SessionRecord;
  actionId: string;
  receipt: string;
  store: GuardianProjectionStore;
  now?: () => Date;
  randomUUID?: () => string;
}): Promise<GuardianPublishedResult> {
  assertStudentScope(input.session);
  const record = await input.store.findPending(input.session.id, input.actionId);
  if (!record) {
    throw new GuardianProjectionError("GUARDIAN_APPROVAL_NOT_FOUND", "The guardian approval was not found.");
  }
  if (
    record.pending.sessionId !== input.session.id ||
    record.pending.actor !== input.session.actorId ||
    record.pending.actionType !== "PUBLISH_GUARDIAN" ||
    record.pending.expected.sourceVersion !== 2 ||
    record.pending.expected.planVersion !== 2
  ) {
    throw new GuardianProjectionError("GUARDIAN_SCOPE_MISMATCH", "The guardian approval is outside this session.");
  }
  const projection = guardianProjectionSchema.parse(record.projection);
  const projectionHash = await sha256Hex(canonicalJson(projection));
  if (projectionHash !== record.projectionHash) {
    throw new GuardianProjectionError("GUARDIAN_CONTEXT_MISMATCH", "The guardian projection integrity check failed.");
  }
  const now = (input.now ?? (() => new Date()))();
  await verifyApproval({
    pending: record.pending,
    receipt: input.receipt,
    args: exactApprovalArgs(projection, projectionHash),
    expected: record.pending.expected,
    nowMs: now.getTime()
  });
  if (record.consumedAt) {
    if (!record.publishResult) {
      throw new GuardianProjectionError("GUARDIAN_APPROVAL_NOT_FOUND", "The published guardian view is unavailable.");
    }
    return guardianPublishedResultSchema.parse(record.publishResult);
  }
  if (
    input.session.state.phase !== "GUARDIAN_PREVIEWED" ||
    input.session.state.stateVersion !== record.pending.expected.stateVersion ||
    input.session.state.sourceVersion !== 2 ||
    input.session.state.activePlanVersion !== 2
  ) {
    throw new ApprovalError("VERSION_MISMATCH", "The guardian preview is no longer current.");
  }
  const nextState = transitionSession(input.session.state, {
    type: "PUBLISH_GUARDIAN",
    approvalVerified: true
  });
  if (
    nextState.phase !== "GUARDIAN_PUBLISHED" ||
    nextState.sourceVersion !== 2 ||
    nextState.activePlanVersion !== 2
  ) {
    throw new ApprovalError("VERSION_MISMATCH", "The guardian view could not be published.");
  }
  const write: PublishedGuardianProjectionWrite = {
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: { ...nextState, phase: "GUARDIAN_PUBLISHED", sourceVersion: 2, activePlanVersion: 2 },
    projection,
    projectionHash,
    pending: record.pending,
    approvedBy: "student_emily",
    publishedAt: now.toISOString(),
    auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
  };
  return input.store.publishProjection(write);
}
