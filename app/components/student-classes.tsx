"use client";

import { useState } from "react";

import type { CourseId } from "../../lib/domain/learning-tracks";
import type {
  ProjectedPriority,
  ProjectedSourceClass,
  StudentSourceProjection
} from "../../lib/domain/student-source-projection";
import styles from "./student-classes.module.css";
import { StudentOutboundGuard } from "./student-outbound-guard";

export interface StudentClassGroup {
  course: ProjectedSourceClass;
  assignments: ProjectedPriority[];
}

export type StudentClassSort = "period" | "next_due";

function periodNumber(course: ProjectedSourceClass): number {
  const value = `${course.section ?? ""} ${course.name}`.match(/(?:period\s*)?(\d+)/i)?.[1];
  return value ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function fallbackClasses(projection: StudentSourceProjection): ProjectedSourceClass[] {
  const courses = new Map<string, ProjectedSourceClass>();
  for (const priority of projection.priorities) {
    if (courses.has(priority.course.externalId)) continue;
    courses.set(priority.course.externalId, {
      externalId: priority.course.externalId,
      name: priority.course.name,
      section: null,
      subject: null,
      trackCourseId: priority.course.trackCourseId,
      alternateLink: null,
      outbound: { available: false, policy: projection.outboundNavigation?.externalLinks ?? "blocked" },
      source: {
        provider: "google_classroom",
        recordType: "course",
        externalId: priority.course.externalId,
        sourceUpdatedAt: null
      }
    });
  }
  return [...courses.values()];
}

export function connectedClassContext(projection: StudentSourceProjection): string {
  const nextDistrictDate = projection.calendar?.items.find((item) =>
    item.source.provider === "school_calendar" && item.date >= projection.context.localDate
  );
  if (nextDistrictDate) {
    return `Official district calendar: ${nextDistrictDate.title} · ${nextDistrictDate.date}.`;
  }
  return "Connected from Google Classroom · sorted by next due date when you choose that view.";
}

export function groupAssignmentsByClass(
  projection: StudentSourceProjection,
  sort: StudentClassSort = "period"
): StudentClassGroup[] {
  const classes = projection.classes ?? fallbackClasses(projection);
  const groups = classes.map((course) => ({
    course,
    assignments: projection.priorities
      .filter((assignment) => assignment.course.externalId === course.externalId)
      .sort((left, right) => {
        const leftDate = left.due?.date ?? "9999-12-31";
        const rightDate = right.due?.date ?? "9999-12-31";
        return leftDate.localeCompare(rightDate) || left.rank - right.rank || left.title.localeCompare(right.title);
      })
  }));
  return groups.sort((left, right) => {
    if (sort === "next_due") {
      const leftDue = left.assignments[0]?.due?.date ?? "9999-12-31";
      const rightDue = right.assignments[0]?.due?.date ?? "9999-12-31";
      return leftDue.localeCompare(rightDue)
        || periodNumber(left.course) - periodNumber(right.course)
        || left.course.name.localeCompare(right.course.name);
    }
    return periodNumber(left.course) - periodNumber(right.course)
      || left.course.name.localeCompare(right.course.name);
  });
}

export function StudentClasses({
  projection,
  initialExpandedCourseId,
  onOpenLearning,
  onOpenTask
}: {
  projection: StudentSourceProjection;
  initialExpandedCourseId?: string;
  onOpenLearning(courseId: CourseId): void;
  onOpenTask?: (priority: ProjectedPriority) => void;
}) {
  const [sort, setSort] = useState<StudentClassSort>("period");
  const groups = groupAssignmentsByClass(projection, sort);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(
    initialExpandedCourseId ?? null
  );

  if (groups.length === 0) {
    return (
      <section className={styles.classes} aria-labelledby="student-classes-title">
        <header className={styles.intro}>
          <p>CLASSES · ORGANIZED FOR YOU</p>
          <h2 id="student-classes-title">No connected classes yet.</h2>
          <span>When Google Classroom connects, each class will get its own calm workspace here.</span>
        </header>
      </section>
    );
  }

  return (
    <section className={styles.classes} aria-labelledby="student-classes-title">
      <header className={styles.intro}>
        <div>
          <p>CLASSES · ORGANIZED FOR YOU</p>
          <h2 id="student-classes-title">All {groups.length} connected classes.</h2>
          <span>{connectedClassContext(projection)}</span>
        </div>
        <div className={styles.introTools}>
          <div className={styles.sortControl} aria-label="Organize classes">
            <button type="button" aria-pressed={sort === "period"} onClick={() => setSort("period")}>Period order</button>
            <button type="button" aria-pressed={sort === "next_due"} onClick={() => setSort("next_due")}>Next due</button>
          </div>
          <span className={styles.sourceBadge}><i aria-hidden="true">G</i> Google Classroom</span>
        </div>
      </header>

      <div className={styles.classList}>
        {groups.map(({ course, assignments }, index) => {
          const expanded = expandedCourseId === course.externalId;
          const panelId = `student-class-panel-${index}`;
          const next = assignments[0];
          return (
            <article className={`${styles.classCard} ${expanded ? styles.expanded : ""}`} data-class-card={course.externalId} key={course.externalId}>
              <button
                className={styles.classSummary}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setExpandedCourseId(expanded ? null : course.externalId)}
              >
                <span className={styles.period} aria-hidden="true">{periodNumber(course) === Number.MAX_SAFE_INTEGER ? index + 1 : periodNumber(course)}</span>
                <span className={styles.classIdentity}>
                  <strong>{course.name}</strong>
                  <small>{[course.section, course.subject].filter(Boolean).join(" · ") || "Connected class"}</small>
                </span>
                <span className={styles.classStatus}>
                  <strong>{assignments.length}</strong>
                  <small>{assignments.length === 1 ? "upcoming item" : "upcoming items"}</small>
                  {next && <em>{next.urgency.label}</em>}
                </span>
                <span className={styles.chevron} aria-hidden="true">⌄</span>
              </button>

              {expanded && (
                <div className={styles.classPanel} id={panelId}>
                  <div className={styles.panelHeading}>
                    <div><p>UPCOMING</p><h3>What’s ahead</h3></div>
                    {course.trackCourseId && (
                      <button
                        type="button"
                        onClick={() => onOpenLearning(course.trackCourseId as CourseId)}
                        aria-label={`Open ${course.name} Learning room`}
                      >Open Learning room <span aria-hidden="true">→</span></button>
                    )}
                  </div>

                  {assignments.length === 0 ? (
                    <div className={styles.clearState}><span aria-hidden="true">✓</span><strong>Nothing due right now.</strong><small>This class is organized and clear.</small></div>
                  ) : (
                    <>
                      <ol className={styles.assignmentList}>
                        {assignments.slice(0, 3).map((assignment) => (
                          <li key={assignment.id}>
                            <span className={`${styles.urgencyDot} ${styles[assignment.urgency.visualToken]}`} aria-hidden="true" />
                            <div><strong>{assignment.title}</strong><small>{assignment.effort.label}</small></div>
                            <span className={styles.assignmentMeta}><strong>{assignment.urgency.label}</strong><small>{assignment.due?.time ? "By " + assignment.due.time.slice(0, 5) : "Time not set"}</small></span>
                            {onOpenTask && <button className={styles.openTask} type="button" onClick={() => onOpenTask(assignment)}>Open task</button>}
                          </li>
                        ))}
                      </ol>
                      {assignments.length > 3 && (
                        <details className={styles.moreAssignments}>
                          <summary>Show {assignments.length - 3} more assignments</summary>
                          <ol>
                            {assignments.slice(3).map((assignment) => <li key={assignment.id}>{assignment.title} · {assignment.urgency.label}</li>)}
                          </ol>
                        </details>
                      )}
                    </>
                  )}

                  <footer className={styles.panelFooter}>
                    <span><i aria-hidden="true">G</i> Google Classroom</span>
                    {course.outbound?.available && (
                      <StudentOutboundGuard policy={course.outbound.policy} resourceLabel="source class" />
                    )}
                  </footer>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className={styles.organizationCue}><span aria-hidden="true">▦</span><strong>Organization skill:</strong> one class, one list, one next action.</p>
    </section>
  );
}
