import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  groupAssignmentsByClass,
  StudentClasses
} from "../app/components/student-classes";
import { navigationProjection } from "./student-navigation-fixture";

describe("student connected-class directory", () => {
  it("groups upcoming work under every connected class without hiding empty classes", () => {
    const groups = groupAssignmentsByClass(navigationProjection);

    expect(groups).toHaveLength(7);
    expect(groups.map((group) => group.course.section)).toEqual([
      "Period 1", "Period 2", "Period 3", "Period 4", "Period 5", "Period 6", "Period 7"
    ]);
    expect(groups.find((group) => group.course.externalId === "google_algebra")?.assignments)
      .toEqual([expect.objectContaining({ title: "Balancing Equations Readiness Check" })]);
    expect(groups.find((group) => group.course.externalId === "google_art")?.assignments).toEqual([]);
  });

  it("can organize classes by the next due assignment", () => {
    const groups = groupAssignmentsByClass(navigationProjection, "next_due");

    expect(groups.slice(0, 3).map((group) => group.course.externalId)).toEqual([
      "google_algebra", "google_english", "google_geography"
    ]);
  });

  it("shows all classes but progressively discloses assignments for one class", () => {
    const html = renderToStaticMarkup(createElement(StudentClasses, {
      projection: navigationProjection,
      initialExpandedCourseId: "google_algebra",
      onOpenLearning: vi.fn()
    }));

    expect((html.match(/data-class-card=/g) ?? [])).toHaveLength(7);
    expect(html).toContain("All 7 connected classes");
    expect(html).toContain("Algebra I - Period 2");
    expect(html).toContain("Art I - Period 7");
    expect(html).toContain("Balancing Equations Readiness Check");
    expect(html).toContain("Due today");
    expect(html).toContain("Google Classroom");
    expect(html).toContain("Open Algebra I - Period 2 Learning room");
    expect(html).toContain("Ask your guardian to open");
    expect(html).not.toContain("href=");
    expect(html).toContain("sorted by next due date");
    expect(html).not.toContain("Summer Reading Reflection");
    expect((html.match(/aria-expanded="true"/g) ?? [])).toHaveLength(1);
  });

  it("changes the disclosed class through its controlled initial selection", () => {
    const html = renderToStaticMarkup(createElement(StudentClasses, {
      projection: navigationProjection,
      initialExpandedCourseId: "google_english",
      onOpenLearning: vi.fn()
    }));

    expect(html).toContain("Summer Reading Reflection");
    expect(html).toContain("Due tomorrow");
    expect(html).not.toContain("Balancing Equations Readiness Check");
  });

  it("starts with every class collapsed when no class was explicitly selected", () => {
    const html = renderToStaticMarkup(createElement(StudentClasses, {
      projection: navigationProjection,
      onOpenLearning: vi.fn()
    }));

    expect((html.match(/aria-expanded="false"/g) ?? [])).toHaveLength(7);
    expect(html).not.toContain("Balancing Equations Readiness Check");
    expect(html).toContain("Period order");
    expect(html).toContain("Next due");
  });

  it("names an official date only when it comes from the trusted district calendar", () => {
    const trusted = structuredClone(navigationProjection);
    trusted.calendar?.items.push({
      id: "school_calendar:first_day",
      kind: "event",
      title: "First day of school",
      date: "2026-08-24",
      timeLabel: "All day",
      startsAt: null,
      endsAt: null,
      courseExternalId: null,
      courseName: null,
      statusLabel: "School event",
      visualToken: "blue",
      category: "school",
      source: { provider: "school_calendar", recordType: "calendar_event", externalId: "first_day", sourceUpdatedAt: "2026-03-02T00:00:00.000Z" }
    });
    const html = renderToStaticMarkup(createElement(StudentClasses, {
      projection: trusted,
      onOpenLearning: vi.fn()
    }));

    expect(html).toContain("Official district calendar: First day of school · 2026-08-24");
    expect(html).not.toContain("Fall term");
  });
});
