import { describe, expect, it } from "vitest";

import { buildGuardianProgress } from "../lib/domain/guardian-progress";
import type { FocusBlockRecord } from "../lib/storage/focus-block-store";
import { navigationProjection } from "./student-navigation-fixture";

const focus: FocusBlockRecord = {
  id: "focus_private_01",
  studentId: "student_emily",
  sessionId: "session_private_01",
  taskId: navigationProjection.priorities[0]!.id,
  taskTitle: navigationProjection.priorities[0]!.title,
  courseName: navigationProjection.priorities[0]!.course.name,
  sourceProvider: "google_classroom",
  sourceExternalId: "source_private_01",
  estimatedMinutes: 20,
  selectedMinutes: 15,
  elapsedSeconds: 540,
  completedChunkIds: ["private_step_01"],
  completedChunkCount: 1,
  plannedChunkCount: 3,
  taskKind: "writing",
  sourceStatus: "Not submitted",
  completedAt: "2026-07-19T16:00:00.000Z"
};

describe("guardian progress projection", () => {
  it("shows linked tasks and aggregate focus progress without exposing student work", () => {
    const result = buildGuardianProgress({
      student: { id: "student_emily", name: "Emily" },
      projection: navigationProjection,
      focusBlocks: [focus]
    });
    const serialized = JSON.stringify(result);

    expect(result.student).toEqual({ id: "student_emily", name: "Emily" });
    expect(result.summary.focusSessionCount).toBe(1);
    expect(result.summary.minutesFocused).toBe(9);
    expect(result.tasks[0]).toMatchObject({ title: expect.any(String), courseName: expect.any(String) });
    expect(result.recentSessions[0]).toMatchObject({
      taskTitle: focus.taskTitle,
      completedStepCount: 1,
      plannedStepCount: 3,
      minutesFocused: 9,
      sourceStatus: "Not submitted"
    });
    expect(serialized).not.toContain("private_step_01");
    expect(serialized).not.toContain("session_private_01");
    expect(serialized).not.toContain("source_private_01");
    expect(serialized).not.toContain("directions");
    expect(result.privacy.keptPrivate).toContain("Drafts and answers");
  });
});
