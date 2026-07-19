import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildCalendarMonth,
  shiftMonthKey,
  StudentCalendar
} from "../app/components/student-calendar";
import { navigationProjection } from "./student-navigation-fixture";

describe("student month and agenda calendar", () => {
  it("builds a stable six-week month grid and navigates across years", () => {
    const month = buildCalendarMonth("2026-08");

    expect(month).toHaveLength(42);
    expect(month[0]).toEqual({ date: "2026-07-26", dayNumber: 26, inMonth: false });
    expect(month[6]).toEqual({ date: "2026-08-01", dayNumber: 1, inMonth: true });
    expect(month[41]).toEqual({ date: "2026-09-05", dayNumber: 5, inMonth: false });
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("shows one selected day, visual item counts, and source-labeled agenda items", () => {
    const html = renderToStaticMarkup(createElement(StudentCalendar, {
      projection: navigationProjection,
      initialSelectedDate: "2026-08-17"
    }));

    expect(html).toContain("August 2026");
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
    expect((html.match(/role="gridcell"/g) ?? [])).toHaveLength(42);
    expect(html).toContain('aria-label="Monday, August 17, 2 items"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Monday, August 17");
    expect(html).toContain("Balancing Equations Readiness Check");
    expect(html).toContain("Marching band rehearsal");
    expect(html).toContain("Google Classroom");
    expect(html).toContain("BAND calendar");
    expect(html).toContain("categorySchoolwork");
    expect(html).toContain("categoryEvent");
    expect(html).not.toContain("Map Evidence Organizer");
    expect(html).toContain("Guardian assist");
    expect(html).toContain("source-backed");
  });

  it("keeps an empty selected day calm instead of showing the whole month", () => {
    const html = renderToStaticMarkup(createElement(StudentCalendar, {
      projection: navigationProjection,
      initialSelectedDate: "2026-08-20"
    }));

    expect(html).toContain("Nothing scheduled here");
    expect(html).toContain("Choose another date or return to Today");
    expect(html).not.toContain("Balancing Equations Readiness Check");
  });
});
