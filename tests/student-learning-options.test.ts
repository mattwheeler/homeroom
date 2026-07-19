import { describe, expect, it } from "vitest";

import {
  buildStudentLearningOptions,
  gradeNineSummerLearningOptions
} from "../lib/domain/student-learning-options";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";

function projection(classes: StudentSourceProjection["classes"]): StudentSourceProjection {
  return {
    generatedAt: "2026-07-19T15:00:00.000Z",
    context: { localDate: "2026-07-19", age: 14, grade: 9, timeZone: "America/Chicago", scaffoldLevel: "guided_independence", visualFirst: true },
    sourceSummary: { courseCount: classes?.length ?? 0, actionableCourseworkCount: 0, completedCourseworkCount: 0, eventCount: 0, connections: [] },
    skillScaffolds: [], today: { date: "2026-07-19", timeline: [] },
    week: { startDate: "2026-07-19", endDate: "2026-07-25", days: [] },
    priorities: [], learningRecommendations: [], guardianAssistCandidates: [], classes
  };
}

describe("student Learning options", () => {
  it("uses only recognizable classes from the live projection", () => {
    const result = buildStudentLearningOptions(projection([
      { externalId: "english", name: "English I - Period 1", section: "Period 1", subject: "ELA", trackCourseId: "course_english_1", alternateLink: null, source: { provider: "google_classroom", recordType: "course", externalId: "english", sourceUpdatedAt: null } },
      { externalId: "robotics", name: "Robotics", section: null, subject: null, trackCourseId: null, alternateLink: null, source: { provider: "google_classroom", recordType: "course", externalId: "robotics", sourceUpdatedAt: null } }
    ]), 9);

    expect(result).toEqual([expect.objectContaining({ id: "course_english_1", name: "English I - Period 1", mode: "connected_class" })]);
    expect(JSON.stringify(result)).not.toContain("Algebra I");
  });

  it("uses honest Grade 9 summer readiness when no classes are synced", () => {
    expect(buildStudentLearningOptions(projection([]), 9)).toEqual(gradeNineSummerLearningOptions);
    expect(gradeNineSummerLearningOptions.every((item) => item.mode === "grade_readiness")).toBe(true);
  });
});
