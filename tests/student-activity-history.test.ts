import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudentActivityHistory } from "../app/components/student-activity-history";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";
import type { FocusBlockRecord } from "../lib/storage/focus-block-store";
import { navigationProjection } from "./student-navigation-fixture";

const priority = navigationProjection.priorities.find((item) => item.title === "Summer Reading Reflection")!;

const focus: FocusBlockRecord = {
  id: "focus_01",
  studentId: "student_01",
  sessionId: "session_01",
  taskId: priority.id,
  taskTitle: priority.title,
  courseName: priority.course.name,
  sourceProvider: "google_classroom",
  sourceExternalId: priority.source.externalId,
  estimatedMinutes: 20,
  selectedMinutes: 15,
  elapsedSeconds: 540,
  completedChunkIds: ["step_1"],
  completedChunkCount: 1,
  plannedChunkCount: 4,
  taskKind: "writing",
  sourceStatus: "Not submitted",
  completedAt: "2026-07-19T16:00:00.000Z"
};

function projection(currentPriority: typeof priority | null, status = "Not submitted"): StudentSourceProjection {
  return {
    generatedAt: "2026-07-19T16:00:00.000Z",
    context: { localDate: "2026-07-19", age: 14, grade: 9, timeZone: "America/Chicago", scaffoldLevel: "guided_independence", visualFirst: true },
    sourceSummary: { courseCount: 1, actionableCourseworkCount: currentPriority ? 1 : 0, completedCourseworkCount: currentPriority ? 0 : 1, eventCount: 0, connections: [] },
    skillScaffolds: [],
    today: { date: "2026-07-19", timeline: [] },
    week: { startDate: "2026-07-19", endDate: "2026-07-25", days: [] },
    priorities: currentPriority ? [currentPriority] : [],
    courseworkStatuses: [{
      taskId: priority.id,
      externalId: priority.source.externalId,
      title: priority.title,
      courseExternalId: priority.course.externalId,
      courseName: priority.course.name,
      state: status === "Turned in" ? "TURNED_IN" : "CREATED",
      label: status,
      isSourceComplete: status === "Turned in",
      sourceUpdatedAt: null
    }],
    learningRecommendations: []
  };
}

describe("StudentActivityHistory", () => {
  it("offers Resume for a partial session on a still-actionable task", () => {
    const html = renderToStaticMarkup(createElement(StudentActivityHistory, {
      focusBlocks: [focus],
      projection: projection(priority),
      onResume: vi.fn(),
      onRestart: vi.fn()
    }));
    expect(html).toContain("PICK UP WHERE YOU LEFT OFF");
    expect(html).toContain("View activity");
    expect(html).toContain("Summer Reading Reflection");
    expect(html).toContain("9 min worked");
    expect(html).toContain("1 of 4 steps");
    expect(html).toContain("Not submitted");
    expect(html).toContain("Resume session");
  });

  it("uses source truth after Classroom marks the task complete and keeps the session reviewable", () => {
    const html = renderToStaticMarkup(createElement(StudentActivityHistory, {
      focusBlocks: [focus],
      projection: projection(null, "Turned in"),
      onResume: vi.fn(),
      onRestart: vi.fn()
    }));
    expect(html).toContain("Turned in");
    expect(html).toContain("Review session");
    expect(html).not.toContain("Resume");
  });
});
