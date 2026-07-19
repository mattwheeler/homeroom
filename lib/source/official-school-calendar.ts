const MAX_OFFICIAL_HTML_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function officialSchoolRequestHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 HomeroomSchoolSource/1.0"
  };
}

export const COMAL_2026_27_CALENDAR_PDF =
  "https://4.files.edl.io/199f/03/02/26/145659-a9e152a0-c78a-4cea-9ebb-60b4b5e73f79.pdf";

export type SchoolCalendarCategory =
  | "school_closed"
  | "student_holiday"
  | "early_release"
  | "registration"
  | "school_event";

export interface OfficialSchoolCalendarEvent {
  provider: "school_calendar";
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  category: SchoolCalendarCategory;
  audience: "all_students" | "elementary" | "staff";
  sourceUrl: string;
  sourceTitle: string;
  sourceUpdatedAt: string | null;
}

export interface OfficialSourceEvidence {
  kind: "school_events" | "published_calendar";
  title: string;
  url: string;
}

export class OfficialSchoolSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialSchoolSourceError";
  }
}

function isOfficialComalHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "comalisd.org" || value.endsWith(".comalisd.org");
}

export function normalizeOfficialSchoolUrl(value: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new OfficialSchoolSourceError("Enter a valid official Comal ISD URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !isOfficialComalHost(url.hostname)
  ) {
    throw new OfficialSchoolSourceError("The source must be an official Comal ISD HTTPS page.");
  }
  url.hash = "";
  return url.toString();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"'
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const numeric = code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function categoryFor(title: string): SchoolCalendarCategory {
  const value = title.toLowerCase();
  if (/early release/.test(value)) return "early_release";
  if (/registration|orientation|schedule pickup/.test(value)) return "registration";
  if (/student holiday|staff development|teacher work/.test(value)) return "student_holiday";
  if (/holiday|spring break|thanksgiving|school closed|fair day/.test(value)) return "school_closed";
  return "school_event";
}

function dateValue(value: string): { startsAt: string; allDay: boolean } | null {
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return { startsAt: normalized, allDay: true };
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : { startsAt: parsed.toISOString(), allDay: false };
}

async function parseSchoolEvents(html: string, pageUrl: string): Promise<OfficialSchoolCalendarEvent[]> {
  const events: OfficialSchoolCalendarEvent[] = [];
  for (const match of html.matchAll(/<article\b[^>]*\baria-label=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/article>/gi)) {
    const block = match[3] ?? "";
    const time = /<time\b[^>]*\bdatetime=(?:"([^"]+)"|'([^']+)')/i.exec(block);
    const link = /<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const date = dateValue(time?.[1] ?? time?.[2] ?? "");
    const title = decodeHtml(link?.[3] ?? match[1] ?? match[2] ?? "").slice(0, 300);
    if (!date || !title) continue;
    const sourceUrl = link?.[1] || link?.[2]
      ? normalizeOfficialSchoolUrl(link[1] ?? link[2] ?? "", pageUrl)
      : pageUrl;
    events.push({
      provider: "school_calendar",
      uid: `school-${(await sha256(`${sourceUrl}|${date.startsAt}|${title}`)).slice(0, 32)}`,
      title,
      description: null,
      location: null,
      startsAt: date.startsAt,
      endsAt: null,
      allDay: date.allDay,
      category: categoryFor(title),
      audience: "all_students",
      sourceUrl,
      sourceTitle: "Pieper High School events",
      sourceUpdatedAt: null
    });
  }
  return events;
}

type PublishedEvent = Omit<OfficialSchoolCalendarEvent, "provider" | "uid" | "sourceUrl" | "sourceTitle" | "sourceUpdatedAt">;

const COMAL_2026_27_EVENTS: PublishedEvent[] = [
  { title: "First Day of School", description: null, location: null, startsAt: "2026-08-25", endsAt: null, allDay: true, category: "school_event", audience: "all_students" },
  { title: "Labor Day", description: "District holiday.", location: null, startsAt: "2026-09-07", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Comal County Fair Day", description: "District holiday.", location: null, startsAt: "2026-09-25", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Student Holiday — Staff Development", description: null, location: null, startsAt: "2026-10-12", endsAt: null, allDay: true, category: "student_holiday", audience: "all_students" },
  { title: "Elementary Early Release — Parent/Teacher Conferences", description: "Applies to elementary campuses only.", location: null, startsAt: "2026-10-21", endsAt: "2026-10-22", allDay: true, category: "early_release", audience: "elementary" },
  { title: "Student Holiday — Staff Development", description: null, location: null, startsAt: "2026-11-09", endsAt: null, allDay: true, category: "student_holiday", audience: "all_students" },
  { title: "Thanksgiving Holiday", description: null, location: null, startsAt: "2026-11-23", endsAt: "2026-11-27", allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Winter Break", description: null, location: null, startsAt: "2026-12-21", endsAt: "2027-01-01", allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Student Holiday — Staff Development", description: null, location: null, startsAt: "2027-01-04", endsAt: null, allDay: true, category: "student_holiday", audience: "all_students" },
  { title: "Martin Luther King Jr. Day", description: "District holiday.", location: null, startsAt: "2027-01-18", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Student Holiday — Staff Development", description: null, location: null, startsAt: "2027-02-12", endsAt: null, allDay: true, category: "student_holiday", audience: "all_students" },
  { title: "Presidents Day", description: "District holiday.", location: null, startsAt: "2027-02-15", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Spring Break", description: null, location: null, startsAt: "2027-03-08", endsAt: "2027-03-12", allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Good Friday", description: "District holiday.", location: null, startsAt: "2027-03-26", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Student/Staff Holiday — Bad Weather Makeup", description: null, location: null, startsAt: "2027-03-29", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Student/Staff Holiday — Bad Weather Makeup", description: null, location: null, startsAt: "2027-04-23", endsAt: null, allDay: true, category: "school_closed", audience: "all_students" },
  { title: "Last Day of School", description: null, location: null, startsAt: "2027-05-27", endsAt: null, allDay: true, category: "school_event", audience: "all_students" }
];

async function publishedCalendarEvents(): Promise<OfficialSchoolCalendarEvent[]> {
  return Promise.all(COMAL_2026_27_EVENTS.map(async (event) => ({
    provider: "school_calendar" as const,
    uid: `district-${(await sha256(`${event.startsAt}|${event.title}`)).slice(0, 32)}`,
    ...event,
    sourceUrl: COMAL_2026_27_CALENDAR_PDF,
    sourceTitle: "Comal ISD 2026–27 Academic Calendar",
    sourceUpdatedAt: "2026-03-02"
  })));
}

export class OfficialSchoolCalendarAdapter {
  private readonly fetcher: typeof fetch;

  constructor(input: { fetcher?: typeof fetch } = {}) {
    this.fetcher = input.fetcher ?? fetch;
  }

  private async fetchHtml(rawUrl: string): Promise<{ html: string; url: string }> {
    let current = normalizeOfficialSchoolUrl(rawUrl);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const response = await this.fetcher(current, {
        method: "GET",
        redirect: "manual",
        headers: officialSchoolRequestHeaders()
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new OfficialSchoolSourceError("The official source redirect is invalid.");
        current = normalizeOfficialSchoolUrl(location, current);
        continue;
      }
      if (!response.ok) throw new OfficialSchoolSourceError("The official school source could not be read.");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declared) && declared > MAX_OFFICIAL_HTML_BYTES) {
        throw new OfficialSchoolSourceError("The official school page is too large.");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new OfficialSchoolSourceError("The official source did not return an HTML page.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_OFFICIAL_HTML_BYTES) throw new OfficialSchoolSourceError("The official school page is too large.");
      return { html: new TextDecoder().decode(bytes), url: current };
    }
    throw new OfficialSchoolSourceError("The official school source redirected too many times.");
  }

  async sync(input: { schoolUrl: string; districtCalendarUrl: string }) {
    const [school, district] = await Promise.all([
      this.fetchHtml(input.schoolUrl),
      this.fetchHtml(input.districtCalendarUrl)
    ]);
    if (!district.html.includes(COMAL_2026_27_CALENDAR_PDF)) {
      throw new OfficialSchoolSourceError("The district page no longer proves the configured published calendar.");
    }
    const events = [...await parseSchoolEvents(school.html, school.url), ...await publishedCalendarEvents()];
    const byIdentity = new Map<string, OfficialSchoolCalendarEvent>();
    for (const event of events) {
      const identity = `${event.startsAt}|${event.title.toLowerCase()}`;
      if (!byIdentity.has(identity)) byIdentity.set(identity, event);
    }
    return {
      provider: "school_calendar" as const,
      events: [...byIdentity.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
      sourceEvidence: [
        { kind: "school_events" as const, title: "Pieper High School events", url: school.url },
        { kind: "published_calendar" as const, title: "Comal ISD 2026–27 Academic Calendar", url: COMAL_2026_27_CALENDAR_PDF }
      ]
    };
  }
}
