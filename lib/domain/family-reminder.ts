import { z } from "zod";

import { createPendingAction, verifyApproval, ApprovalError } from "../security/approval";
import type { FamilyReminderStore, SentFamilyReminderResult } from "../storage/family-reminder-store";
import type { SessionRecord } from "../storage/session-store";
import type { ProjectedGuardianAssist } from "./student-source-projection";
import { emilyFixture, mattFixture } from "./fixtures";

export const familyReminderSchema = z.object({
  reminderVersion: z.literal(1),
  recipient: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(80), relationship: z.literal("Parent") }).strict(),
  sender: z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(80) }).strict(),
  task: z.object({
    id: z.string().min(1).max(256),
    label: z.string().min(1).max(200),
    dueAt: z.string().min(10).max(64).nullable()
  }).strict(),
  source: z.object({
    provider: z.literal("google_classroom"),
    externalId: z.string().min(1).max(256),
    label: z.string().min(1).max(200)
  }).strict(),
  title: z.string().min(1).max(220),
  message: z.string().min(1).max(600),
  createdAt: z.string().datetime()
}).strict();

export type FamilyReminder = z.infer<typeof familyReminderSchema>;

const sentResultSchema: z.ZodType<SentFamilyReminderResult> = z.object({
  sent: z.literal(true), notificationId: z.string().min(1), recipient: z.string().min(1),
  channel: z.literal("Homeroom guardian inbox"), sentAt: z.string().datetime(),
  reminder: familyReminderSchema,
  proof: z.object({ approvalId: z.string(), argsHash: z.string().regex(/^[a-f0-9]{64}$/), stateVersion: z.number().int().positive() }).strict()
}).strict();

export class FamilyReminderError extends Error {
  readonly code: "FAMILY_SCOPE_MISMATCH" | "FAMILY_APPROVAL_NOT_FOUND" | "FAMILY_SOURCE_NOT_FOUND";
  constructor(code: FamilyReminderError["code"], message: string) { super(message); this.name = "FamilyReminderError"; this.code = code; }
}

function assertScope(session: SessionRecord) {
  if (session.role !== "student") {
    throw new FamilyReminderError("FAMILY_SCOPE_MISMATCH", "The Family action is outside this student workspace.");
  }
}

function args(reminder: FamilyReminder) { return { reminderVersion: 1 as const, reminder }; }

function dueAt(candidate: ProjectedGuardianAssist): string | null {
  if (!candidate.due) return null;
  return candidate.due.time ? `${candidate.due.date}T${candidate.due.time}` : candidate.due.date;
}

function duePhrase(candidate: ProjectedGuardianAssist): string {
  if (!candidate.due) return "";
  const parsed = new Date(`${candidate.due.date}T12:00:00Z`);
  const date = Number.isNaN(parsed.getTime())
    ? candidate.due.date
    : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(parsed);
  return ` It is due ${date}.`;
}

export async function stageFamilyReminder(input: {
  session: SessionRecord;
  store: FamilyReminderStore;
  candidate: ProjectedGuardianAssist;
  now?: () => Date;
  nonce?: string;
}) {
  assertScope(input.session);
  const now = (input.now ?? (() => new Date()))();
  const reminder = familyReminderSchema.parse({
    reminderVersion: 1,
    recipient: { id: input.session.guardianId ?? mattFixture.id, name: mattFixture.name, relationship: mattFixture.relationship },
    sender: { id: input.session.actorId, name: emilyFixture.name },
    task: { id: input.candidate.taskId, label: input.candidate.title, dueAt: dueAt(input.candidate) },
    source: {
      provider: "google_classroom",
      externalId: input.candidate.source.externalId,
      label: `${input.candidate.courseName} · Google Classroom`
    },
    title: `${input.candidate.title} may need your help`,
    message: `${emilyFixture.name} found a source-backed ${input.candidate.courseName} item that may need a parent or guardian: ${input.candidate.title}.${duePhrase(input.candidate)}`,
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
    notificationId, recipientId: reminder.recipient.id, sentBy: input.session.actorId, sentAt: now.toISOString(), auditEventId: `audit_${notificationId}`
  });
}
