import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentDailyCheckIn } from "../app/components/student-daily-check-in";
import { buildStudentDailyCheckIn } from "../lib/domain/student-daily-check-in";
import type { StudentSourceProjection } from "../lib/domain/student-source-projection";
import { navigationProjection } from "./student-navigation-fixture";

describe("bounded evidence-backed student check-in", () => {
  it("uses time of day and only names live work and events present in the projection", () => {
    const checkIn = buildStudentDailyCheckIn({
      studentName: "Emily",
      projection: navigationProjection,
      now: new Date("2026-08-17T14:00:00.000Z")
    });

    expect(checkIn.greeting).toBe("Good morning, Emily.");
    expect(checkIn.context).toContain("Marching band rehearsal");
    expect(checkIn.context).toContain("3 assignments");
    expect(checkIn.recommended).toMatchObject({
      action: { kind: "task", priorityId: "google_classroom:coursework:work_algebra" },
      title: "Balancing Equations Readiness Check"
    });
    expect(checkIn.alternatives).toHaveLength(3);
    expect(JSON.stringify(checkIn)).not.toContain("test tomorrow");
  });

  it("does not invent coursework, events, tests, or urgency when connected sources are empty", () => {
    const empty: StudentSourceProjection = {
      ...structuredClone(navigationProjection),
      priorities: [],
      learningRecommendations: [],
      classes: [],
      calendar: { items: [] },
      sourceSummary: {
        ...navigationProjection.sourceSummary,
        courseCount: 0,
        actionableCourseworkCount: 0,
        eventCount: 0
      }
    };
    const checkIn = buildStudentDailyCheckIn({
      studentName: "Emily",
      projection: empty,
      now: new Date("2026-08-18T01:00:00.000Z")
    });

    expect(checkIn.greeting).toBe("Good evening, Emily.");
    expect(checkIn.context).toContain("nothing requiring action");
    expect(checkIn.recommended.action.kind).toBe("rest");
    expect(JSON.stringify(checkIn).toLowerCase()).not.toMatch(/quiz|test|due today|rehearsal/);
    expect(checkIn.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(checkIn.alternatives.length).toBeLessThanOrEqual(3);
  });

  it("renders three controlled focus choices and progressively discloses alternatives", () => {
    const html = renderToStaticMarkup(createElement(StudentDailyCheckIn, {
      studentName: "Emily",
      projection: navigationProjection,
      now: new Date("2026-08-17T14:00:00.000Z")
    }));

    expect(html).toContain("Good morning, Emily.");
    expect(html).toContain("How is your focus right now?");
    expect(html).toContain("Ready");
    expect(html).toContain("A little scattered");
    expect(html).toContain("Low energy");
    expect(html).toContain("Recommended next step");
    expect(html).toContain("Show 3 other choices");
    expect(html).toContain("<details");
    expect(html).toContain("Tell Homeroom what’s making it hard to start");
    expect(html).toContain("One short message");
    expect(html).toContain("Check in with Homeroom");
  });
});
