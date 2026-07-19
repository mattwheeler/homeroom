import ICAL from "ical.js";

const MAX_CALENDAR_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface BandCalendarEvent {
  provider: "band_ical";
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  status: string | null;
  sourceUpdatedAt: string | null;
}

export class BandCalendarSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BandCalendarSourceError";
  }
}

function approvedCalendarHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "band.us" || value.endsWith(".band.us") ||
    value === "gocuttime.com" || value.endsWith(".gocuttime.com");
}

export function normalizeCalendarFeedUrl(value: string, base?: string): string {
  const webcal = value.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = base ? new URL(webcal, base) : new URL(webcal);
  } catch {
    throw new BandCalendarSourceError("Enter a valid CutTime or BAND calendar URL.");
  }
  if (url.protocol !== "https:") throw new BandCalendarSourceError("Calendar feeds must use HTTPS.");
  if (url.username || url.password) throw new BandCalendarSourceError("Calendar URLs cannot contain credentials.");
  if ((url.port && url.port !== "443") || !approvedCalendarHost(url.hostname)) {
    throw new BandCalendarSourceError("The calendar URL is not from an approved CutTime or BAND host.");
  }
  url.hash = "";
  return url.toString();
}

function bounded(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function dateValue(time: ICAL.Time | null | undefined): string | null {
  if (!time) return null;
  return time.isDate ? time.toString().slice(0, 10) : time.toJSDate().toISOString();
}

function parseCalendar(text: string): BandCalendarEvent[] {
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new BandCalendarSourceError("The calendar source did not return an iCalendar feed.");
  }
  try {
    const component = new ICAL.Component(ICAL.parse(text));
    const events = component.getAllSubcomponents("vevent").map((item) => {
      const event = new ICAL.Event(item);
      const uid = bounded(event.uid, 512);
      const title = bounded(event.summary, 1_000);
      const startsAt = dateValue(event.startDate);
      if (!uid || !title || !startsAt) {
        throw new BandCalendarSourceError("A calendar event is missing required fields.");
      }
      const lastModifiedValue = item.getFirstPropertyValue("last-modified");
      const lastModified = lastModifiedValue instanceof ICAL.Time ? lastModifiedValue : null;
      return {
        provider: "band_ical" as const,
        uid,
        title,
        description: bounded(event.description, 10_000),
        location: bounded(event.location, 1_000),
        startsAt,
        endsAt: dateValue(event.endDate),
        allDay: event.startDate.isDate,
        status: bounded(item.getFirstPropertyValue("status"), 64),
        sourceUpdatedAt: dateValue(lastModified)
      };
    });
    return events
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .slice(-500);
  } catch (error) {
    if (error instanceof BandCalendarSourceError) throw error;
    throw new BandCalendarSourceError("The iCalendar feed could not be parsed.");
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class BandCalendarAdapter {
  private readonly fetcher: typeof fetch;

  constructor(input: { fetcher?: typeof fetch } = {}) {
    this.fetcher = input.fetcher ?? fetch;
  }

  private async fetchCalendar(sourceUrl: string): Promise<string> {
    let current = normalizeCalendarFeedUrl(sourceUrl);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const response = await this.fetcher(current, {
        method: "GET",
        headers: { Accept: "text/calendar, text/plain;q=0.8" },
        redirect: "manual"
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new BandCalendarSourceError("The calendar redirect is invalid.");
        current = normalizeCalendarFeedUrl(location, current);
        continue;
      }
      if (!response.ok) throw new BandCalendarSourceError("The calendar could not be read.");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_CALENDAR_BYTES) {
        throw new BandCalendarSourceError("The calendar feed is too large.");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        contentType &&
        !contentType.includes("text/calendar") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/octet-stream")
      ) {
        throw new BandCalendarSourceError("The source did not return calendar content.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_CALENDAR_BYTES) throw new BandCalendarSourceError("The calendar feed is too large.");
      return new TextDecoder().decode(bytes);
    }
    throw new BandCalendarSourceError("The calendar redirected too many times.");
  }

  async sync(sourceUrl: string): Promise<{
    provider: "band_ical";
    events: BandCalendarEvent[];
    feedHash: string;
    evidenceIds: string[];
  }> {
    const text = await this.fetchCalendar(sourceUrl);
    const events = parseCalendar(text);
    return {
      provider: "band_ical",
      events,
      feedHash: await sha256(text),
      evidenceIds: events.map((event) => event.uid)
    };
  }
}
