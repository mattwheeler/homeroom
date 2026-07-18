import type { SessionState } from "../domain/state-machine";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export type PracticeStep = "divide_both_sides_by_3" | "final_answer_4";

export interface PracticeProgress {
  sessionId: string;
  exerciseId: string;
  status: "in_progress" | "completed";
  hintsUsed: number;
  attempts: number;
  validatedSteps: PracticeStep[];
  finalAnswer: string | null;
  completedAt: string | null;
}

export interface StartPracticeWrite {
  sessionId: string;
  previousStateVersion: number;
  nextState: SessionState & { phase: "HINT_USED"; sourceVersion: 2; activePlanVersion: 2 };
  exerciseId: string;
  startedAt: string;
}

export interface RecordPracticeAttemptWrite {
  sessionId: string;
  exerciseId: string;
  expectedAttempts: number;
  expectedValidatedSteps: PracticeStep[];
  nextAttempts: number;
  nextValidatedSteps: PracticeStep[];
}

export interface CompletePracticeWrite {
  sessionId: string;
  previousStateVersion: number;
  nextState: SessionState & { phase: "PRACTICE_COMPLETE"; sourceVersion: 2; activePlanVersion: 2 };
  exerciseId: string;
  expectedAttempts: number;
  expectedValidatedSteps: PracticeStep[];
  nextAttempts: number;
  nextValidatedSteps: PracticeStep[];
  finalAnswer: string;
  completedAt: string;
  auditEventId: string;
}

export interface PracticeStore {
  startPractice(write: StartPracticeWrite): Promise<void>;
  findProgress(sessionId: string, exerciseId: string): Promise<PracticeProgress | null>;
  recordAttempt(write: RecordPracticeAttemptWrite): Promise<void>;
  completePractice(write: CompletePracticeWrite): Promise<void>;
}

interface PracticeRow {
  session_id: string;
  exercise_id: string;
  status: "in_progress" | "completed";
  hints_used: number;
  attempts: number;
  validated_steps_json: string;
  final_answer: string | null;
  completed_at: string | null;
}

export class PracticeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PracticeStoreError";
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new PracticeStoreError("D1 atomic batch support is required for practice writes.");
  return database.batch.bind(database);
}

function assertBatchResults(results: D1RunResult[], expectedCount: number, message: string): void {
  if (
    results.length !== expectedCount ||
    results.some((result) => !result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1))
  ) {
    throw new PracticeStoreError(message);
  }
}

export class D1PracticeStore implements PracticeStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async startPractice(write: StartPracticeWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 2
          AND active_plan_version = 2`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.startedAt,
        write.sessionId,
        write.previousStateVersion
      );
    const insertProgress = this.database
      .prepare(
        `INSERT INTO practice_results (
          session_id, exercise_id, status, hints_used, attempts,
          validated_steps_json, final_answer, completed_at
        )
        SELECT sessions.id, ?, ?, 1, 0, ?, NULL, NULL
        FROM demo_sessions AS sessions
        WHERE sessions.id = ? AND sessions.state_version = ?
          AND sessions.source_version = 2 AND sessions.active_plan_version = 2
          AND NOT EXISTS (
            SELECT 1 FROM practice_results AS existing
            WHERE existing.session_id = sessions.id AND existing.exercise_id = ?
          )`
      )
      .bind(
        write.exerciseId,
        "in_progress",
        JSON.stringify([]),
        write.sessionId,
        write.nextState.stateVersion,
        write.exerciseId
      );
    const results = await batch([updateSession, insertProgress]);
    assertBatchResults(results, 2, "Unable to start the private practice exercise.");
  }

  async findProgress(sessionId: string, exerciseId: string): Promise<PracticeProgress | null> {
    const row = await this.database
      .prepare(
        `SELECT session_id, exercise_id, status, hints_used, attempts,
          validated_steps_json, final_answer, completed_at
        FROM practice_results WHERE session_id = ? AND exercise_id = ? LIMIT 1`
      )
      .bind(sessionId, exerciseId)
      .first<PracticeRow>();
    if (!row) return null;
    return {
      sessionId: row.session_id,
      exerciseId: row.exercise_id,
      status: row.status,
      hintsUsed: row.hints_used,
      attempts: row.attempts,
      validatedSteps: JSON.parse(row.validated_steps_json) as PracticeStep[],
      finalAnswer: row.final_answer,
      completedAt: row.completed_at
    };
  }

  async recordAttempt(write: RecordPracticeAttemptWrite): Promise<void> {
    const result = await this.database
      .prepare(
        `UPDATE practice_results
        SET attempts = ?, validated_steps_json = ?
        WHERE session_id = ? AND exercise_id = ? AND status = ?
          AND attempts = ? AND validated_steps_json = ?`
      )
      .bind(
        write.nextAttempts,
        JSON.stringify(write.nextValidatedSteps),
        write.sessionId,
        write.exerciseId,
        "in_progress",
        write.expectedAttempts,
        JSON.stringify(write.expectedValidatedSteps)
      )
      .run();
    if (!result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1)) {
      throw new PracticeStoreError("The practice attempt is no longer current.");
    }
  }

  async completePractice(write: CompletePracticeWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const completeResult = this.database
      .prepare(
        `UPDATE practice_results
        SET status = ?, attempts = ?, validated_steps_json = ?,
          final_answer = ?, completed_at = ?
        WHERE session_id = ? AND exercise_id = ? AND status = ?
          AND attempts = ? AND validated_steps_json = ?`
      )
      .bind(
        "completed",
        write.nextAttempts,
        JSON.stringify(write.nextValidatedSteps),
        write.finalAnswer,
        write.completedAt,
        write.sessionId,
        write.exerciseId,
        "in_progress",
        write.expectedAttempts,
        JSON.stringify(write.expectedValidatedSteps)
      );
    const updateSession = this.database
      .prepare(
        `UPDATE demo_sessions
        SET state_json = ?, state_version = ?, updated_at = ?
        WHERE id = ? AND state_version = ? AND source_version = 2
          AND active_plan_version = 2
          AND EXISTS (
            SELECT 1 FROM practice_results
            WHERE session_id = ? AND exercise_id = ? AND status = ?
              AND final_answer = ?
          )`
      )
      .bind(
        JSON.stringify(write.nextState),
        write.nextState.stateVersion,
        write.completedAt,
        write.sessionId,
        write.previousStateVersion,
        write.sessionId,
        write.exerciseId,
        "completed",
        write.finalAnswer
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
          AND NOT EXISTS (
            SELECT 1 FROM audit_events AS existing
            WHERE existing.session_id = sessions.id
              AND existing.event_type = ? AND existing.state_version = ?
          )
        GROUP BY sessions.id`
      )
      .bind(
        write.auditEventId,
        "student_emily",
        "PRACTICE_COMPLETED",
        JSON.stringify(["course_algebra_1", write.exerciseId]),
        write.nextState.stateVersion,
        JSON.stringify({
          exerciseId: write.exerciseId,
          grader: "homeroom-deterministic-v1",
          hintsUsed: 1,
          attempts: write.nextAttempts,
          validatedSteps: write.nextValidatedSteps
        }),
        write.completedAt,
        write.sessionId,
        write.nextState.stateVersion,
        "PRACTICE_COMPLETED",
        write.nextState.stateVersion
      );
    const results = await batch([completeResult, updateSession, insertAudit]);
    assertBatchResults(results, 3, "Unable to save the completed practice exercise.");
  }
}
