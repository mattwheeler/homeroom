import { describe, expect, it, vi } from "vitest";

import {
  BandCalendarAdapter,
  normalizeCalendarFeedUrl
} from "../lib/source/band-calendar";

const calendar = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//BAND//Calendar//EN\r
BEGIN:VEVENT\r
UID:band-camp-day-1\r
DTSTAMP:20260718T120000Z\r
LAST-MODIFIED:20260718T130000Z\r
DTSTART:20260803T130000Z\r
DTEND:20260803T210000Z\r
SUMMARY:Band Camp - Day 1\r
LOCATION:High School Band Hall\r
DESCRIPTION:Bring water and your instrument.\r
STATUS:CONFIRMED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:uniform-fitting\r
DTSTART;VALUE=DATE:20260730\r
DTEND;VALUE=DATE:20260731\r
SUMMARY:Uniform fitting deadline\r
END:VEVENT\r
END:VCALENDAR\r
`;

describe("read-only BAND iCalendar source adapter", () => {
  it("accepts BAND's exported HTTPS or webcal subscription and rejects unsafe URLs", () => {
    expect(normalizeCalendarFeedUrl("webcal://calendar.band.us/export/private-token.ics"))
      .toBe("https://calendar.band.us/export/private-token.ics");
    expect(() => normalizeCalendarFeedUrl("http://calendar.band.us/feed.ics")).toThrow(/https/i);
    expect(() => normalizeCalendarFeedUrl("https://user:pass@calendar.band.us/feed.ics")).toThrow(/credentials/i);
    expect(() => normalizeCalendarFeedUrl("https://127.0.0.1/feed.ics")).toThrow(/approved/i);
    expect(() => normalizeCalendarFeedUrl("https://attacker.example/feed.ics")).toThrow(/approved/i);
    expect(() => normalizeCalendarFeedUrl("https://calendar.band.us:8443/feed.ics")).toThrow(/approved/i);
    expect(() => normalizeCalendarFeedUrl("not a url")).toThrow(/valid/i);
    expect(normalizeCalendarFeedUrl("/next.ics#private", "https://calendar.band.us/export/start.ics"))
      .toBe("https://calendar.band.us/next.ics");
  });

  it("fetches without forwarding credentials and normalizes bounded BAND events", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(calendar, {
      status: 200,
      headers: { "content-type": "text/calendar; charset=utf-8" }
    }));

    const result = await new BandCalendarAdapter({ fetcher }).sync(
      "https://calendar.band.us/export/private-token.ics"
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://calendar.band.us/export/private-token.ics",
      expect.objectContaining({ method: "GET", redirect: "manual" })
    );
    expect(result.events).toEqual([
      expect.objectContaining({
        uid: "uniform-fitting",
        startsAt: "2026-07-30",
        endsAt: "2026-07-31",
        allDay: true
      }),
      expect.objectContaining({
        uid: "band-camp-day-1",
        title: "Band Camp - Day 1",
        startsAt: "2026-08-03T13:00:00.000Z",
        endsAt: "2026-08-03T21:00:00.000Z",
        allDay: false,
        location: "High School Band Hall",
        status: "CONFIRMED"
      })
    ]);
    expect(result.feedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("revalidates redirects and enforces response size and calendar content", async () => {
    const redirected = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/private" }
      }))
    });
    await expect(redirected.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/approved/i);

    const oversized = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("x", {
        headers: { "content-type": "text/calendar", "content-length": "2000000" }
      }))
    });
    await expect(oversized.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/too large/i);

    const html = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("<html>login</html>", {
        headers: { "content-type": "text/html" }
      }))
    });
    await expect(html.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/calendar/i);

    const missingLocation = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 302 }))
    });
    await expect(missingLocation.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/redirect/i);

    const failed = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("denied", { status: 403 }))
    });
    await expect(failed.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/could not be read/i);

    const redirectLoop = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: "/again.ics" }
      }))
    });
    await expect(redirectLoop.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/too many/i);
  });

  it("accepts calendar content without a declared type and rejects malformed events", async () => {
    const noContentType = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response(calendar))
    });
    await expect(noContentType.sync("https://calendar.band.us/export/token.ics"))
      .resolves.toMatchObject({ provider: "band_ical" });

    const malformed = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR", {
        headers: { "content-type": "text/calendar" }
      }))
    });
    await expect(malformed.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/missing required|could not be parsed/i);

    const notCalendar = new BandCalendarAdapter({
      fetcher: vi.fn().mockResolvedValue(new Response("plain text", {
        headers: { "content-type": "text/plain" }
      }))
    });
    await expect(notCalendar.sync("https://calendar.band.us/export/token.ics"))
      .rejects.toThrow(/iCalendar/i);
  });
});
