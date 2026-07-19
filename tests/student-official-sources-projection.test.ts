import { describe, expect, it } from "vitest";

import { projectStudentSources } from "../lib/domain/student-source-projection";
import { emilyStudentSupportProfile } from "../lib/domain/student-support-profile";

describe("student projection of official school sources", () => {
  it("adds grade-relevant district events and exact supply lists while filtering elementary-only notices", () => {
    const result = projectStudentSources({
      snapshot: { connections: [], courses: [], coursework: [], events: [] },
      schoolSnapshot: {
        connections: [{
          id: "school_calendar_1",
          provider: "school_calendar",
          status: "active",
          displayName: "Pieper + Comal ISD",
          sourceUrl: "https://phs.comalisd.org/",
          lastSyncAt: "2026-07-19T18:00:00.000Z",
          lastErrorCode: null
        }],
        events: [
          {
            provider: "school_calendar",
            uid: "labor-day",
            title: "Labor Day",
            description: "District holiday.",
            location: null,
            startsAt: "2026-09-07",
            endsAt: null,
            allDay: true,
            category: "school_closed",
            audience: "all_students",
            sourceUrl: "https://4.files.edl.io/calendar.pdf",
            sourceTitle: "Comal ISD 2026–27 Academic Calendar",
            sourceUpdatedAt: "2026-03-02"
          },
          {
            provider: "school_calendar",
            uid: "elementary-release",
            title: "Elementary Early Release",
            description: "Elementary only.",
            location: null,
            startsAt: "2026-10-21",
            endsAt: null,
            allDay: true,
            category: "early_release",
            audience: "elementary",
            sourceUrl: "https://4.files.edl.io/calendar.pdf",
            sourceTitle: "Comal ISD 2026–27 Academic Calendar",
            sourceUpdatedAt: "2026-03-02"
          }
        ],
        supplyLists: [{
          provider: "school_supplies",
          title: "Algebra 1 Supply List",
          sourceUrl: "https://phs.comalisd.org/apps/pages/algebra-supplies",
          sourceTitle: "Algebra 1 Supply List",
          items: [{ id: "pencils", text: "Pencils", quantity: null, sourceOrdinal: 1, kind: "item" }]
        }]
      },
      profile: {
        ...emilyStudentSupportProfile,
        timeZone: "America/Chicago",
        supportPreference: "example_first"
      },
      now: new Date("2026-08-01T15:00:00.000Z")
    });

    expect(result.calendar?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Labor Day",
        category: "school",
        statusLabel: "School closed",
        source: expect.objectContaining({ provider: "school_calendar" })
      })
    ]));
    expect(result.calendar?.items.map((item) => item.title)).not.toContain("Elementary Early Release");
    expect(result.supplies).toEqual([
      expect.objectContaining({
        sourceUrl: "https://phs.comalisd.org/apps/pages/algebra-supplies",
        items: [expect.objectContaining({ text: "Pencils", quantity: null })]
      })
    ]);
  });
});
