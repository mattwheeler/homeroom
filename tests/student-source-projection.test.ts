import { describe, expect, it } from "vitest";

import {
  projectStudentSources,
  StudentSourceProjectionError,
  type StudentProjectionProfile
} from "../lib/domain/student-source-projection";
import type { SourceSnapshot } from "../lib/storage/source-connection-store";

const profile: StudentProjectionProfile = {
  studentId: "student_emily",
  name: "Emily",
  age: 14,
  grade: 9,
  timeZone: "America/Chicago",
  learningModalities: ["visual", "interactive", "worked_examples"],
  executiveSkills: {
    timeManagement: "developing",
    organization: "developing",
    prioritization: "developing"
  },
  supportPreference: "example_first"
};

function snapshot(): SourceSnapshot {
  return {
    connections: [
      {
        provider: "google_classroom",
        status: "active",
        displayName: "Google Classroom",
        lastSyncAt: "2026-08-17T13:45:00.000Z",
        lastErrorCode: null
      },
      {
        provider: "band_ical",
        status: "active",
        displayName: "BAND calendar",
        lastSyncAt: "2026-08-17T13:40:00.000Z",
        lastErrorCode: null
      }
    ],
    courses: [
      {
        provider: "google_classroom",
        externalId: "google_algebra",
        name: "Algebra I - Period 2",
        section: "Period 2",
        subject: "Mathematics",
        courseState: "ACTIVE",
        alternateLink: "https://classroom.google.com/c/google_algebra",
        calendarId: null,
        trackCourseId: "course_algebra_1"
      },
      {
        provider: "google_classroom",
        externalId: "google_english",
        name: "English I - Period 1",
        section: "Period 1",
        subject: "English Language Arts",
        courseState: "ACTIVE",
        alternateLink: "https://classroom.google.com/c/google_english",
        calendarId: null,
        trackCourseId: "course_english_1"
      },
      {
        provider: "google_classroom",
        externalId: "google_biology",
        name: "Biology - Period 3",
        section: "Period 3",
        subject: "Science",
        courseState: "ACTIVE",
        alternateLink: null,
        calendarId: null,
        trackCourseId: "course_biology"
      }
    ],
    coursework: [
      {
        provider: "google_classroom",
        externalId: "work_algebra_today",
        courseExternalId: "google_algebra",
        title: "Balancing Equations Readiness Check",
        description: "Complete problems 1-5 and explain why both sides stay balanced.",
        workType: "ASSIGNMENT",
        dueDate: "2026-08-17",
        dueTime: "23:59:00",
        alternateLink: "https://classroom.google.com/c/google_algebra/a/work_algebra_today",
        updateTime: "2026-08-16T12:00:00Z",
        submissionState: "CREATED",
        late: false
      },
      {
        provider: "google_classroom",
        externalId: "work_english_tomorrow",
        courseExternalId: "google_english",
        title: "Summer Reading Reflection",
        description: "Write one paragraph using a central idea and supporting evidence.",
        workType: "ASSIGNMENT",
        dueDate: "2026-08-18",
        dueTime: "23:59:00",
        alternateLink: null,
        updateTime: "2026-08-15T12:00:00Z",
        submissionState: "CREATED",
        late: false
      },
      {
        provider: "google_classroom",
        externalId: "work_biology_complete",
        courseExternalId: "google_biology",
        title: "Lab Safety Check",
        description: null,
        workType: "ASSIGNMENT",
        dueDate: "2026-08-17",
        dueTime: "17:00:00",
        alternateLink: null,
        updateTime: "2026-08-14T12:00:00Z",
        submissionState: "TURNED_IN",
        late: false
      }
    ],
    events: [
      {
        provider: "band_ical",
        uid: "band_rehearsal_0817",
        title: "Marching band rehearsal",
        description: "Bring water and drill book.",
        location: "Band field",
        startsAt: "2026-08-17T22:00:00.000Z",
        endsAt: "2026-08-18T00:00:00.000Z",
        allDay: false,
        status: "CONFIRMED",
        sourceUpdatedAt: "2026-08-16T18:00:00.000Z"
      }
    ]
  };
}

describe("live student source projection", () => {
  it("turns source records into visual planning scaffolds for a ninth grader", () => {
    const result = projectStudentSources({
      snapshot: snapshot(),
      profile,
      externalLinkPolicy: "guardian_approval",
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.context).toEqual({
      localDate: "2026-08-17",
      age: 14,
      grade: 9,
      timeZone: "America/Chicago",
      scaffoldLevel: "guided_independence",
      visualFirst: true
    });
    expect(result.sourceSummary).toMatchObject({
      courseCount: 3,
      actionableCourseworkCount: 2,
      completedCourseworkCount: 1,
      eventCount: 1
    });
    expect(result.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalId: "google_algebra",
        name: "Algebra I - Period 2",
        section: "Period 2",
        trackCourseId: "course_algebra_1",
        source: expect.objectContaining({ recordType: "course", externalId: "google_algebra" })
      })
    ]));
    expect(result.calendar?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "coursework",
        date: "2026-08-17",
        source: expect.objectContaining({ externalId: "work_algebra_today" })
      }),
      expect.objectContaining({
        kind: "event",
        date: "2026-08-17",
        source: expect.objectContaining({ externalId: "band_rehearsal_0817" })
      })
    ]));

    expect(result.priorities.map((item) => item.source.externalId)).toEqual([
      "work_algebra_today",
      "work_english_tomorrow"
    ]);
    expect(result.priorities[0]).toMatchObject({
      directions: "Complete problems 1-5 and explain why both sides stay balanced.",
      sourceLink: null,
      outbound: { available: true, policy: "guardian_approval" },
      course: { externalId: "google_algebra", trackCourseId: "course_algebra_1" },
      urgency: { level: "today", label: "Due today", visualToken: "coral" },
      effort: { level: "medium", estimatedMinutes: 20 },
      source: {
        provider: "google_classroom",
        recordType: "coursework",
        externalId: "work_algebra_today",
        sourceUpdatedAt: "2026-08-16T12:00:00Z"
      }
    });
    expect(result.priorities[0]?.rationale.signals).toEqual([
      "Due today",
      "About 20 minutes",
      "Not submitted"
    ]);
    expect(result.priorities[0]?.chunks.map((chunk) => chunk.skill)).toEqual([
      "organization",
      "time_management",
      "prioritization"
    ]);
    expect(result.priorities[0]?.chunks.reduce((sum, chunk) => sum + chunk.minutes, 0)).toBe(20);

    expect(result.today.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "due_marker",
        title: "Balancing Equations Readiness Check",
        source: expect.objectContaining({ externalId: "work_algebra_today" })
      }),
      expect.objectContaining({
        kind: "event",
        title: "Marching band rehearsal",
        source: expect.objectContaining({ externalId: "band_rehearsal_0817" })
      }),
      expect.objectContaining({
        kind: "focus_block",
        durationMinutes: 20,
        placement: "student_chooses_time"
      })
    ]));
    expect(result.week.days.find((day) => day.date === "2026-08-18")?.items).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ externalId: "work_english_tomorrow" }) })
    ]);
    expect(JSON.stringify(result)).not.toContain("work_biology_complete");
    expect(JSON.stringify(result)).not.toContain("https://classroom.google.com");
  });

  it.each(["blocked", "guardian_approval"] as const)(
    "never delivers source URLs to the student projection when external links are %s",
    (externalLinkPolicy) => {
      const schoolSnapshot = {
        connections: [{
          id: "school-source-1",
          provider: "school_supplies" as const,
          status: "active" as const,
          displayName: "Official supply list",
          sourceUrl: "https://schools.example.edu/supplies/grade-9",
          lastSyncAt: "2026-08-17T13:00:00.000Z",
          lastErrorCode: null
        }],
        events: [],
        supplyLists: [{
          provider: "school_supplies" as const,
          title: "Grade 9 supply list",
          sourceUrl: "https://schools.example.edu/supplies/grade-9",
          sourceTitle: "Official supply list",
          items: [{ id: "pencils", text: "Pencils", quantity: 2, sourceOrdinal: 1, kind: "item" as const }]
        }]
      };
      const result = projectStudentSources({
        snapshot: snapshot(),
        schoolSnapshot,
        profile,
        externalLinkPolicy,
        now: new Date("2026-08-17T14:00:00.000Z")
      });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("https://classroom.google.com");
      expect(serialized).not.toContain("https://schools.example.edu");
      expect(result.outboundNavigation).toEqual({ externalLinks: externalLinkPolicy });
      expect(result.classes?.find((course) => course.externalId === "google_algebra")).toMatchObject({
        alternateLink: null,
        outbound: { available: true, policy: externalLinkPolicy }
      });
      expect(result.supplies?.[0]).toMatchObject({
        id: "school_supplies:0",
        outbound: { available: true, policy: externalLinkPolicy }
      });
      expect(result.supplies?.[0]).not.toHaveProperty("sourceUrl");
      expect(result.sourceSummary.schoolConnections?.[0]).not.toHaveProperty("sourceUrl");
    }
  );

  it("fails closed for an invalid external-link policy", () => {
    expect(() => projectStudentSources({
      snapshot: snapshot(),
      profile,
      externalLinkPolicy: "allow" as "blocked",
      now: new Date("2026-08-17T14:00:00.000Z")
    })).toThrow("external-link policy");
  });

  it("recommends a timeboxed Learning track grounded in the highest live priority", () => {
    const result = projectStudentSources({
      snapshot: snapshot(),
      profile,
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.learningRecommendations[0]).toMatchObject({
      courseId: "course_algebra_1",
      courseName: "Algebra I - Period 2",
      missionId: "readiness_algebra_balance_01",
      suggestedMinutes: 10,
      supportPreference: "example_first",
      visual: { format: "worked_example_then_steps", stepCount: 3 }
    });
    expect(result.learningRecommendations[0]?.evidence).toEqual([
      expect.objectContaining({ recordType: "course", externalId: "google_algebra" }),
      expect.objectContaining({ recordType: "coursework", externalId: "work_algebra_today" })
    ]);
    expect(result.learningRecommendations[0]?.rationale).toContain("Due today");
  });

  it("orders overdue, late, and upcoming work deterministically without inventing deadlines", () => {
    const input = snapshot();
    input.events = [];
    input.coursework = [
      { ...input.coursework[1]!, externalId: "undated", title: "Optional review", dueDate: null, dueTime: null },
      { ...input.coursework[0]!, externalId: "later", dueDate: "2026-08-20", dueTime: null },
      { ...input.coursework[0]!, externalId: "late", dueDate: "2026-08-16", late: true },
      { ...input.coursework[0]!, externalId: "same_day_b", title: "B task" },
      { ...input.coursework[0]!, externalId: "same_day_a", title: "A task" }
    ];

    const result = projectStudentSources({
      snapshot: input,
      profile,
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.priorities.map((item) => item.source.externalId)).toEqual([
      "late",
      "same_day_a",
      "same_day_b",
      "later",
      "undated"
    ]);
    expect(result.priorities[0]?.urgency.level).toBe("overdue");
    expect(result.priorities.at(-1)).toMatchObject({
      due: null,
      urgency: { level: "unscheduled", label: "No due date" }
    });
  });

  it("keeps the four executive-function supports explicit even with no live tasks", () => {
    const empty = snapshot();
    empty.courses = [];
    empty.coursework = [];
    empty.events = [];
    const result = projectStudentSources({
      snapshot: empty,
      profile,
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.priorities).toEqual([]);
    expect(result.today.timeline).toEqual([]);
    expect(result.learningRecommendations).toEqual([]);
    expect(result.guardianAssistCandidates).toEqual([]);
    expect(result.skillScaffolds).toEqual([
      expect.objectContaining({ skill: "time_management", visualPattern: "timebox" }),
      expect.objectContaining({ skill: "organization", visualPattern: "course_buckets" }),
      expect.objectContaining({ skill: "prioritization", visualPattern: "urgency_effort_matrix" })
    ]);
  });

  it("offers guardian help only when a live source explicitly supports it", () => {
    const input = snapshot();
    input.coursework.push({
      ...input.coursework[0]!,
      externalId: "band_physical_form",
      courseExternalId: "google_algebra",
      title: "Band physical form",
      description: "A parent or guardian must sign and complete this form.",
      dueDate: "2026-08-20",
      dueTime: "17:00:00"
    });
    const result = projectStudentSources({
      snapshot: input,
      profile,
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.guardianAssistCandidates).toEqual([
      expect.objectContaining({
        taskId: "google_classroom:coursework:band_physical_form",
        title: "Band physical form",
        due: { date: "2026-08-20", time: "17:00:00" },
        source: expect.objectContaining({ externalId: "band_physical_form" })
      })
    ]);

    const withoutGuardianLanguage = snapshot();
    expect(projectStudentSources({
      snapshot: withoutGuardianLanguage,
      profile,
      now: new Date("2026-08-17T14:00:00.000Z")
    }).guardianAssistCandidates).toEqual([]);
  });

  it("fails closed for a profile outside the K-12 support contract", () => {
    expect(() => projectStudentSources({
      snapshot: snapshot(),
      profile: { ...profile, age: 25, grade: 20 },
      now: new Date("2026-08-17T14:00:00.000Z")
    })).toThrow(StudentSourceProjectionError);
  });

  it("reduces directions and timebox size for a younger emerging planner", () => {
    const youngerSnapshot = snapshot();
    youngerSnapshot.coursework = [{
      ...youngerSnapshot.coursework[0]!,
      title: "Research project presentation",
      dueDate: "2026-08-18"
    }];
    const result = projectStudentSources({
      snapshot: youngerSnapshot,
      profile: {
        ...profile,
        age: 10,
        grade: 5,
        learningModalities: ["visual", "interactive"],
        executiveSkills: {
          timeManagement: "emerging",
          organization: "emerging",
          prioritization: "emerging"
        }
      },
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.context.scaffoldLevel).toBe("step_by_step");
    expect(result.priorities[0]?.effort).toMatchObject({
      level: "deep",
      estimatedMinutes: 45,
      recommendedTimeboxMinutes: 15
    });
    expect(result.priorities[0]?.chunks).toHaveLength(2);
    expect(result.priorities[0]?.chunks.reduce((sum, chunk) => sum + chunk.minutes, 0)).toBe(15);
    expect(result.learningRecommendations[0]?.visual.stepCount).toBe(2);
    expect(result.skillScaffolds.every((scaffold) => scaffold.supportLevel === "emerging")).toBe(true);
  });

  it("rejects invalid projection time, time zone, and support preference", () => {
    expect(() => projectStudentSources({
      snapshot: snapshot(), profile: { ...profile, timeZone: "Mars/Base" }
    })).toThrow("time zone");
    expect(() => projectStudentSources({
      snapshot: snapshot(), profile, now: new Date("invalid")
    })).toThrow("projection time");
    expect(() => projectStudentSources({
      snapshot: snapshot(),
      profile: { ...profile, supportPreference: "unsupported" as StudentProjectionProfile["supportPreference"] }
    })).toThrow("support preference");
  });

  it("renders all-day events and varied urgency, effort, and submission signals", () => {
    const varied = snapshot();
    varied.events = [
      { ...varied.events[0]!, uid: "all_day_camp", startsAt: "2026-08-17", endsAt: null, allDay: true },
      { ...varied.events[0]!, uid: "invalid_event", startsAt: "not-a-date", endsAt: null }
    ];
    varied.coursework = [
      {
        ...varied.coursework[0]!,
        externalId: "quick",
        title: "One question exit ticket",
        dueDate: "2026-08-22",
        dueTime: null,
        submissionState: "RECLAIMED_BY_STUDENT"
      },
      {
        ...varied.coursework[1]!,
        externalId: "later_default",
        title: "Chapter notes",
        description: null,
        dueDate: "2026-09-01",
        dueTime: null,
        submissionState: "DRAFT"
      },
      {
        ...varied.coursework[1]!,
        externalId: "bad_deadline",
        title: "Date to confirm",
        dueDate: "2026-02-31",
        dueTime: null
      }
    ];

    const result = projectStudentSources({
      snapshot: varied,
      profile: { ...profile, supportPreference: "questions_first" },
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.today.timeline).toContainEqual(expect.objectContaining({
      kind: "event",
      timeLabel: "All day",
      durationMinutes: null,
      source: expect.objectContaining({ externalId: "all_day_camp" })
    }));
    expect(JSON.stringify(result)).not.toContain("invalid_event");
    expect(result.priorities.find((item) => item.source.externalId === "quick")).toMatchObject({
      urgency: { level: "upcoming" },
      effort: { level: "quick", estimatedMinutes: 15 },
      rationale: { signals: ["Due in 5 days", "About 15 minutes", "Needs another submission"] }
    });
    expect(result.priorities.find((item) => item.source.externalId === "later_default")).toMatchObject({
      urgency: { level: "later" },
      effort: { level: "medium", estimatedMinutes: 25 },
      rationale: { signals: ["Due in 15 days", "About 25 minutes", "In progress"] }
    });
    expect(result.priorities.find((item) => item.source.externalId === "bad_deadline")).toMatchObject({
      due: null,
      urgency: { level: "unscheduled" }
    });
    expect(result.learningRecommendations[0]?.visual.format).toBe("question_path");
  });

  it("uses independent-planning and mixed-card scaffolds for an older student", () => {
    const result = projectStudentSources({
      snapshot: snapshot(),
      profile: {
        ...profile,
        age: 17,
        grade: 12,
        supportPreference: "mix_it_up",
        executiveSkills: {
          timeManagement: "independent",
          organization: "developing",
          prioritization: "independent"
        }
      },
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(result.context.scaffoldLevel).toBe("independent_planning");
    expect(result.learningRecommendations[0]?.visual.format).toBe("mixed_cards");
    expect(result.skillScaffolds).toEqual(expect.arrayContaining([
      expect.objectContaining({ skill: "organization", supportLevel: "developing" }),
      expect.objectContaining({ skill: "prioritization", supportLevel: "independent" })
    ]));
  });
});
