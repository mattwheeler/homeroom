import type { GuardianProjection } from "../domain/guardian-projection";
import type { SessionState } from "../domain/state-machine";
import type { PendingAction } from "../security/approval";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface GuardianPublishedResult {
  published: true;
  projectionVersion: 1;
  phase: "GUARDIAN_PUBLISHED";
  publishedAt: string;
  recipient: "Matt";
  view: GuardianProjection;
  proof: {
    approvalId: string;
    argsHash: string;
    projectionHash: string;
    stateVersion: number;
  };
}

export interface StagedGuardianPreviewWrite {
  sessionId: string;
  previousStateVersion: number;
  nextState: SessionState & {
    phase: "GUARDIAN_PREVIEWED";
    sourceVersion: 2;
    activePlanVersion: 2;
  };
  projection: GuardianProjection;
  projectionHash: string;
  pending: PendingAction;
  createdAt: string;
}

export interface PendingGuardianProjectionRecord {
  pending: PendingAction;
  projection: GuardianProjection;
  projectionHash: string;
  consumedAt: string | null;
  publishResult: GuardianPublishedResult | null;
}

export interface PublishedGuardianProjectionWrite {
  sessionId: string;
  previousStateVersion: number;
  nextState: SessionState & {
    phase: "GUARDIAN_PUBLISHED";
    sourceVersion: 2;
    activePlanVersion: 2;
  };
  projection: GuardianProjection;
  projectionHash: string;
  pending: PendingAction;
  approvedBy: "student_emily";
  publishedAt: string;
  auditEventId: string;
}

export interface GuardianProjectionStore {
  stagePreview(write: StagedGuardianPreviewWrite): Promise<void>;
  findPending(sessionId: string, actionId: string): Promise<PendingGuardianProjectionRecord | null>;
  publishProjection(write: PublishedGuardianProjectionWrite): Promise<GuardianPublishedResult>;
}

interface PendingGuardianRow {
  id: string;
  session_id: string;
  actor_id: string;
  action_type: string;
  args_hash: string;
  expected_state_version: number;
  expected_plan_version: number;
  expected_source_version: number;
  approval_nonce_hash: string;
  idempotency_key: string;
  expires_at: string;
  consumed_at: string | null;
  result_json: string;
}

interface StoredGuardianPendingResult {
  projection: GuardianProjection;
  projectionHash: string;
  publishResult?: GuardianPublishedResult | null;
}

export class GuardianStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianStoreError";
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new GuardianStoreError("D1 atomic batch support is required for guardian writes.");
  return database.batch.bind(database);
}

function assertBatchResults(results: D1RunResult[], expectedCount: number, message: string): void {
  if (
    results.length !== expectedCount ||
    results.some((result) => !result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1))
  ) {
    throw new GuardianStoreError(message);
  }
}

export class D1GuardianProjectionStore implements GuardianProjectionStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async stagePreview(write: StagedGuardianPreviewWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, source_version = 2,
          active_plan_version = 2, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 2
          AND active_plan_version = 2`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.createdAt,
        write.sessionId,
        write.previousStateVersion
      );
    const insertPending = this.database
      .prepare(
        `INSERT INTO pending_actions (
          id, session_id, action_type, args_hash, expected_state_version,
          expected_plan_version, expected_source_version, approval_nonce_hash,
          idempotency_key, expires_at, consumed_at, result_json
        )
        SELECT ?, sessions.id, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
          json_object('projection', json(?), 'projectionHash', ?, 'publishResult', NULL)
        FROM demo_sessions AS sessions
        WHERE sessions.id = ? AND sessions.state_version = ?
          AND sessions.source_version = 2 AND sessions.active_plan_version = 2
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions AS existing
            WHERE existing.session_id = sessions.id
              AND existing.action_type = ?
              AND existing.expected_state_version = ?
              AND existing.expected_plan_version = 2
              AND existing.expected_source_version = 2
              AND existing.consumed_at IS NULL
          )`
      )
      .bind(
        write.pending.id,
        write.pending.actionType,
        write.pending.argsHash,
        write.pending.expected.stateVersion,
        write.pending.expected.planVersion,
        write.pending.expected.sourceVersion,
        write.pending.nonceHash,
        write.pending.idempotencyKey,
        new Date(write.pending.expiresAt).toISOString(),
        JSON.stringify(write.projection),
        write.projectionHash,
        write.sessionId,
        write.nextState.stateVersion,
        write.pending.actionType,
        write.pending.expected.stateVersion
      );
    const results = await batch([updateSession, insertPending]);
    assertBatchResults(results, 2, "Unable to stage the guardian preview.");
  }

  async findPending(sessionId: string, actionId: string): Promise<PendingGuardianProjectionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT pending.id, pending.session_id, sessions.actor_id,
          pending.action_type, pending.args_hash, pending.expected_state_version,
          pending.expected_plan_version, pending.expected_source_version,
          pending.approval_nonce_hash, pending.idempotency_key,
          pending.expires_at, pending.consumed_at, pending.result_json
        FROM pending_actions AS pending
        INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
        WHERE pending.id = ? AND pending.session_id = ? LIMIT 1`
      )
      .bind(actionId, sessionId)
      .first<PendingGuardianRow>();
    if (!row) return null;
    const stored = JSON.parse(row.result_json) as StoredGuardianPendingResult;
    return {
      pending: {
        id: row.id,
        sessionId: row.session_id,
        actor: row.actor_id,
        actionType: row.action_type,
        argsHash: row.args_hash,
        expected: {
          stateVersion: row.expected_state_version,
          planVersion: row.expected_plan_version,
          sourceVersion: row.expected_source_version
        },
        nonceHash: row.approval_nonce_hash,
        idempotencyKey: row.idempotency_key,
        expiresAt: Date.parse(row.expires_at)
      },
      projection: stored.projection,
      projectionHash: stored.projectionHash,
      consumedAt: row.consumed_at,
      publishResult: stored.publishResult ?? null
    };
  }

  async publishProjection(write: PublishedGuardianProjectionWrite): Promise<GuardianPublishedResult> {
    const batch = requireBatch(this.database);
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
    const insertProjection = this.database
      .prepare(
        `INSERT INTO guardian_projections (
          session_id, projection_version, projection_json, projection_hash,
          approved_by, published_at
        )
        SELECT pending.session_id, 1, ?, ?, ?, ?
        FROM pending_actions AS pending
        INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
        WHERE pending.id = ? AND pending.session_id = ?
          AND pending.action_type = ? AND pending.args_hash = ?
          AND pending.approval_nonce_hash = ? AND pending.idempotency_key = ?
          AND pending.consumed_at IS NULL
          AND json_extract(pending.result_json, '$.projectionHash') = ?
          AND sessions.state_version = ? AND sessions.source_version = 2
          AND sessions.active_plan_version = 2`
      )
      .bind(
        JSON.stringify(write.projection),
        write.projectionHash,
        write.approvedBy,
        write.publishedAt,
        write.pending.id,
        write.sessionId,
        "PUBLISH_GUARDIAN",
        write.pending.argsHash,
        write.pending.nonceHash,
        write.pending.idempotencyKey,
        write.projectionHash,
        write.previousStateVersion
      );
    const consumePending = this.database
      .prepare(
        `UPDATE pending_actions
        SET consumed_at = ?, result_json = ?
        WHERE id = ? AND session_id = ? AND consumed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM guardian_projections
            WHERE session_id = ? AND projection_version = 1
              AND projection_hash = ?
          )`
      )
      .bind(
        write.publishedAt,
        JSON.stringify({ projection: write.projection, projectionHash: write.projectionHash, publishResult: result }),
        write.pending.id,
        write.sessionId,
        write.sessionId,
        write.projectionHash
      );
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, source_version = 2,
          active_plan_version = 2, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 2
          AND active_plan_version = 2
          AND EXISTS (
            SELECT 1 FROM guardian_projections
            WHERE session_id = ? AND projection_version = 1
              AND projection_hash = ?
          )`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.publishedAt,
        write.sessionId,
        write.previousStateVersion,
        write.sessionId,
        write.projectionHash
      );
    const insertAudit = this.database
      .prepare(
        `INSERT INTO audit_events (
          id, session_id, sequence, actor, event_type, tool_name,
          source_record_ids_json, state_version, evidence_json, created_at
        )
        SELECT ?, sessions.id, COALESCE(MAX(audits.sequence), 0) + 1,
          ?, ?, NULL, ?, ?, ?, ?
        FROM demo_sessions AS sessions
        LEFT JOIN audit_events AS audits ON audits.session_id = sessions.id
        WHERE sessions.id = ? AND sessions.state_version = ?
          AND EXISTS (
            SELECT 1 FROM guardian_projections
            WHERE session_id = sessions.id AND projection_version = 1
              AND projection_hash = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM audit_events AS existing
            WHERE existing.session_id = sessions.id
              AND existing.event_type = ? AND existing.state_version = ?
          )
        GROUP BY sessions.id`
      )
      .bind(
        write.auditEventId,
        write.approvedBy,
        "GUARDIAN_SUMMARY_PUBLISHED",
        JSON.stringify(["event_band_camp_day_1", "guardian_action_physical_form", "course_algebra_1"]),
        write.nextState.stateVersion,
        JSON.stringify({
          approvalId: write.pending.id,
          argsHash: write.pending.argsHash,
          projectionVersion: 1,
          projectionHash: write.projectionHash,
          recipient: "guardian_matt",
          approvedBy: write.approvedBy,
          privateExcluded: write.projection.privacy.excluded.length
        }),
        write.publishedAt,
        write.sessionId,
        write.nextState.stateVersion,
        write.projectionHash,
        "GUARDIAN_SUMMARY_PUBLISHED",
        write.nextState.stateVersion
      );
    const results = await batch([insertProjection, consumePending, updateSession, insertAudit]);
    assertBatchResults(results, 4, "Unable to publish the approved guardian view.");
    return result;
  }
}
