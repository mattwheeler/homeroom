import { describe, expect, it } from "vitest";

import {
  completeLearningSession,
  createLearningSession,
  nextLearningPhase,
  type LearnerSignal
} from "../lib/domain/learning-session";
import type { SessionRecord } from "../lib/storage/session-store";

function session(role: "student" | "guardian" = "student"): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "student" ? "student_emily" : "guardian_matt",
    role,
    state: {
      phase: "ORIENTATION_READY",
      stateVersion: 5,
      sourceVersion: 1,
      activePlanVersion: null
    },
    csrfHash: "hash",
    expiresAt: "2026-07-18T16:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z"
  };
}

const existingSignals: LearnerSignal[] = [
  {
    id: "signal_algebra",
    studentId: "student_emily",
    scopeCourseId: "course_algebra_1",
    signalType: "support_preference",
    statement: "One worked example before independent practice.",
    evidenceKind: "student_stated_preference",
    evidenceLearningSessionId: "learning_previous",
    confidence: 1,
    visibility: "student_private",
    status: "active",
    learnedAt: "2026-07-17T12:00:00.000Z",
    expiresAt: "2026-10-15T12:00:00.000Z"
  },
  {
    id: "signal_english",
    studentId: "student_emily",
    scopeCourseId: "course_english_1",
    signalType: "support_preference",
    statement: "Ask me to find evidence first.",
    evidenceKind: "student_stated_preference",
    evidenceLearningSessionId: "learning_english",
    confidence: 1,
    visibility: "student_private",
    status: "active",
    learnedAt: "2026-07-17T12:00:00.000Z",
    expiresAt: "2026-10-15T12:00:00.000Z"
  }
];

describe("independent timeboxed Learning sessions", () => {
  it("starts from an upcoming course without changing or depending on Golden state", () => {
    const result = createLearningSession({
      session: session(),
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals,
      now: () => new Date("2026-07-18T12:01:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });

    expect(result.learningSession).toMatchObject({
      id: "learning_123456789012345678901234",
      demoSessionId: "session_01",
      studentId: "student_emily",
      courseId: "course_algebra_1",
      status: "active",
      durationMinutes: 10,
      startedAt: "2026-07-18T12:01:00.000Z",
      targetEndsAt: "2026-07-18T12:11:00.000Z",
      turnCount: 0,
      dialogue: []
    });
    expect(result.learnerContext.map((signal) => signal.id)).toEqual(["signal_algebra"]);
    expect(result.proof).toEqual({
      independentTrack: "learning",
      goldenStateUnchanged: true,
      goldenStateVersion: 5,
      sourceLabel: "Homeroom readiness mission"
    });
  });

  it("uses the server clock to move from check-in through recap", () => {
    const { learningSession } = createLearningSession({
      session: session(),
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    expect(nextLearningPhase(learningSession, new Date("2026-07-18T12:00:05.000Z"))).toBe("check_in");
    expect(nextLearningPhase({ ...learningSession, turnCount: 1 }, new Date("2026-07-18T12:01:00.000Z"))).toBe("diagnostic");
    expect(nextLearningPhase({ ...learningSession, turnCount: 2 }, new Date("2026-07-18T12:03:00.000Z"))).toBe("guided_practice");
    expect(nextLearningPhase({ ...learningSession, turnCount: 5 }, new Date("2026-07-18T12:06:00.000Z"))).toBe("transfer");
    expect(nextLearningPhase({ ...learningSession, turnCount: 3 }, new Date("2026-07-18T12:08:30.000Z"))).toBe("recap");
  });

  it("persists only an explicit preference and evidence-backed progress at completion", () => {
    const { learningSession } = createLearningSession({
      session: session(),
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      randomUUID: () => "123456789012345678901234"
    });
    const result = completeLearningSession({
      learningSession: {
        ...learningSession,
        turnCount: 4,
        dialogue: [
          { role: "coach", content: "Private active dialogue" },
          { role: "student", content: "My private answer" }
        ]
      },
      priorSessionsCompleted: 0,
      now: () => new Date("2026-07-18T12:09:00.000Z"),
      randomUUID: () => "abcdefabcdefabcdefabcdef"
    });

    expect(result.summary).toMatchObject({
      courseName: "Algebra I",
      missionTitle: "Equations stay balanced",
      objectiveStatus: "exploring",
      completedTurns: 4
    });
    expect(result.signal).toMatchObject({
      id: "signal_abcdefabcdefabcdefabcdef",
      statement: "One worked example before independent practice.",
      evidenceKind: "student_stated_preference",
      confidence: 1,
      visibility: "student_private"
    });
    expect(JSON.stringify(result)).not.toContain("My private answer");
    expect(JSON.stringify(result)).not.toContain("Private active dialogue");
  });

  it("does not advance objective progress when a student ends before responding", () => {
    const { learningSession } = createLearningSession({
      session: session(),
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: [],
      now: () => new Date("2026-07-18T12:00:00.000Z")
    });

    const result = completeLearningSession({
      learningSession,
      priorSessionsCompleted: 1,
      now: () => new Date("2026-07-18T12:01:00.000Z")
    });

    expect(result.progress).toMatchObject({
      sessionsCompleted: 1,
      status: "exploring",
      evidence: { completedTurns: 0 }
    });
    expect(result.summary.objectiveStatus).toBe("exploring");
  });

  it("rejects guardian scope, unsupported durations, and expired active turns", () => {
    expect(() => createLearningSession({
      session: session("guardian"),
      courseId: "course_algebra_1",
      durationMinutes: 10,
      supportPreference: "example_first",
      existingSignals: []
    })).toThrow(/student workspace/i);

    expect(() => createLearningSession({
      session: session(),
      courseId: "course_algebra_1",
      durationMinutes: 60 as 10,
      supportPreference: "example_first",
      existingSignals: []
    })).toThrow(/timebox/i);
  });
});
