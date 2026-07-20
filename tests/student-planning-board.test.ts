import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentPlanningBoardView } from "../app/components/student-planning-board";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";

const projection: StudentSourceProjection = {
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
    actionableCourseworkCount: 14,
    completedCourseworkCount: 0,
    eventCount: 1,
    connections: []
  },
  skillScaffolds: [
    { skill: "time_management", label: "Plan the time", studentAction: "Choose a timebox.", adultBoundary: "Student chooses.", visualPattern: "timebox", supportLevel: "developing" },
    { skill: "organization", label: "Set up the work", studentAction: "Gather what you need.", adultBoundary: "Student owns the work.", visualPattern: "course_buckets", supportLevel: "developing" },
    { skill: "prioritization", label: "Choose what matters", studentAction: "Use due date and effort.", adultBoundary: "Student chooses.", visualPattern: "urgency_effort_matrix", supportLevel: "developing" }
  ],
  today: {
    date: "2026-08-17",
    timeline: [{
      id: "due:algebra",
      kind: "due_marker",
      title: "Balancing Equations Readiness Check",
      courseName: "Algebra I",
      startsAt: null,
      endsAt: null,
      timeLabel: "11:59 PM",
      durationMinutes: null,
      placement: "deadline",
      visualToken: "coral",
      source: { provider: "google_classroom", recordType: "coursework", externalId: "work_algebra", sourceUpdatedAt: null }
    }],
  },
  week: {
    startDate: "2026-08-17",
    endDate: "2026-08-23",
    days: [{ date: "2026-08-17", label: "Mon, Aug 17", items: [] }]
  },
  priorities: [{
    id: "google_classroom:coursework:work_algebra",
    rank: 1,
    priorityBand: "do_first",
    title: "Balancing Equations Readiness Check",
    directions: "Complete problems 1-5 and explain why both sides stay balanced.",
    sourceLink: "https://classroom.google.com/c/google_algebra/a/work_algebra",
    course: { externalId: "google_algebra", name: "Algebra I", trackCourseId: "course_algebra_1" },
    due: { date: "2026-08-17", time: "23:59:00" },
    urgency: { level: "today", label: "Due today", visualToken: "coral", daysUntilDue: 0 },
    effort: { level: "medium", label: "20-minute focus block", estimatedMinutes: 20, recommendedTimeboxMinutes: 20 },
    rationale: { summary: "Due today · 20 minutes · not submitted.", signals: ["Due today", "About 20 minutes", "Not submitted"] },
    chunks: [
      { id: "setup", order: 1, label: "Set up", action: "Open directions.", minutes: 3, skill: "organization", visualState: "ready" },
      { id: "focus", order: 2, label: "Focus", action: "Work one section.", minutes: 12, skill: "time_management", visualState: "next" },
      { id: "check", order: 3, label: "Check", action: "Review directions.", minutes: 5, skill: "prioritization", visualState: "check" }
    ],
    source: { provider: "google_classroom", recordType: "coursework", externalId: "work_algebra", sourceUpdatedAt: null }
  }],
  learningRecommendations: [{
    id: "learning:work_algebra",
    courseId: "course_algebra_1",
    courseName: "Algebra I",
    missionId: "readiness_algebra_balance_01",
    missionTitle: "Equations stay balanced",
    objective: "Explain why both sides need the same operation.",
    suggestedMinutes: 10,
    supportPreference: "example_first",
    rationale: "Due today · this short session prepares the exact skill.",
    visual: { format: "worked_example_then_steps", stepCount: 3, progressStyle: "visible_timebox_and_steps" },
    evidence: [
      { provider: "google_classroom", recordType: "course", externalId: "google_algebra", sourceUpdatedAt: null },
      { provider: "google_classroom", recordType: "coursework", externalId: "work_algebra", sourceUpdatedAt: null }
    ]
  }]
};

describe("visual live-source planning board", () => {
  it("shows one primary action and at most two next items in the Today view", () => {
    const html = renderToStaticMarkup(createElement(StudentPlanningBoardView, {
      projection,
      view: "today",
      onOpenTask: () => undefined,
      onOpenPlanner: () => undefined
    }));

    expect(html).toContain("One thing at a time");
    expect(html).toContain("Start here");
    expect(html).toContain("Balancing Equations Readiness Check");
    expect(html).toContain("About 20 minutes");
    expect(html).toContain("Open directions");
    expect(html).toContain("Start this assignment");
    expect(html).toContain("Build today’s live plan");
    expect(html).toContain("Here’s the next useful step");
    expect((html.match(/data-next-item=/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain("Guardian");
  });

  it("puts the visual week on its own view", () => {
    const html = renderToStaticMarkup(createElement(StudentPlanningBoardView, { projection, view: "week" }));

    expect(html).toContain("Your week at a glance");
    expect(html).toContain("Mon, Aug 17");
    expect(html).not.toContain("Start here");
  });

  it("uses a compact workspace presentation without duplicating later steps", () => {
    const projectionWithAlternative: StudentSourceProjection = {
      ...projection,
      priorities: [
        ...projection.priorities,
        {
          ...projection.priorities[0],
          id: "google_classroom:coursework:work_english",
          rank: 2,
          title: "Summer Reading Reflection"
        }
      ]
    };
    const html = renderToStaticMarkup(createElement(StudentPlanningBoardView, {
      projection: projectionWithAlternative,
      view: "today",
      presentation: "workspace",
      onOpenTask: () => undefined,
      onOpenPlanner: () => undefined
    }));

    expect(html).not.toContain("One thing at a time");
    expect(html).not.toContain("Here’s the next useful step");
    expect(html).toContain("Start this assignment");
    expect(html).toContain("Build today’s live plan");
    expect(html).toContain("Show me another option");
    expect(html).not.toContain("Then, if you want");
    expect(html).not.toContain("data-next-item=");
    expect(html).not.toContain("Want help fitting today together?");
  });
});
