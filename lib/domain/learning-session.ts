import type { SessionRecord } from "../storage/session-store";
import { getLearningTrack, type CourseId, type LearningTrack } from "./learning-tracks";

export type LearningDurationMinutes = 10 | 15 | 20;
export type SupportPreference = "example_first" | "questions_first" | "mix_it_up";
export type LearningPhase = "check_in" | "diagnostic" | "guided_practice" | "transfer" | "recap";

export interface LearningDialogueEntry {
  role: "student" | "coach";
  content: string;
}

export interface LearningSessionRecord {
  id: string;
  demoSessionId: string;
  studentId: string;
  courseId: CourseId;
  missionId: string;
  objectiveId: string;
  status: "active" | "completed";
  durationMinutes: LearningDurationMinutes;
  supportPreference: SupportPreference;
  sourceLabel: "Homeroom readiness mission";
  startedAt: string;
  targetEndsAt: string;
  completedAt: string | null;
  turnCount: number;
  dialogue: LearningDialogueEntry[];
  summary: LearningSummary | null;
}

export interface LearnerSignal {
  id: string;
  studentId: string;
  scopeCourseId: CourseId;
  signalType: "support_preference";
  statement: string;
  evidenceKind: "student_stated_preference";
  evidenceLearningSessionId: string;
  confidence: 1;
  visibility: "student_private";
  status: "active" | "deleted";
  learnedAt: string;
  expiresAt: string;
}

export interface LearningProgress {
  studentId: string;
  courseId: CourseId;
  objectiveId: string;
  status: "exploring" | "practicing";
  sessionsCompleted: number;
  lastSessionAt: string;
  nextReviewAt: string;
  evidence: {
    learningSessionId: string;
    completedTurns: number;
    evidenceKind: "session_completed";
  };
}

export interface LearningSummary {
  courseName: LearningTrack["courseName"];
  missionTitle: string;
  objective: string;
  objectiveStatus: LearningProgress["status"];
  completedTurns: number;
  sourceLabel: "Homeroom readiness mission";
  memoryStatement: string;
}

export class LearningSessionError extends Error {
  readonly code:
    | "LEARNING_SCOPE_MISMATCH"
    | "LEARNING_TIMEBOX_INVALID"
    | "LEARNING_ALREADY_ACTIVE"
    | "LEARNING_NOT_FOUND"
    | "LEARNING_SESSION_EXPIRED"
    | "LEARNING_SESSION_COMPLETE";

  constructor(code: LearningSessionError["code"], message: string) {
    super(message);
    this.name = "LearningSessionError";
    this.code = code;
  }
}

function assertStudentScope(session: SessionRecord): void {
  if (session.role !== "student") {
    throw new LearningSessionError(
      "LEARNING_SCOPE_MISMATCH",
      "Learning belongs to Emily's student workspace."
    );
  }
}

function makeId(prefix: "learning" | "signal", randomUUID?: () => string): string {
  const raw = (randomUUID?.() ?? crypto.randomUUID()).toLowerCase().replace(/[^a-f0-9]/g, "");
  return `${prefix}_${raw.padEnd(24, "0").slice(0, 24)}`;
}

function preferenceStatement(preference: SupportPreference): string {
  if (preference === "example_first") return "One worked example before independent practice.";
  if (preference === "questions_first") return "Start with questions before showing an example.";
  return "Mix short examples with questions and independent practice.";
}

export function remainingLearningSeconds(
  learningSession: LearningSessionRecord,
  now: Date
): number {
  return Math.max(0, Math.ceil((Date.parse(learningSession.targetEndsAt) - now.getTime()) / 1_000));
}

export function nextLearningPhase(
  learningSession: LearningSessionRecord,
  now: Date
): LearningPhase {
  if (learningSession.status !== "active") {
    throw new LearningSessionError("LEARNING_SESSION_COMPLETE", "This Learning session is complete.");
  }
  if (remainingLearningSeconds(learningSession, now) <= 120) return "recap";
  if (learningSession.turnCount === 0) return "check_in";
  if (learningSession.turnCount === 1) return "diagnostic";
  if (learningSession.turnCount <= 3) return "guided_practice";
  return "transfer";
}

export function createLearningSession(input: {
  session: SessionRecord;
  courseId: string;
  durationMinutes: LearningDurationMinutes;
  supportPreference: SupportPreference;
  existingSignals: LearnerSignal[];
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertStudentScope(input.session);
  if (![10, 15, 20].includes(input.durationMinutes)) {
    throw new LearningSessionError(
      "LEARNING_TIMEBOX_INVALID",
      "Choose a 10, 15, or 20 minute Learning timebox."
    );
  }
  if (!["example_first", "questions_first", "mix_it_up"].includes(input.supportPreference)) {
    throw new LearningSessionError("LEARNING_TIMEBOX_INVALID", "Choose an approved support preference.");
  }
  const track = getLearningTrack(input.courseId);
  const now = (input.now ?? (() => new Date()))();
  const learningSession: LearningSessionRecord = {
    id: makeId("learning", input.randomUUID),
    demoSessionId: input.session.id,
    studentId: input.session.studentId ?? input.session.actorId,
    courseId: track.courseId,
    missionId: track.mission.id,
    objectiveId: track.mission.objectiveId,
    status: "active",
    durationMinutes: input.durationMinutes,
    supportPreference: input.supportPreference,
    sourceLabel: track.mission.source.label,
    startedAt: now.toISOString(),
    targetEndsAt: new Date(now.getTime() + input.durationMinutes * 60_000).toISOString(),
    completedAt: null,
    turnCount: 0,
    dialogue: [],
    summary: null
  };
  const learnerContext = input.existingSignals.filter(
    (signal) =>
      signal.studentId === (input.session.studentId ?? input.session.actorId) &&
      signal.scopeCourseId === track.courseId &&
      signal.status === "active" &&
      Date.parse(signal.expiresAt) > now.getTime()
  );
  return {
    learningSession,
    track,
    learnerContext,
    proof: {
      independentTrack: "learning" as const,
      goldenStateUnchanged: true as const,
      goldenStateVersion: input.session.state.stateVersion,
      sourceLabel: track.mission.source.label
    }
  };
}

export function completeLearningSession(input: {
  learningSession: LearningSessionRecord;
  priorSessionsCompleted: number;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  if (input.learningSession.status !== "active") {
    throw new LearningSessionError("LEARNING_SESSION_COMPLETE", "This Learning session is already complete.");
  }
  const track = getLearningTrack(input.learningSession.courseId);
  const now = (input.now ?? (() => new Date()))();
  const participated = input.learningSession.turnCount > 0;
  const sessionsCompleted = input.priorSessionsCompleted + (participated ? 1 : 0);
  const objectiveStatus = sessionsCompleted > 1 ? "practicing" as const : "exploring" as const;
  const memoryStatement = preferenceStatement(input.learningSession.supportPreference);
  const summary: LearningSummary = {
    courseName: track.courseName,
    missionTitle: track.mission.title,
    objective: track.mission.objective,
    objectiveStatus,
    completedTurns: input.learningSession.turnCount,
    sourceLabel: track.mission.source.label,
    memoryStatement
  };
  const signal: LearnerSignal = {
    id: makeId("signal", input.randomUUID),
    studentId: input.learningSession.studentId,
    scopeCourseId: track.courseId,
    signalType: "support_preference",
    statement: memoryStatement,
    evidenceKind: "student_stated_preference",
    evidenceLearningSessionId: input.learningSession.id,
    confidence: 1,
    visibility: "student_private",
    status: "active",
    learnedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString()
  };
  const progress: LearningProgress = {
    studentId: input.learningSession.studentId,
    courseId: track.courseId,
    objectiveId: track.mission.objectiveId,
    status: objectiveStatus,
    sessionsCompleted,
    lastSessionAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000).toISOString(),
    evidence: {
      learningSessionId: input.learningSession.id,
      completedTurns: input.learningSession.turnCount,
      evidenceKind: "session_completed"
    }
  };
  return { summary, signal, progress };
}
