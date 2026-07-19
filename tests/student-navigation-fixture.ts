import type {
  ProjectedPriority,
  ProjectedSourceClass,
  StudentSourceProjection
} from "../lib/domain/student-source-projection";

const classNames = [
  ["google_algebra", "Algebra I - Period 2", "Period 2", "Mathematics", "course_algebra_1"],
  ["google_art", "Art I - Period 7", "Period 7", "Visual Arts", "course_art_1"],
  ["google_biology", "Biology - Period 3", "Period 3", "Science", "course_biology"],
  ["google_band", "Concert Band - Period 6", "Period 6", "Music", "course_band"],
  ["google_english", "English I - Period 1", "Period 1", "English Language Arts", "course_english_1"],
  ["google_spanish", "Spanish I - Period 5", "Period 5", "World Languages", "course_spanish_1"],
  ["google_geography", "World Geography - Period 4", "Period 4", "Social Studies", "course_world_geography"]
] as const;

const classes: ProjectedSourceClass[] = classNames.map(([externalId, name, section, subject, trackCourseId]) => ({
  externalId,
  name,
  section,
  subject,
  trackCourseId,
  alternateLink: `https://classroom.google.com/c/${externalId}`,
  source: { provider: "google_classroom", recordType: "course", externalId, sourceUpdatedAt: null }
}));

function priority(input: {
  externalId: string;
  title: string;
  courseExternalId: string;
  courseName: string;
  trackCourseId: NonNullable<ProjectedPriority["course"]["trackCourseId"]>;
  dueDate: string;
  dueLabel: string;
  rank: number;
}): ProjectedPriority {
  return {
    id: `google_classroom:coursework:${input.externalId}`,
    rank: input.rank,
    priorityBand: input.rank === 1 ? "do_first" : "plan_next",
    title: input.title,
    course: {
      externalId: input.courseExternalId,
      name: input.courseName,
      trackCourseId: input.trackCourseId
    },
    due: { date: input.dueDate, time: "23:59:00" },
    urgency: {
      level: input.rank === 1 ? "today" : "upcoming",
      label: input.dueLabel,
      visualToken: input.rank === 1 ? "coral" : "blue",
      daysUntilDue: input.rank === 1 ? 0 : 1
    },
    effort: {
      level: "medium",
      label: "20-minute focus task",
      estimatedMinutes: 20,
      recommendedTimeboxMinutes: 20
    },
    rationale: {
      summary: `${input.dueLabel} · 20 minutes · not submitted.`,
      signals: [input.dueLabel, "About 20 minutes", "Not submitted"]
    },
    chunks: [
      { id: `${input.externalId}:setup`, order: 1, label: "Set up", action: "Open directions.", minutes: 3, skill: "organization", visualState: "ready" },
      { id: `${input.externalId}:focus`, order: 2, label: "Focus", action: "Work one section.", minutes: 12, skill: "time_management", visualState: "next" },
      { id: `${input.externalId}:check`, order: 3, label: "Check", action: "Review directions.", minutes: 5, skill: "prioritization", visualState: "check" }
    ],
    source: {
      provider: "google_classroom",
      recordType: "coursework",
      externalId: input.externalId,
      sourceUpdatedAt: "2026-08-16T12:00:00.000Z"
    }
  };
}

const priorities = [
  priority({
    externalId: "work_algebra",
    title: "Balancing Equations Readiness Check",
    courseExternalId: "google_algebra",
    courseName: "Algebra I - Period 2",
    trackCourseId: "course_algebra_1",
    dueDate: "2026-08-17",
    dueLabel: "Due today",
    rank: 1
  }),
  priority({
    externalId: "work_english",
    title: "Summer Reading Reflection",
    courseExternalId: "google_english",
    courseName: "English I - Period 1",
    trackCourseId: "course_english_1",
    dueDate: "2026-08-18",
    dueLabel: "Due tomorrow",
    rank: 2
  }),
  priority({
    externalId: "work_geography",
    title: "Map Evidence Organizer",
    courseExternalId: "google_geography",
    courseName: "World Geography - Period 4",
    trackCourseId: "course_world_geography",
    dueDate: "2026-09-02",
    dueLabel: "Due in 16 days",
    rank: 3
  })
];

export const navigationProjection: StudentSourceProjection = {
  generatedAt: "2026-08-17T14:00:00.000Z",
  context: {
    localDate: "2026-08-17",
    age: 14,
    grade: 9,
    timeZone: "America/Chicago",
    scaffoldLevel: "guided_independence",
    visualFirst: true
  },
  sourceSummary: {
    courseCount: 7,
    actionableCourseworkCount: 3,
    completedCourseworkCount: 0,
    eventCount: 1,
    connections: [
      { provider: "google_classroom", status: "active", displayName: "Google Classroom", lastSyncAt: "2026-08-17T13:45:00.000Z", lastErrorCode: null },
      { provider: "band_ical", status: "active", displayName: "BAND calendar", lastSyncAt: "2026-08-17T13:40:00.000Z", lastErrorCode: null }
    ]
  },
  skillScaffolds: [],
  today: { date: "2026-08-17", timeline: [] },
  week: {
    startDate: "2026-08-17",
    endDate: "2026-08-23",
    days: []
  },
  priorities,
  learningRecommendations: [],
  guardianAssistCandidates: [{
    id: "guardian:google_classroom:coursework:physical_form",
    taskId: "google_classroom:coursework:physical_form",
    title: "Band physical form",
    courseName: "Concert Band - Period 6",
    due: { date: "2026-07-24", time: "17:00:00" },
    reason: "The connected school source indicates that a parent or guardian may need to handle this item.",
    source: { provider: "google_classroom", recordType: "coursework", externalId: "physical_form", sourceUpdatedAt: null }
  }],
  classes,
  calendar: {
    items: [
      ...priorities.map((item) => ({
        id: `${item.id}:calendar`,
        kind: "coursework" as const,
        title: item.title,
        date: item.due!.date,
        timeLabel: "11:59 PM",
        startsAt: null,
        endsAt: null,
        courseExternalId: item.course.externalId,
        courseName: item.course.name,
        statusLabel: item.urgency.label,
        visualToken: item.urgency.visualToken,
        source: item.source
      })),
      {
        id: "band_ical:event:band_rehearsal:calendar",
        kind: "event",
        title: "Marching band rehearsal",
        date: "2026-08-17",
        timeLabel: "5:00 PM",
        startsAt: "2026-08-17T22:00:00.000Z",
        endsAt: "2026-08-18T00:00:00.000Z",
        courseExternalId: null,
        courseName: null,
        statusLabel: "Scheduled",
        visualToken: "green",
        source: { provider: "band_ical", recordType: "calendar_event", externalId: "band_rehearsal", sourceUpdatedAt: null }
      }
    ]
  }
};
