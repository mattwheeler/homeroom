import { z } from "zod";

import { createPendingAction, verifyApproval, ApprovalError } from "../security/approval";
import type { FamilyReminderStore, SentFamilyReminderResult } from "../storage/family-reminder-store";
import type { SessionRecord } from "../storage/session-store";
import { emilyFixture, guardianAction, mattFixture } from "./fixtures";

export const familyReminderSchema = z.object({
  reminderVersion: z.literal(1),
  recipient: z.object({ id: z.literal("guardian_matt"), name: z.literal("Matt"), relationship: z.literal("Parent") }).strict(),
  sender: z.object({ id: z.literal("student_emily"), name: z.literal("Emily") }).strict(),
  task: z.object({
    id: z.literal("guardian_action_physical_form"),
    label: z.literal("Complete the band physical form"),
    dueAt: z.literal("2026-07-24T17:00:00-05:00")
  }).strict(),
  title: z.literal("Band physical form needs your help"),
  message: z.literal("Emily needs your help completing the band physical form by Friday, July 24."),
  createdAt: z.string().datetime()
}).strict();

export type FamilyReminder = z.infer<typeof familyReminderSchema>;

const sentResultSchema: z.ZodType<SentFamilyReminderResult> = z.object({
  sent: z.literal(true), notificationId: z.string().min(1), recipient: z.literal("Matt"),
  channel: z.literal("Homeroom guardian inbox"), sentAt: z.string().datetime(),
  reminder: familyReminderSchema,
  proof: z.object({ approvalId: z.string(), argsHash: z.string().regex(/^[a-f0-9]{64}$/), stateVersion: z.number().int().positive() }).strict()
}).strict();

export class FamilyReminderError extends Error {
  readonly code: "FAMILY_SCOPE_MISMATCH" | "FAMILY_APPROVAL_NOT_FOUND";
  constructor(code: FamilyReminderError["code"], message: string) { super(message); this.name = "FamilyReminderError"; this.code = code; }
}

function assertScope(session: SessionRecord) {
  if (session.role !== "student" || session.actorId !== emilyFixture.id) {
    throw new FamilyReminderError("FAMILY_SCOPE_MISMATCH", "The Family action is outside this student workspace.");
  }
}

function args(reminder: FamilyReminder) { return { reminderVersion: 1 as const, reminder }; }

export async function stageFamilyReminder(input: { session: SessionRecord; store: FamilyReminderStore; now?: () => Date; nonce?: string }) {
  assertScope(input.session);
  const now = (input.now ?? (() => new Date()))();
  const reminder = familyReminderSchema.parse({
    reminderVersion: 1,
    recipient: { id: mattFixture.id, name: mattFixture.name, relationship: mattFixture.relationship },
    sender: { id: emilyFixture.id, name: emilyFixture.name },
    task: { id: guardianAction.id, label: guardianAction.label, dueAt: guardianAction.dueAt },
    title: "Band physical form needs your help",
    message: "Emily needs your help completing the band physical form by Friday, July 24.",
    createdAt: now.toISOString()
  });
  const expectedPlanVersion = input.session.state.activePlanVersion ?? 0;
  const created = await createPendingAction({
    sessionId: input.session.id, actor: input.session.actorId,
    actionType: "SEND_GUARDIAN_TASK_REMINDER", args: args(reminder),
    expected: { stateVersion: input.session.state.stateVersion, sourceVersion: input.session.state.sourceVersion, planVersion: expectedPlanVersion },
    nowMs: now.getTime(), nonce: input.nonce
  });
  await input.store.stageReminder({
    sessionId: input.session.id, expectedStateVersion: input.session.state.stateVersion,
    expectedPlanVersion, reminder, pending: created.pending, createdAt: now.toISOString()
  });
  return {
    preview: reminder,
    approval: { actionId: created.pending.id, receipt: created.receipt, expiresAt: new Date(created.pending.expiresAt).toISOString() },
    proof: { independentTrack: "family" as const, stateUnchanged: true as const, stateVersion: input.session.state.stateVersion }
  };
}

export async function approveFamilyReminder(input: { session: SessionRecord; store: FamilyReminderStore; actionId: string; receipt: string; now?: () => Date; randomUUID?: () => string }): Promise<SentFamilyReminderResult> {
  assertScope(input.session);
  const record = await input.store.findPending(input.session.id, input.actionId);
  if (!record || record.pending.actionType !== "SEND_GUARDIAN_TASK_REMINDER" || record.pending.actor !== input.session.actorId) {
    throw new FamilyReminderError("FAMILY_APPROVAL_NOT_FOUND", "The Family reminder approval was not found.");
  }
  const reminder = familyReminderSchema.parse(record.reminder);
  const now = (input.now ?? (() => new Date()))();
  await verifyApproval({ pending: record.pending, receipt: input.receipt, args: args(reminder), expected: record.pending.expected, nowMs: now.getTime() });
  if (record.consumedAt) {
    if (!record.sentResult) throw new FamilyReminderError("FAMILY_APPROVAL_NOT_FOUND", "The delivered reminder is unavailable.");
    return sentResultSchema.parse(record.sentResult);
  }
  const currentPlanVersion = input.session.state.activePlanVersion ?? 0;
  if (
    input.session.state.stateVersion !== record.pending.expected.stateVersion ||
    input.session.state.sourceVersion !== record.pending.expected.sourceVersion ||
    currentPlanVersion !== record.pending.expected.planVersion
  ) throw new ApprovalError("VERSION_MISMATCH", "The reminder preview is no longer current.");
  const notificationId = input.randomUUID?.() ?? crypto.randomUUID();
  return input.store.sendReminder({
    sessionId: input.session.id, expectedStateVersion: input.session.state.stateVersion,
    expectedPlanVersion: currentPlanVersion, reminder, pending: record.pending,
    notificationId, sentBy: "student_emily", sentAt: now.toISOString(), auditEventId: `audit_${notificationId}`
  });
}
