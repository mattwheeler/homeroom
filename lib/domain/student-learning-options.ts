import type { CourseId } from "./learning-tracks";
import type { StudentSourceProjection } from "./student-source-projection";

export interface StudentLearningOption {
  id: CourseId;
  name: string;
  mode: "connected_class" | "grade_readiness";
  reason: string;
}

export const gradeNineSummerLearningOptions: readonly StudentLearningOption[] = Object.freeze([
  { id: "course_english_1", name: "Reading & writing", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_algebra_1", name: "Math foundations", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_biology", name: "Science thinking", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_world_geography", name: "World studies", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_band", name: "Music & rhythm", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_art_1", name: "Visual thinking", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" },
  { id: "course_spanish_1", name: "Language practice", mode: "grade_readiness", reason: "Homeroom-created for Grade 9 summer readiness" }
]);

export function buildStudentLearningOptions(
  projection: StudentSourceProjection,
  grade: number
): readonly StudentLearningOption[] {
  const seen = new Set<CourseId>();
  const connected: StudentLearningOption[] = [];
  for (const course of projection.classes ?? []) {
    if (!course.trackCourseId || seen.has(course.trackCourseId)) continue;
    seen.add(course.trackCourseId);
    const recommendation = projection.learningRecommendations.find(
      (candidate) => candidate.courseId === course.trackCourseId
    );
    connected.push({
      id: course.trackCourseId,
      name: course.name,
      mode: "connected_class",
      reason: recommendation?.rationale ?? "Connected from Google Classroom"
    });
  }
  if (connected.length > 0) return connected;
  if (grade === 9) return gradeNineSummerLearningOptions;
  return gradeNineSummerLearningOptions.map((option) => ({
    ...option,
    reason: `Homeroom-created readiness for Grade ${grade}`
  }));
}
