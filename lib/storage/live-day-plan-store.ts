import type { MorningPlan } from "../ai/morning-plan";
import type { PendingAction } from "../security/approval";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface LiveDayPlanApprovalResult {
  saved: true;
  planVersion: number;
  savedAt: string;
  sourceFingerprint: string;
  proof: { approvalId: string; argsHash: string };
}

export interface PendingLiveDayPlan {
  pending: PendingAction;
  plan: MorningPlan;
  planVersion: number;
  sourceFingerprint: string;
  proposedAt: string;
  consumedAt: string | null;
  approvalResult: LiveDayPlanApprovalResult | null;
}

export interface LiveDayPlanStore {
  latestVersion(sessionId: string): Promise<number>;
  stage(input: {
    sessionId: string;
    plan: MorningPlan;
    planVersion: number;
    sourceFingerprint: string;
    pending: PendingAction;
    proposedAt: string;
  }): Promise<void>;
  findPending(sessionId: string, actionId: string): Promise<PendingLiveDayPlan | null>;
  approve(input: {
    sessionId: string;
    plan: MorningPlan;
    planVersion: number;
    sourceFingerprint: string;
    pending: PendingAction;
    approvedBy: string;
    proposedAt: string;
    approvedAt: string;
    auditEventId: string;
  }): Promise<LiveDayPlanApprovalResult>;
}

interface PendingRow {
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

interface LatestRow { latest_version: number | null }

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new Error("D1 atomic batch support is required for live plan writes.");
  return database.batch.bind(database);
}

function assertResults(results: D1RunResult[], count: number, message: string) {
  if (results.length !== count || results.some((result) => !result.success || result.meta?.changes === 0)) {
    throw new Error(message);
  }
}

export class D1LiveDayPlanStore implements LiveDayPlanStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async latestVersion(sessionId: string): Promise<number> {
    const row = await this.database.prepare(
      "SELECT MAX(plan_version) AS latest_version FROM live_day_plan_versions WHERE session_id = ?"
    ).bind(sessionId).first<LatestRow>();
    return row?.latest_version ?? 0;
  }

  async stage(input: Parameters<LiveDayPlanStore["stage"]>[0]): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO pending_actions (
        id, session_id, action_type, args_hash, expected_state_version,
        expected_plan_version, expected_source_version, approval_nonce_hash,
        idempotency_key, expires_at, consumed_at, result_json
      )
      SELECT ?, sessions.id, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
      FROM demo_sessions AS sessions
      WHERE sessions.id = ? AND sessions.actor_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM live_day_plan_versions AS plans
          WHERE plans.session_id = sessions.id AND plans.plan_version = ?
        )`
    ).bind(
      input.pending.id,
      input.pending.actionType,
      input.pending.argsHash,
      input.pending.expected.stateVersion,
      input.pending.expected.planVersion,
      input.pending.expected.sourceVersion,
      input.pending.nonceHash,
      input.pending.idempotencyKey,
      new Date(input.pending.expiresAt).toISOString(),
      JSON.stringify({
        kind: "live_day_plan",
        plan: input.plan,
        planVersion: input.planVersion,
        sourceFingerprint: input.sourceFingerprint,
        proposedAt: input.proposedAt,
        approvalResult: null
      }),
      input.sessionId,
      input.pending.actor,
      input.planVersion
    ).run();
    if (!result.success || result.meta?.changes === 0) throw new Error("Unable to stage the live day plan.");
  }

  async findPending(sessionId: string, actionId: string): Promise<PendingLiveDayPlan | null> {
    const row = await this.database.prepare(
      `SELECT pending.id, pending.session_id, sessions.actor_id,
        pending.action_type, pending.args_hash, pending.expected_state_version,
        pending.expected_plan_version, pending.expected_source_version,
        pending.approval_nonce_hash, pending.idempotency_key,
        pending.expires_at, pending.consumed_at, pending.result_json
      FROM pending_actions AS pending
      INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
      WHERE pending.id = ? AND pending.session_id = ? LIMIT 1`
    ).bind(actionId, sessionId).first<PendingRow>();
    if (!row) return null;
    const stored = JSON.parse(row.result_json) as Omit<PendingLiveDayPlan, "pending" | "consumedAt">;
    if ((stored as { kind?: string }).kind !== "live_day_plan") return null;
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
      planVersion: stored.planVersion,
      sourceFingerprint: stored.sourceFingerprint,
      proposedAt: stored.proposedAt,
      consumedAt: row.consumed_at,
      approvalResult: stored.approvalResult ?? null
    };
  }

  async approve(input: Parameters<LiveDayPlanStore["approve"]>[0]): Promise<LiveDayPlanApprovalResult> {
    const result: LiveDayPlanApprovalResult = {
      saved: true,
      planVersion: input.planVersion,
      savedAt: input.approvedAt,
      sourceFingerprint: input.sourceFingerprint,
      proof: { approvalId: input.pending.id, argsHash: input.pending.argsHash }
    };
    const insertPlan = this.database.prepare(
      `INSERT INTO live_day_plan_versions (
        session_id, plan_version, source_fingerprint, proposal_json,
        approved_plan_json, approval_args_hash, approved_by, proposed_at, approved_at
      )
      SELECT pending.session_id, ?, ?, ?, ?, pending.args_hash, ?, ?, ?
      FROM pending_actions AS pending
      INNER JOIN demo_sessions AS sessions ON sessions.id = pending.session_id
      WHERE pending.id = ? AND pending.session_id = ?
        AND pending.action_type = 'APPROVE_LIVE_DAY_PLAN'
        AND pending.args_hash = ? AND pending.approval_nonce_hash = ?
        AND pending.idempotency_key = ? AND pending.consumed_at IS NULL
        AND sessions.actor_id = ?`
    ).bind(
      input.planVersion,
      input.sourceFingerprint,
      JSON.stringify(input.plan),
      JSON.stringify(input.plan),
      input.approvedBy,
      input.proposedAt,
      input.approvedAt,
      input.pending.id,
      input.sessionId,
      input.pending.argsHash,
      input.pending.nonceHash,
      input.pending.idempotencyKey,
      input.approvedBy
    );
    const consume = this.database.prepare(
      `UPDATE pending_actions SET consumed_at = ?, result_json = ?
      WHERE id = ? AND session_id = ? AND consumed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM live_day_plan_versions
          WHERE session_id = ? AND plan_version = ? AND approval_args_hash = ?
        )`
    ).bind(
      input.approvedAt,
      JSON.stringify({
        kind: "live_day_plan",
        plan: input.plan,
        planVersion: input.planVersion,
        sourceFingerprint: input.sourceFingerprint,
        proposedAt: input.proposedAt,
        approvalResult: result
      }),
      input.pending.id,
      input.sessionId,
      input.sessionId,
      input.planVersion,
      input.pending.argsHash
    );
    const audit = this.database.prepare(
      `INSERT INTO audit_events (
        id, session_id, sequence, actor, event_type, tool_name,
        source_record_ids_json, state_version, evidence_json, created_at
      )
      SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, 'LIVE_DAY_PLAN_APPROVED', NULL,
        ?, ?, ?, ? FROM audit_events WHERE session_id = ?`
    ).bind(
      input.auditEventId,
      input.sessionId,
      input.approvedBy,
      JSON.stringify([`projection:${input.sourceFingerprint}`]),
      input.pending.expected.stateVersion,
      JSON.stringify({
        approvalId: input.pending.id,
        argsHash: input.pending.argsHash,
        planVersion: input.planVersion,
        sourceFingerprint: input.sourceFingerprint
      }),
      input.approvedAt,
      input.sessionId
    );
    const results = await requireBatch(this.database)([insertPlan, consume, audit]);
    assertResults(results, 3, "Unable to save the approved live day plan.");
    return result;
  }
}
