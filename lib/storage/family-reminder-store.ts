import type { FamilyReminder } from "../domain/family-reminder";
import type { PendingAction } from "../security/approval";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface SentFamilyReminderResult {
  sent: true;
  notificationId: string;
  recipient: "Matt";
  channel: "Homeroom guardian inbox";
  sentAt: string;
  reminder: FamilyReminder;
  proof: { approvalId: string; argsHash: string; stateVersion: number };
}

export interface StagedFamilyReminderWrite {
  sessionId: string;
  expectedStateVersion: number;
  expectedPlanVersion: number;
  reminder: FamilyReminder;
  pending: PendingAction;
  createdAt: string;
}

export interface PendingFamilyReminder {
  pending: PendingAction;
  reminder: FamilyReminder;
  consumedAt: string | null;
  sentResult: SentFamilyReminderResult | null;
}

export interface SentFamilyReminderWrite {
  sessionId: string;
  expectedStateVersion: number;
  expectedPlanVersion: number;
  reminder: FamilyReminder;
  pending: PendingAction;
  notificationId: string;
  sentBy: "student_emily";
  sentAt: string;
  auditEventId: string;
}

export interface FamilyReminderStore {
  stageReminder(write: StagedFamilyReminderWrite): Promise<void>;
  findPending(sessionId: string, actionId: string): Promise<PendingFamilyReminder | null>;
  sendReminder(write: SentFamilyReminderWrite): Promise<SentFamilyReminderResult>;
}

interface PendingRow {
  id: string; session_id: string; actor_id: string; action_type: string; args_hash: string;
  expected_state_version: number; expected_plan_version: number; expected_source_version: number;
  approval_nonce_hash: string; idempotency_key: string; expires_at: string; consumed_at: string | null;
  result_json: string;
}

export class FamilyReminderStoreError extends Error {
  constructor(message: string) { super(message); this.name = "FamilyReminderStoreError"; }
}

function assertChange(result: D1RunResult, message: string) {
  if (!result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1)) {
    throw new FamilyReminderStoreError(message);
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new FamilyReminderStoreError("D1 atomic batch support is required for Family writes.");
  return database.batch.bind(database);
}

export class D1FamilyReminderStore implements FamilyReminderStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async stageReminder(write: StagedFamilyReminderWrite): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO pending_actions (
        id, session_id, action_type, args_hash, expected_state_version,
        expected_plan_version, expected_source_version, approval_nonce_hash,
        idempotency_key, expires_at, consumed_at, result_json
      )
      SELECT ?, sessions.id, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
      FROM demo_sessions AS sessions
      WHERE sessions.id = ? AND sessions.state_version = ?
        AND sessions.source_version = ? AND COALESCE(sessions.active_plan_version, 0) = ?
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions AS existing
          WHERE existing.session_id = sessions.id AND existing.action_type = ?
            AND existing.consumed_at IS NULL
        )`
    ).bind(
      write.pending.id, write.pending.actionType, write.pending.argsHash,
      write.pending.expected.stateVersion, write.pending.expected.planVersion,
      write.pending.expected.sourceVersion, write.pending.nonceHash, write.pending.idempotencyKey,
      new Date(write.pending.expiresAt).toISOString(),
      JSON.stringify({ reminder: write.reminder, sentResult: null }),
      write.sessionId, write.expectedStateVersion, write.pending.expected.sourceVersion,
      write.expectedPlanVersion, write.pending.actionType
    ).run();
    assertChange(result, "Unable to stage the Family reminder.");
  }

  async findPending(sessionId: string, actionId: string): Promise<PendingFamilyReminder | null> {
    const row = await this.database.prepare(
      `SELECT pending.id, pending.session_id, sessions.actor_id, pending.action_type,
        pending.args_hash, pending.expected_state_version, pending.expected_plan_version,
        pending.expected_source_version, pending.approval_nonce_hash, pending.idempotency_key,
        pending.expires_at, pending.consumed_at, pending.result_json
      FROM pending_actions AS pending
      INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
      WHERE pending.id = ? AND pending.session_id = ? LIMIT 1`
    ).bind(actionId, sessionId).first<PendingRow>();
    if (!row) return null;
    const stored = JSON.parse(row.result_json) as { reminder: FamilyReminder; sentResult?: SentFamilyReminderResult | null };
    return {
      pending: {
        id: row.id, sessionId: row.session_id, actor: row.actor_id, actionType: row.action_type,
        argsHash: row.args_hash,
        expected: { stateVersion: row.expected_state_version, planVersion: row.expected_plan_version, sourceVersion: row.expected_source_version },
        nonceHash: row.approval_nonce_hash, idempotencyKey: row.idempotency_key, expiresAt: Date.parse(row.expires_at)
      },
      reminder: stored.reminder, consumedAt: row.consumed_at, sentResult: stored.sentResult ?? null
    };
  }

  async sendReminder(write: SentFamilyReminderWrite): Promise<SentFamilyReminderResult> {
    const batch = requireBatch(this.database);
    const result: SentFamilyReminderResult = {
      sent: true, notificationId: write.notificationId, recipient: "Matt",
      channel: "Homeroom guardian inbox", sentAt: write.sentAt, reminder: write.reminder,
      proof: { approvalId: write.pending.id, argsHash: write.pending.argsHash, stateVersion: write.expectedStateVersion }
    };
    const insertNotification = this.database.prepare(
      `INSERT INTO guardian_notifications (
        id, session_id, recipient_id, notification_type, task_record_id,
        notification_json, approval_args_hash, sent_by, sent_at, read_at
      )
      SELECT ?, pending.session_id, ?, ?, ?, ?, pending.args_hash, ?, ?, NULL
      FROM pending_actions AS pending
      INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
      WHERE pending.id = ? AND pending.session_id = ? AND pending.action_type = ?
        AND pending.args_hash = ? AND pending.approval_nonce_hash = ?
        AND pending.idempotency_key = ? AND pending.consumed_at IS NULL
        AND sessions.state_version = ? AND sessions.source_version = ?
        AND COALESCE(sessions.active_plan_version, 0) = ?`
    ).bind(
      write.notificationId, "guardian_matt", "guardian_task_reminder", write.reminder.task.id,
      JSON.stringify(write.reminder), write.sentBy, write.sentAt,
      write.pending.id, write.sessionId, "SEND_GUARDIAN_TASK_REMINDER",
      write.pending.argsHash, write.pending.nonceHash, write.pending.idempotencyKey,
      write.expectedStateVersion, write.pending.expected.sourceVersion, write.expectedPlanVersion
    );
    const consume = this.database.prepare(
      `UPDATE pending_actions SET consumed_at = ?, result_json = ?
      WHERE id = ? AND session_id = ? AND consumed_at IS NULL
        AND EXISTS (SELECT 1 FROM guardian_notifications WHERE id = ? AND approval_args_hash = ?)`
    ).bind(write.sentAt, JSON.stringify({ reminder: write.reminder, sentResult: result }), write.pending.id, write.sessionId, write.notificationId, write.pending.argsHash);
    const audit = this.database.prepare(
      `INSERT INTO audit_events (
        id, session_id, sequence, actor, event_type, tool_name,
        source_record_ids_json, state_version, evidence_json, created_at
      )
      SELECT ?, sessions.id, COALESCE(MAX(audits.sequence), 0) + 1, ?, ?, NULL, ?, ?, ?, ?
      FROM demo_sessions AS sessions
      LEFT JOIN audit_events AS audits ON audits.session_id = sessions.id
      WHERE sessions.id = ? AND sessions.state_version = ?
        AND EXISTS (SELECT 1 FROM guardian_notifications WHERE id = ?)
      GROUP BY sessions.id`
    ).bind(
      write.auditEventId, write.sentBy, "GUARDIAN_TASK_REMINDER_SENT",
      JSON.stringify([write.reminder.task.id]), write.expectedStateVersion,
      JSON.stringify({ notificationId: write.notificationId, approvalId: write.pending.id, argsHash: write.pending.argsHash, recipient: "guardian_matt", track: "family" }),
      write.sentAt, write.sessionId, write.expectedStateVersion, write.notificationId
    );
    const results = await batch([insertNotification, consume, audit]);
    if (results.length !== 3) throw new FamilyReminderStoreError("Unable to deliver the Family reminder.");
    results.forEach((entry) => assertChange(entry, "Unable to deliver the Family reminder."));
    return result;
  }
}
