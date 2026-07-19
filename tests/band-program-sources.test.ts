import { describe, expect, it } from "vitest";

import {
  bandProgramSources,
  calendarFeedDisplayName
} from "../lib/domain/band-program-sources";

describe("Band of Warriors source catalog", () => {
  it("documents every real read path without embedding private calendar credentials", () => {
    expect(bandProgramSources.map((source) => source.id)).toEqual([
      "cuttime_calendar",
      "weekly_sheet",
      "band_announcements",
      "parent_portal"
    ]);
    expect(bandProgramSources.find((source) => source.id === "weekly_sheet")?.url)
      .toContain("drive.google.com/drive/folders/");
    expect(bandProgramSources.find((source) => source.id === "band_announcements"))
      .toMatchObject({ connection: "reviewed_oauth_required", access: "read_only" });
    expect(JSON.stringify(bandProgramSources)).not.toContain("/program/calendar/");
  });

  it("uses trusted source labels derived from the approved calendar host", () => {
    expect(calendarFeedDisplayName("https://app.gocuttime.com/program/calendar/example/ics"))
      .toBe("Band of Warriors · CutTime calendar");
    expect(calendarFeedDisplayName("https://calendar.band.us/export/example.ics"))
      .toBe("BAND app calendar");
  });
});
