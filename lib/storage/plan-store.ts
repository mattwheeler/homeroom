import type { MorningPlan } from "../ai/morning-plan";
import type { SessionState } from "../domain/state-machine";
import type { BandSourceChange } from "../domain/source-sync";
import type { PendingAction } from "../security/approval";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface PlanV1ApprovalResult {
  saved: true;
  planVersion: 1;
  phase: "PLAN_V1_SAVED";
  savedAt: string;
  proof: {
    approvalId: string;
    argsHash: string;
    sourceVersion: 1;
    stateVersion: number;
  };
}

export interface PlanV2ApprovalResult {
  saved: true;
  planVersion: 2;
  phase: "PLAN_V2_SAVED";
  savedAt: string;
  proof: {
    approvalId: string;
    argsHash: string;
    sourceVersion: 2;
    stateVersion: number;
  };
}

export type PlanApprovalResult = PlanV1ApprovalResult | PlanV2ApprovalResult;

export interface StagedPlanWrite {
  sessionId: string;
  previousStateVersion: number;
  previousActivePlanVersion: 1 | null;
  nextState: SessionState;
  plan: MorningPlan;
  pending: PendingAction;
  createdAt: string;
}

export interface PendingPlanRecord {
  pending: PendingAction;
  plan: MorningPlan;
  consumedAt: string | null;
  approvalResult: PlanApprovalResult | null;
}

export interface ApprovedPlanWrite {
  sessionId: string;
  previousStateVersion: number;
  previousActivePlanVersion: null;
  nextState: SessionState & { phase: "PLAN_V1_SAVED"; sourceVersion: 1; activePlanVersion: 1 };
  plan: MorningPlan;
  pending: PendingAction;
  approvedBy: string;
  approvedAt: string;
  auditEventId: string;
}

export interface ApprovedPlanV2Write {
  sessionId: string;
  previousStateVersion: number;
  previousActivePlanVersion: 1;
  nextState: SessionState & { phase: "PLAN_V2_SAVED"; sourceVersion: 2; activePlanVersion: 2 };
  plan: MorningPlan;
  pending: PendingAction;
  approvedBy: string;
  approvedAt: string;
  auditEventId: string;
}

export interface SourceSyncWrite {
  sessionId: string;
  previousStateVersion: number;
  nextState: SessionState & { phase: "SOURCE_V2_SYNCED"; sourceVersion: 2; activePlanVersion: 1 };
  change: BandSourceChange;
  syncedAt: string;
  auditEventId: string;
}

export interface SourceSyncStore {
  syncSourceV2(write: SourceSyncWrite): Promise<void>;
}

export interface PlanApprovalStore {
  stageProposal(write: StagedPlanWrite): Promise<void>;
  findPending(sessionId: string, actionId: string): Promise<PendingPlanRecord | null>;
  approvePlan(write: ApprovedPlanWrite): Promise<PlanV1ApprovalResult>;
  approvePlanV2(write: ApprovedPlanV2Write): Promise<PlanV2ApprovalResult>;
}

export interface PlanV2Store extends PlanApprovalStore, SourceSyncStore {
  findApprovedPlan(sessionId: string, planVersion: 1 | 2): Promise<MorningPlan | null>;
}

interface PendingPlanRow {
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

interface StoredPendingResult {
  plan: MorningPlan;
  approvalResult?: PlanApprovalResult | null;
}

interface ApprovedPlanRow {
  approved_plan_json: string;
}

export class PlanStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanStoreError";
  }
}

function assertBatchResults(results: D1RunResult[], expectedCount: number, message: string): void {
  if (
    results.length !== expectedCount ||
    results.some((result) => !result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1))
  ) {
    throw new PlanStoreError(message);
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new PlanStoreError("D1 atomic batch support is required for plan writes.");
  return database.batch.bind(database);
}

export class D1PlanApprovalStore implements PlanV2Store {
  constructor(private readonly database: D1DatabaseLike) {}

  async stageProposal(write: StagedPlanWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, source_version = ?,
          active_plan_version = ?, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = ?
          AND active_plan_version IS ?`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.nextState.sourceVersion,
        write.nextState.activePlanVersion,
        write.createdAt,
        write.sessionId,
        write.previousStateVersion,
        write.nextState.sourceVersion,
        write.previousActivePlanVersion
      );
    const insertPending = this.database
      .prepare(
        `INSERT INTO pending_actions (
          id, session_id, action_type, args_hash, expected_state_version,
          expected_plan_version, expected_source_version, approval_nonce_hash,
          idempotency_key, expires_at, consumed_at, result_json
        )
        SELECT ?, sessions.id, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
        FROM demo_sessions AS sessions
        WHERE sessions.id = ? AND sessions.state_version = ?
          AND sessions.source_version = ?
          AND sessions.active_plan_version IS ?
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions AS existing
            WHERE existing.session_id = sessions.id
              AND existing.expected_state_version = ?
              AND existing.expected_plan_version = ?
              AND existing.expected_source_version = ?
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
        JSON.stringify({ plan: write.plan, approvalResult: null }),
        write.sessionId,
        write.nextState.stateVersion,
        write.nextState.sourceVersion,
        write.nextState.activePlanVersion,
        write.pending.expected.stateVersion,
        write.pending.expected.planVersion,
        write.pending.expected.sourceVersion
      );
    const results = await batch([updateSession, insertPending]);
    assertBatchResults(results, 2, "Unable to stage the plan proposal.");
  }

  async syncSourceV2(write: SourceSyncWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, source_version = 2,
          active_plan_version = 1, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 1
          AND active_plan_version = 1`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.syncedAt,
        write.sessionId,
        write.previousStateVersion
      );
    const insertAudit = this.database
      .prepare(
        `INSERT INTO audit_events (
          id, session_id, sequence, actor, event_type, tool_name,
          source_record_ids_json, state_version, evidence_json, created_at
        )
        SELECT ?, sessions.id, COALESCE(MAX(audit.sequence), 0) + 1,
          ?, ?, ?, ?, ?, ?, ?
        FROM demo_sessions AS sessions
        LEFT JOIN audit_events AS audit ON audit.session_id = sessions.id
        WHERE sessions.id = ? AND sessions.state_version = ?
          AND sessions.source_version = 2 AND sessions.active_plan_version = 1
          AND NOT EXISTS (
            SELECT 1 FROM audit_events AS existing
            WHERE existing.session_id = sessions.id
              AND existing.event_type = ? AND existing.state_version = ?
          )
        GROUP BY sessions.id`
      )
      .bind(
        write.auditEventId,
        "system_band_fixture",
        "SOURCE_V2_SYNCED",
        "sync_activity_calendar",
        JSON.stringify([write.change.sourceRecordId]),
        write.nextState.stateVersion,
        JSON.stringify(write.change),
        write.syncedAt,
        write.sessionId,
        write.nextState.stateVersion,
        "SOURCE_V2_SYNCED",
        write.nextState.stateVersion
      );
    const results = await batch([updateSession, insertAudit]);
    assertBatchResults(results, 2, "Unable to persist the controlled source update.");
  }

  async findApprovedPlan(sessionId: string, planVersion: 1 | 2): Promise<MorningPlan | null> {
    const row = await this.database
      .prepare(
        `SELECT approved_plan_json FROM plan_versions
        WHERE session_id = ? AND plan_version = ? LIMIT 1`
      )
      .bind(sessionId, planVersion)
      .first<ApprovedPlanRow>();
    return row ? JSON.parse(row.approved_plan_json) as MorningPlan : null;
  }

  async findPending(sessionId: string, actionId: string): Promise<PendingPlanRecord | null> {
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
      .first<PendingPlanRow>();
    if (!row) return null;
    const stored = JSON.parse(row.result_json) as StoredPendingResult;
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
      plan: stored.plan,
      consumedAt: row.consumed_at,
      approvalResult: stored.approvalResult ?? null
    };
  }

  async approvePlan(write: ApprovedPlanWrite): Promise<PlanV1ApprovalResult> {
    return this.approvePlanVersion(write, {
      planVersion: 1,
      sourceVersion: 1,
      eventType: "PLAN_V1_APPROVED",
      expectedAction: "APPROVE_PLAN_V1"
    }) as Promise<PlanV1ApprovalResult>;
  }

  async approvePlanV2(write: ApprovedPlanV2Write): Promise<PlanV2ApprovalResult> {
    return this.approvePlanVersion(write, {
      planVersion: 2,
      sourceVersion: 2,
      eventType: "PLAN_V2_APPROVED",
      expectedAction: "APPROVE_PLAN_V2"
    }) as Promise<PlanV2ApprovalResult>;
  }

  private async approvePlanVersion(
    write: ApprovedPlanWrite | ApprovedPlanV2Write,
    config: {
      planVersion: 1 | 2;
      sourceVersion: 1 | 2;
      eventType: "PLAN_V1_APPROVED" | "PLAN_V2_APPROVED";
      expectedAction: "APPROVE_PLAN_V1" | "APPROVE_PLAN_V2";
    }
  ): Promise<PlanApprovalResult> {
    const batch = requireBatch(this.database);
    const result = {
      saved: true,
      planVersion: config.planVersion,
      phase: config.planVersion === 1 ? "PLAN_V1_SAVED" : "PLAN_V2_SAVED",
      savedAt: write.approvedAt,
      proof: {
        approvalId: write.pending.id,
        argsHash: write.pending.argsHash,
        sourceVersion: config.sourceVersion,
        stateVersion: write.nextState.stateVersion
      }
    } as PlanApprovalResult;
    const insertPlan = this.database
      .prepare(
        `INSERT INTO plan_versions (
          session_id, plan_version, source_version, proposal_json,
          approved_plan_json, approval_args_hash, approved_by, approved_at
        )
        SELECT pending.session_id, ?, ?, ?, ?, pending.args_hash, ?, ?
        FROM pending_actions AS pending
        INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
        WHERE pending.id = ? AND pending.session_id = ?
          AND pending.action_type = ? AND pending.args_hash = ?
          AND pending.approval_nonce_hash = ? AND pending.idempotency_key = ?
          AND pending.consumed_at IS NULL
          AND sessions.state_version = ? AND sessions.source_version = ?
          AND sessions.active_plan_version IS ?`
      )
      .bind(
        config.planVersion,
        config.sourceVersion,
        JSON.stringify(write.plan),
        JSON.stringify(write.plan),
        write.approvedBy,
        write.approvedAt,
        write.pending.id,
        write.sessionId,
        config.expectedAction,
        write.pending.argsHash,
        write.pending.nonceHash,
        write.pending.idempotencyKey,
        write.previousStateVersion,
        config.sourceVersion,
        write.previousActivePlanVersion
      );
    const consumePending = this.database
      .prepare(
        `UPDATE pending_actions
        SET consumed_at = ?, result_json = ?
        WHERE id = ? AND session_id = ? AND consumed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM plan_versions
            WHERE session_id = ? AND plan_version = ?
              AND approval_args_hash = ?
          )`
      )
      .bind(
        write.approvedAt,
        JSON.stringify({ plan: write.plan, approvalResult: result }),
        write.pending.id,
        write.sessionId,
        write.sessionId,
        config.planVersion,
        write.pending.argsHash
      );
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, source_version = ?,
          active_plan_version = ?, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = ?
          AND active_plan_version IS ?
          AND EXISTS (
            SELECT 1 FROM plan_versions
            WHERE session_id = ? AND plan_version = ?
              AND approval_args_hash = ?
          )`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.nextState.sourceVersion,
        write.nextState.activePlanVersion,
        write.approvedAt,
        write.sessionId,
        write.previousStateVersion,
        config.sourceVersion,
        write.previousActivePlanVersion,
        write.sessionId,
        config.planVersion,
        write.pending.argsHash
      );
    const insertAudit = this.database
      .prepare(
        `INSERT INTO audit_events (
          id, session_id, sequence, actor, event_type, tool_name,
          source_record_ids_json, state_version, evidence_json, created_at
        )
        SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, NULL, ?, ?, ?, ?
        FROM audit_events WHERE session_id = ?`
      )
      .bind(
        write.auditEventId,
        write.sessionId,
        write.approvedBy,
        config.eventType,
        JSON.stringify(["event_band_camp_day_1", "material_band_packing_v1"]),
        write.nextState.stateVersion,
        JSON.stringify({
          approvalId: write.pending.id,
          argsHash: write.pending.argsHash,
          planVersion: config.planVersion,
          sourceVersion: config.sourceVersion
        }),
        write.approvedAt,
        write.sessionId
      );
    const results = await batch([insertPlan, consumePending, updateSession, insertAudit]);
    assertBatchResults(results, 4, "Unable to save the approved plan.");
    return result;
  }
}
