import type { LearningCoachTurn } from "../ai/learning-coach";
import type {
  LearnerSignal,
  LearningDialogueEntry,
  LearningProgress,
  LearningSessionRecord,
  LearningSummary
} from "../domain/learning-session";
import type { CourseId } from "../domain/learning-tracks";
import type { D1DatabaseLike, D1RunResult } from "./session-store";

export interface StartLearningWrite {
  learningSession: LearningSessionRecord;
  initialTurn: LearningCoachTurn;
  updatedAt: string;
}

export interface AppendLearningTurnWrite {
  demoSessionId: string;
  learningSessionId: string;
  expectedTurnCount: number;
  studentResponse: string;
  coachTurn: LearningCoachTurn;
  nextTurnCount: number;
  updatedAt: string;
}

export interface CompleteLearningWrite {
  demoSessionId: string;
  learningSessionId: string;
  expectedTurnCount: number;
  completedAt: string;
  summary: LearningSummary;
  signal: LearnerSignal;
  progress: LearningProgress;
  memoryEventId: string;
}

export interface LearnerContextResult {
  signals: LearnerSignal[];
  progress: LearningProgress[];
}

export interface LearningStore {
  startSession(write: StartLearningWrite): Promise<void>;
  findSession(demoSessionId: string, learningSessionId: string): Promise<LearningSessionRecord | null>;
  appendTurn(write: AppendLearningTurnWrite): Promise<void>;
  completeSession(write: CompleteLearningWrite): Promise<void>;
  listLearnerContext(studentId: string, courseId?: CourseId): Promise<LearnerContextResult>;
  deleteSignal(studentId: string, signalId: string, deletedAt: string, eventId: string): Promise<void>;
}

interface LearningSessionRow {
  id: string;
  demo_session_id: string;
  student_id: string;
  course_id: CourseId;
  mission_id: string;
  objective_id: string;
  status: "active" | "completed";
  duration_minutes: 10 | 15 | 20;
  support_preference: LearningSessionRecord["supportPreference"];
  source_label: "Homeroom readiness mission";
  started_at: string;
  target_ends_at: string;
  completed_at: string | null;
  turn_count: number;
  context_json: string;
  summary_json: string | null;
}

interface AggregateRow {
  records_json: string;
}

export class LearningStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningStoreError";
  }
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) {
    throw new LearningStoreError("D1 atomic batch support is required for Learning writes.");
  }
  return database.batch.bind(database);
}

function assertChange(result: D1RunResult, message: string): void {
  if (!result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1)) {
    throw new LearningStoreError(message);
  }
}

function parseLearningSession(row: LearningSessionRow): LearningSessionRecord {
  return {
    id: row.id,
    demoSessionId: row.demo_session_id,
    studentId: row.student_id,
    courseId: row.course_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    status: row.status,
    durationMinutes: row.duration_minutes,
    supportPreference: row.support_preference,
    sourceLabel: row.source_label,
    startedAt: row.started_at,
    targetEndsAt: row.target_ends_at,
    completedAt: row.completed_at,
    turnCount: row.turn_count,
    dialogue: JSON.parse(row.context_json) as LearningDialogueEntry[],
    summary: row.summary_json ? JSON.parse(row.summary_json) as LearningSummary : null
  };
}

export class D1LearningStore implements LearningStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async startSession(write: StartLearningWrite): Promise<void> {
    const learning = write.learningSession;
    const batch = requireBatch(this.database);
    const clearAbandonedSession = this.database.prepare(
      `DELETE FROM learning_sessions
      WHERE demo_session_id = ? AND status = 'active'`
    ).bind(learning.demoSessionId);
    const insertSession = this.database.prepare(
      `INSERT INTO learning_sessions (
        id, demo_session_id, student_id, course_id, mission_id, objective_id,
        status, duration_minutes, support_preference, source_label,
        started_at, target_ends_at, completed_at, turn_count,
        context_json, summary_json, created_at, updated_at
      )
      SELECT ?, sessions.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?
      FROM demo_sessions AS sessions
      WHERE sessions.id = ? AND sessions.actor_id = ? AND sessions.role = ?`
    ).bind(
      learning.id,
      learning.studentId,
      learning.courseId,
      learning.missionId,
      learning.objectiveId,
      "active",
      learning.durationMinutes,
      learning.supportPreference,
      learning.sourceLabel,
      learning.startedAt,
      learning.targetEndsAt,
      JSON.stringify([{ role: "coach", content: write.initialTurn.message + " " + write.initialTurn.question }]),
      learning.startedAt,
      write.updatedAt,
      learning.demoSessionId,
      learning.studentId,
      "student"
    );
    const results = await batch([clearAbandonedSession, insertSession]);
    if (!results[0]?.success) {
      throw new LearningStoreError("Unable to replace the prior Learning session.");
    }
    assertChange(results[1] ?? { success: false }, "Unable to start the Learning session.");
  }

  async findSession(
    demoSessionId: string,
    learningSessionId: string
  ): Promise<LearningSessionRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, demo_session_id, student_id, course_id, mission_id, objective_id,
        status, duration_minutes, support_preference, source_label,
        started_at, target_ends_at, completed_at, turn_count,
        context_json, summary_json
      FROM learning_sessions
      WHERE id = ? AND demo_session_id = ? LIMIT 1`
    ).bind(learningSessionId, demoSessionId).first<LearningSessionRow>();
    return row ? parseLearningSession(row) : null;
  }

  async appendTurn(write: AppendLearningTurnWrite): Promise<void> {
    const current = await this.findSession(write.demoSessionId, write.learningSessionId);
    if (!current || current.status !== "active" || current.turnCount !== write.expectedTurnCount) {
      throw new LearningStoreError("The Learning turn is no longer current.");
    }
    const dialogue: LearningDialogueEntry[] = [
      ...current.dialogue,
      { role: "student" as const, content: write.studentResponse },
      { role: "coach" as const, content: `${write.coachTurn.message} ${write.coachTurn.question}` }
    ].slice(-8);
    const result = await this.database.prepare(
      `UPDATE learning_sessions
      SET turn_count = ?, context_json = ?, updated_at = ?
      WHERE id = ? AND demo_session_id = ? AND status = ? AND turn_count = ?`
    ).bind(
      write.nextTurnCount,
      JSON.stringify(dialogue),
      write.updatedAt,
      write.learningSessionId,
      write.demoSessionId,
      "active",
      write.expectedTurnCount
    ).run();
    assertChange(result, "Unable to save the Learning turn.");
  }

  async completeSession(write: CompleteLearningWrite): Promise<void> {
    const batch = requireBatch(this.database);
    const clearDialogue = this.database.prepare(
      `UPDATE learning_sessions
      SET status = ?, completed_at = ?, context_json = ?, summary_json = ?, updated_at = ?
      WHERE id = ? AND demo_session_id = ? AND status = ? AND turn_count = ?`
    ).bind(
      "completed",
      write.completedAt,
      "[]",
      JSON.stringify(write.summary),
      write.completedAt,
      write.learningSessionId,
      write.demoSessionId,
      "active",
      write.expectedTurnCount
    );
    const saveSignal = this.database.prepare(
      `INSERT INTO learner_signals (
        id, student_id, scope_course_id, signal_type, statement,
        evidence_kind, evidence_learning_session_id, confidence,
        visibility, status, learned_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, scope_course_id, signal_type, statement) DO UPDATE SET
        id = excluded.id,
        evidence_kind = excluded.evidence_kind,
        evidence_learning_session_id = excluded.evidence_learning_session_id,
        confidence = excluded.confidence,
        visibility = excluded.visibility,
        status = excluded.status,
        learned_at = excluded.learned_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`
    ).bind(
      write.signal.id,
      write.signal.studentId,
      write.signal.scopeCourseId,
      write.signal.signalType,
      write.signal.statement,
      write.signal.evidenceKind,
      write.signal.evidenceLearningSessionId,
      write.signal.confidence,
      write.signal.visibility,
      write.signal.status,
      write.signal.learnedAt,
      write.signal.expiresAt,
      write.completedAt
    );
    const saveProgress = this.database.prepare(
      `INSERT INTO learning_progress (
        student_id, course_id, objective_id, status, sessions_completed,
        last_session_at, next_review_at, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, course_id, objective_id) DO UPDATE SET
        status = excluded.status,
        sessions_completed = excluded.sessions_completed,
        last_session_at = excluded.last_session_at,
        next_review_at = excluded.next_review_at,
        evidence_json = excluded.evidence_json`
    ).bind(
      write.progress.studentId,
      write.progress.courseId,
      write.progress.objectiveId,
      write.progress.status,
      write.progress.sessionsCompleted,
      write.progress.lastSessionAt,
      write.progress.nextReviewAt,
      JSON.stringify(write.progress.evidence)
    );
    const saveMemoryEvent = this.database.prepare(
      `INSERT INTO learner_memory_events (
        id, student_id, signal_id, event_type, actor_id, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      write.memoryEventId,
      write.signal.studentId,
      write.signal.id,
      "signal_saved",
      write.signal.studentId,
      JSON.stringify({
        evidenceKind: write.signal.evidenceKind,
        learningSessionId: write.learningSessionId,
        courseId: write.signal.scopeCourseId
      }),
      write.completedAt
    );
    const results = await batch([clearDialogue, saveSignal, saveProgress, saveMemoryEvent]);
    if (results.length !== 4) throw new LearningStoreError("Unable to complete the Learning session.");
    results.forEach((result) => assertChange(result, "Unable to complete the Learning session."));
  }

  async listLearnerContext(
    studentId: string,
    courseId?: CourseId
  ): Promise<LearnerContextResult> {
    const courseFilter = courseId ? "AND scope_course_id = ?" : "";
    const signalStatement = this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'id', id,
        'studentId', student_id,
        'scopeCourseId', scope_course_id,
        'signalType', signal_type,
        'statement', statement,
        'evidenceKind', evidence_kind,
        'evidenceLearningSessionId', evidence_learning_session_id,
        'confidence', confidence,
        'visibility', visibility,
        'status', status,
        'learnedAt', learned_at,
        'expiresAt', expires_at
      )), '[]') AS records_json
      FROM learner_signals
      WHERE student_id = ? AND status = 'active' AND expires_at > datetime('now') ${courseFilter}`
    );
    const signalRow = courseId
      ? await signalStatement.bind(studentId, courseId).first<AggregateRow>()
      : await signalStatement.bind(studentId).first<AggregateRow>();

    const progressFilter = courseId ? "AND course_id = ?" : "";
    const progressStatement = this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'studentId', student_id,
        'courseId', course_id,
        'objectiveId', objective_id,
        'status', status,
        'sessionsCompleted', sessions_completed,
        'lastSessionAt', last_session_at,
        'nextReviewAt', next_review_at,
        'evidence', json(evidence_json)
      )), '[]') AS records_json
      FROM learning_progress WHERE student_id = ? ${progressFilter}`
    );
    const progressRow = courseId
      ? await progressStatement.bind(studentId, courseId).first<AggregateRow>()
      : await progressStatement.bind(studentId).first<AggregateRow>();
    return {
      signals: JSON.parse(signalRow?.records_json ?? "[]") as LearnerSignal[],
      progress: JSON.parse(progressRow?.records_json ?? "[]") as LearningProgress[]
    };
  }

  async deleteSignal(
    studentId: string,
    signalId: string,
    deletedAt: string,
    eventId: string
  ): Promise<void> {
    const batch = requireBatch(this.database);
    const remove = this.database.prepare(
      `UPDATE learner_signals SET status = ?, updated_at = ?
      WHERE id = ? AND student_id = ? AND status = ?`
    ).bind("deleted", deletedAt, signalId, studentId, "active");
    const audit = this.database.prepare(
      `INSERT INTO learner_memory_events (
        id, student_id, signal_id, event_type, actor_id, evidence_json, created_at
      )
      SELECT ?, student_id, id, ?, ?, ?, ? FROM learner_signals
      WHERE id = ? AND student_id = ? AND status = ?`
    ).bind(
      eventId,
      "signal_deleted",
      studentId,
      JSON.stringify({ reason: "student_deleted" }),
      deletedAt,
      signalId,
      studentId,
      "deleted"
    );
    const results = await batch([remove, audit]);
    if (results.length !== 2) throw new LearningStoreError("Unable to delete the learner memory.");
    results.forEach((result) => assertChange(result, "Unable to delete the learner memory."));
  }
}
