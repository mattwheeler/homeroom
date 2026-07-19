import { describe, expect, it, vi } from "vitest";

import {
  OfficialSchoolCalendarAdapter,
  OfficialSchoolSourceError,
  normalizeOfficialSchoolUrl
} from "../lib/source/official-school-calendar";
import {
  OfficialSupplyListAdapter,
  parseOfficialSupplyList
} from "../lib/source/official-school-supplies";

const schoolHtml = `<!doctype html>
<html><body>
  <article class="item bg-color-light" aria-label="First Day of School">
    <time class="item-date" datetime="2026-08-25"></time>
    <h3 class="item-name"><a href="/apps/events/2026/8/25/First-Day-of-School">First Day of School</a></h3>
  </article>
  <article class="item bg-color-light" aria-label="Registration Day">
    <time class="item-date" datetime="2026-08-01T09:00:00-05:00"></time>
    <h3 class="item-name"><a href="https://phs.comalisd.org/apps/events/registration">Registration Day</a></h3>
  </article>
</body></html>`;

const districtHtml = `<a href="https://4.files.edl.io/199f/03/02/26/145659-a9e152a0-c78a-4cea-9ebb-60b4b5e73f79.pdf">2026-27 Academic Calendar</a>`;

const supplyHtml = `<!doctype html><html><body>
  <h1>Algebra 1 Supply List</h1>
  <nav><div class="placeholder-tinymce-text">Home</div></nav>
  <div class="page-block page-block-text">
    <div class="placeholder-tinymce-text"><em>- One of the following:</em></div>
    <div class="placeholder-tinymce-text">Individual Notebook with roughly 100 pages</div>
    <div class="placeholder-tinymce-text">OR</div>
    <div class="placeholder-tinymce-text">Binder with Algebra 1/2 section</div>
    <div class="placeholder-tinymce-text">- Pencils</div>
    <div class="placeholder-tinymce-text">- Must bring Chromebook charged everyday</div>
  </div>
</body></html>`;

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

describe("official district and school calendar ingestion", () => {
  it("uses navigation-compatible headers required by Edlio's Cloudflare edge", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return htmlResponse(String(url).includes("phs") ? schoolHtml : districtHtml);
    }) as typeof fetch;

    await new OfficialSchoolCalendarAdapter({ fetcher }).sync({
      schoolUrl: "https://phs.comalisd.org/",
      districtCalendarUrl: "https://www.comalisd.org/apps/pages/calendars"
    });

    for (const request of requests) {
      const headers = new Headers(request.headers);
      expect(headers.get("user-agent")).toMatch(/Mozilla\/5\.0/);
      expect(headers.get("accept-language")).toContain("en-US");
      expect(headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("accepts only HTTPS Comal ISD pages and rejects credentialed or unrelated URLs", () => {
    expect(normalizeOfficialSchoolUrl("https://phs.comalisd.org/")).toBe("https://phs.comalisd.org/");
    expect(() => normalizeOfficialSchoolUrl("http://phs.comalisd.org/")).toThrow(OfficialSchoolSourceError);
    expect(() => normalizeOfficialSchoolUrl("https://user:pass@phs.comalisd.org/")).toThrow(OfficialSchoolSourceError);
    expect(() => normalizeOfficialSchoolUrl("https://attacker.example/?next=phs.comalisd.org")).toThrow(OfficialSchoolSourceError);
  });

  it("combines structured Pieper events with the verified published district calendar and keeps evidence URLs", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value === "https://phs.comalisd.org/") return htmlResponse(schoolHtml);
      if (value === "https://www.comalisd.org/apps/pages/calendars") return htmlResponse(districtHtml);
      return htmlResponse("not found", 404);
    }) as typeof fetch;
    const snapshot = await new OfficialSchoolCalendarAdapter({ fetcher }).sync({
      schoolUrl: "https://phs.comalisd.org/",
      districtCalendarUrl: "https://www.comalisd.org/apps/pages/calendars"
    });

    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "First Day of School",
        category: "school_event",
        startsAt: "2026-08-25",
        sourceUrl: expect.stringContaining("phs.comalisd.org/apps/events")
      }),
      expect.objectContaining({
        title: "Labor Day",
        category: "school_closed",
        startsAt: "2026-09-07",
        sourceUrl: "https://4.files.edl.io/199f/03/02/26/145659-a9e152a0-c78a-4cea-9ebb-60b4b5e73f79.pdf"
      }),
      expect.objectContaining({
        title: expect.stringContaining("Early Release"),
        category: "early_release"
      })
    ]));
    expect(snapshot.sourceEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "school_events", url: "https://phs.comalisd.org/" }),
      expect.objectContaining({ kind: "published_calendar", url: expect.stringMatching(/\.pdf$/) })
    ]));
  });

  it("fails closed when the district page no longer proves the configured published calendar", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      htmlResponse(String(url).includes("phs") ? schoolHtml : "<p>No current calendar link</p>")
    ) as typeof fetch;
    await expect(new OfficialSchoolCalendarAdapter({ fetcher }).sync({
      schoolUrl: "https://phs.comalisd.org/",
      districtCalendarUrl: "https://www.comalisd.org/apps/pages/calendars"
    })).rejects.toThrow("published calendar");
  });
});

describe("source-backed school supply ingestion", () => {
  it("uses navigation-compatible headers required by Edlio's Cloudflare edge", async () => {
    let request: RequestInit | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return htmlResponse(supplyHtml);
    }) as typeof fetch;

    await new OfficialSupplyListAdapter({ fetcher }).sync(
      "https://phs.comalisd.org/apps/pages/algebra-supplies"
    );

    const headers = new Headers(request?.headers);
    expect(headers.get("user-agent")).toMatch(/Mozilla\/5\.0/);
    expect(headers.get("accept-language")).toContain("en-US");
    expect(headers.get("cache-control")).toBe("no-cache");
  });

  it("extracts only official content-block lines without inventing quantities or nav text", () => {
    const result = parseOfficialSupplyList(supplyHtml, "https://phs.comalisd.org/apps/pages/algebra-supplies");

    expect(result.title).toBe("Algebra 1 Supply List");
    expect(result.items.map((item) => ({ text: item.text, kind: item.kind }))).toEqual([
      { text: "One of the following:", kind: "group_label" },
      { text: "Individual Notebook with roughly 100 pages", kind: "item" },
      { text: "OR", kind: "separator" },
      { text: "Binder with Algebra 1/2 section", kind: "item" },
      { text: "Pencils", kind: "item" },
      { text: "Must bring Chromebook charged everyday", kind: "item" }
    ]);
    expect(result.items.every((item) => item.quantity === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Home");
    expect(result.sourceUrl).toBe("https://phs.comalisd.org/apps/pages/algebra-supplies");
  });

  it("revalidates official redirects and enforces HTML response and payload bounds", async () => {
    const redirected = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("start")) {
        return new Response(null, { status: 302, headers: { location: "https://phs.comalisd.org/apps/pages/algebra-supplies" } });
      }
      return htmlResponse(supplyHtml);
    }) as typeof fetch;
    await expect(new OfficialSupplyListAdapter({ fetcher: redirected }).sync(
      "https://phs.comalisd.org/start"
    )).resolves.toMatchObject({ title: "Algebra 1 Supply List", items: { length: 6 } });

    const offDomain = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/list" }
    })) as typeof fetch;
    await expect(new OfficialSupplyListAdapter({ fetcher: offDomain }).sync(
      "https://phs.comalisd.org/start"
    )).rejects.toThrow("official Comal ISD");
  });
});
