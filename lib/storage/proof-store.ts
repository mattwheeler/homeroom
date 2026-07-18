import type { SessionState } from "../domain/state-machine";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface ProofSessionEvidence {
  id: string;
  actorId: string;
  phase: "COMPLETE";
  stateVersion: 15;
  sourceVersion: 2;
  activePlanVersion: 2;
  createdAt: string;
  updatedAt: string;
}

export type ProofAuditEventType =
  | "PLAN_V1_APPROVED"
  | "SOURCE_V2_SYNCED"
  | "PLAN_V2_APPROVED"
  | "PRACTICE_COMPLETED"
  | "GUARDIAN_SUMMARY_PUBLISHED"
  | "PROOF_VIEW_OPENED";

export interface ProofAuditEvidence {
  sequence: number;
  actor: string;
  eventType: ProofAuditEventType;
  stateVersion: number;
  createdAt: string;
  approvalId: string | null;
  argsHash: string | null;
  projectionHash: string | null;
  sourceVersion: number | null;
  planVersion: number | null;
  exerciseId: string | null;
  grader: string | null;
  privateExcluded: number | null;
}

export interface ProofAiTurnEvidence {
  stage: string;
  model: string;
  status: "completed" | "failed";
  responseIds: string[];
  toolTrace: Array<{ name: string; callId: string }>;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  createdAt: string;
}

export interface ProofEvidenceBundle {
  session: ProofSessionEvidence;
  audits: ProofAuditEvidence[];
  aiTurns: ProofAiTurnEvidence[];
}

export interface AdvanceProofWrite {
  sessionId: string;
  previousStateVersion: 14;
  nextState: SessionState & {
    phase: "COMPLETE";
    stateVersion: 15;
    sourceVersion: 2;
    activePlanVersion: 2;
  };
  openedAt: string;
  auditEventId: string;
}

export interface ProofStore {
  advanceToProof(write: AdvanceProofWrite): Promise<void>;
  readEvidence(sessionId: string): Promise<ProofEvidenceBundle>;
}

interface ProofSessionRow {
  id: string;
  actor_id: string;
  state_json: string;
  created_at: string;
  updated_at: string;
}

interface AggregateRow {
  records_json: string;
}

export class ProofStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofStoreError";
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new ProofStoreError("D1 atomic batch support is required for proof writes.");
  return database.batch.bind(database);
}

function assertBatchResults(results: D1RunResult[], expectedCount: number): void {
  if (
    results.length !== expectedCount ||
    results.some((result) => !result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1))
  ) {
    throw new ProofStoreError("Unable to complete the judge proof milestone.");
  }
}

export class D1ProofStore implements ProofStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async advanceToProof(write: AdvanceProofWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = 15, source_version = 2,
          active_plan_version = 2, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 2
          AND active_plan_version = 2`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.openedAt,
        write.sessionId,
        write.previousStateVersion
      );
    const insertAudit = this.database
      .prepare(
        `INSERT INTO audit_events (
          id, session_id, sequence, actor, event_type, tool_name,
          source_record_ids_json, state_version, evidence_json, created_at
        )
        SELECT ?, sessions.id, COALESCE(MAX(audits.sequence), 0) + 1,
          ?, ?, NULL, ?, 15, ?, ?
        FROM demo_sessions AS sessions
        LEFT JOIN audit_events AS audits ON audits.session_id = sessions.id
        WHERE sessions.id = ? AND sessions.state_version = 15
          AND sessions.source_version = 2 AND sessions.active_plan_version = 2
          AND NOT EXISTS (
            SELECT 1 FROM audit_events AS existing
            WHERE existing.session_id = sessions.id
              AND existing.event_type = ? AND existing.state_version = 15
          )
        GROUP BY sessions.id`
      )
      .bind(
        write.auditEventId,
        "student_emily",
        "PROOF_VIEW_OPENED",
        JSON.stringify([]),
        JSON.stringify({ view: "judge_proof_v1", privacy: "allowlisted" }),
        write.openedAt,
        write.sessionId,
        "PROOF_VIEW_OPENED"
      );
    const results = await batch([updateSession, insertAudit]);
    assertBatchResults(results, 2);
  }

  async readEvidence(sessionId: string): Promise<ProofEvidenceBundle> {
    const sessionRow = await this.database
      .prepare(
        `SELECT id, actor_id, state_json, created_at, updated_at
        FROM demo_sessions WHERE id = ? LIMIT 1`
      )
      .bind(sessionId)
      .first<ProofSessionRow>();
    if (!sessionRow) throw new ProofStoreError("The completed proof session was not found.");

    const auditRow = await this.database
      .prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'sequence', sequence,
          'actor', actor,
          'eventType', event_type,
          'stateVersion', state_version,
          'createdAt', created_at,
          'approvalId', approval_id,
          'argsHash', args_hash,
          'projectionHash', projection_hash,
          'sourceVersion', source_version,
          'planVersion', plan_version,
          'exerciseId', exercise_id,
          'grader', grader,
          'privateExcluded', private_excluded
        )), '[]') AS records_json
        FROM (
          SELECT sequence, actor, event_type, state_version, created_at,
            json_extract(evidence_json, '$.approvalId') AS approval_id,
            json_extract(evidence_json, '$.argsHash') AS args_hash,
            json_extract(evidence_json, '$.projectionHash') AS projection_hash,
            json_extract(evidence_json, '$.sourceVersion') AS source_version,
            json_extract(evidence_json, '$.planVersion') AS plan_version,
            json_extract(evidence_json, '$.exerciseId') AS exercise_id,
            json_extract(evidence_json, '$.grader') AS grader,
            json_extract(evidence_json, '$.privateExcluded') AS private_excluded
          FROM audit_events WHERE session_id = ? ORDER BY sequence
        )`
      )
      .bind(sessionId)
      .first<AggregateRow>();
    const aiRow = await this.database
      .prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'stage', stage,
          'model', model,
          'status', status,
          'responseIds', json(openai_response_ids_json),
          'toolTrace', json(tool_trace_json),
          'latencyMs', latency_ms,
          'inputTokens', input_tokens,
          'outputTokens', output_tokens,
          'cachedTokens', cached_tokens,
          'createdAt', created_at
        )), '[]') AS records_json
        FROM (
          SELECT stage, model, status, openai_response_ids_json, tool_trace_json,
            latency_ms, input_tokens, output_tokens, cached_tokens, created_at
          FROM ai_turns WHERE session_id = ? ORDER BY created_at
        )`
      )
      .bind(sessionId)
      .first<AggregateRow>();

    const state = JSON.parse(sessionRow.state_json) as SessionState;
    return {
      session: {
        id: sessionRow.id,
        actorId: sessionRow.actor_id,
        phase: state.phase as "COMPLETE",
        stateVersion: state.stateVersion as 15,
        sourceVersion: state.sourceVersion as 2,
        activePlanVersion: state.activePlanVersion as 2,
        createdAt: sessionRow.created_at,
        updatedAt: sessionRow.updated_at
      },
      audits: JSON.parse(auditRow?.records_json ?? "[]") as ProofAuditEvidence[],
      aiTurns: JSON.parse(aiRow?.records_json ?? "[]") as ProofAiTurnEvidence[]
    };
  }
}
