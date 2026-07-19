import {
  OfficialSchoolCalendarAdapter,
  normalizeOfficialSchoolUrl,
  type OfficialSchoolCalendarEvent
} from "../source/official-school-calendar";
import {
  OfficialSupplyListAdapter,
  type OfficialSupplyList
} from "../source/official-school-supplies";
import type {
  SchoolSourceConnectionRecord,
  SchoolSourceProvider,
  SchoolSourceStore
} from "../storage/school-source-store";
import type { SessionRecord } from "../storage/session-store";

interface CalendarReader {
  sync(input: { schoolUrl: string; districtCalendarUrl: string }): Promise<{
    provider: "school_calendar";
    events: OfficialSchoolCalendarEvent[];
    sourceEvidence: Array<{ kind: "school_events" | "published_calendar"; title: string; url: string }>;
  }>;
}

interface SupplyReader {
  sync(sourceUrl: string): Promise<OfficialSupplyList>;
}

export class OfficialSchoolConnectionError extends Error {
  readonly code:
    | "SCHOOL_SOURCE_SCOPE_MISMATCH"
    | "SCHOOL_SOURCE_NOT_CONNECTED"
    | "SCHOOL_SOURCE_UNAVAILABLE";

  constructor(code: OfficialSchoolConnectionError["code"], message: string) {
    super(message);
    this.name = "OfficialSchoolConnectionError";
    this.code = code;
  }
}

function assertGuardian(session: SessionRecord) {
  if (session.role !== "guardian") {
    throw new OfficialSchoolConnectionError(
      "SCHOOL_SOURCE_SCOPE_MISMATCH",
      "Only Emily's guardian can manage official school sources."
    );
  }
}

function idFor(provider: SchoolSourceProvider, randomUUID?: () => string): string {
  const value = (randomUUID?.() ?? crypto.randomUUID()).replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 24);
  return `school_${provider === "school_calendar" ? "calendar" : "supplies"}_${value}`;
}

function connection(input: {
  existing?: SchoolSourceConnectionRecord;
  studentId: string;
  provider: SchoolSourceProvider;
  displayName: string;
  sourceUrl: string;
  secondarySourceUrl?: string | null;
  now: Date;
  randomUUID?: () => string;
}): SchoolSourceConnectionRecord {
  return {
    id: input.existing?.id ?? idFor(input.provider, input.randomUUID),
    studentId: input.existing?.studentId ?? input.studentId,
    provider: input.provider,
    status: "active",
    displayName: input.displayName.slice(0, 100),
    sourceUrl: input.sourceUrl,
    secondarySourceUrl: input.secondarySourceUrl ?? null,
    lastSyncAt: input.now.toISOString(),
    lastErrorCode: null,
    createdAt: input.existing?.createdAt ?? input.now.toISOString(),
    updatedAt: input.now.toISOString()
  };
}

export async function connectOfficialSchoolCalendar(input: {
  session: SessionRecord;
  store: Pick<SchoolSourceStore, "findConnections" | "saveCalendarConnection">;
  schoolUrl: string;
  districtCalendarUrl: string;
  calendar?: CalendarReader;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertGuardian(input.session);
  const studentId = input.session.studentId ?? input.session.actorId;
  const schoolUrl = normalizeOfficialSchoolUrl(input.schoolUrl);
  const districtCalendarUrl = normalizeOfficialSchoolUrl(input.districtCalendarUrl);
  const snapshot = await (input.calendar ?? new OfficialSchoolCalendarAdapter()).sync({
    schoolUrl,
    districtCalendarUrl
  });
  const existing = (await input.store.findConnections(studentId, "school_calendar"))[0];
  const record = connection({
    existing,
    studentId,
    provider: "school_calendar",
    displayName: "Pieper High School + Comal ISD",
    sourceUrl: schoolUrl,
    secondarySourceUrl: districtCalendarUrl,
    now: (input.now ?? (() => new Date()))(),
    randomUUID: input.randomUUID
  });
  await input.store.saveCalendarConnection({ connection: record, events: snapshot.events });
  return { connected: true as const, provider: "school_calendar" as const, eventCount: snapshot.events.length, lastSyncAt: record.lastSyncAt };
}

export async function connectOfficialSupplyList(input: {
  session: SessionRecord;
  store: Pick<SchoolSourceStore, "findConnections" | "saveSupplyConnection">;
  sourceUrl: string;
  supplies?: SupplyReader;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertGuardian(input.session);
  const studentId = input.session.studentId ?? input.session.actorId;
  const sourceUrl = normalizeOfficialSchoolUrl(input.sourceUrl);
  const list = await (input.supplies ?? new OfficialSupplyListAdapter()).sync(sourceUrl);
  const existing = (await input.store.findConnections(studentId, "school_supplies"))
    .find((candidate) => candidate.sourceUrl === sourceUrl);
  const record = connection({
    existing,
    studentId,
    provider: "school_supplies",
    displayName: list.title,
    sourceUrl,
    now: (input.now ?? (() => new Date()))(),
    randomUUID: input.randomUUID
  });
  await input.store.saveSupplyConnection({ connection: record, list });
  return { connected: true as const, provider: "school_supplies" as const, listCount: 1, itemCount: list.items.length, lastSyncAt: record.lastSyncAt };
}

export async function syncOfficialSchoolSources(input: {
  session: SessionRecord;
  provider: SchoolSourceProvider;
  store: Pick<SchoolSourceStore, "findConnections" | "saveCalendarConnection" | "saveSupplyConnection">;
  calendar?: CalendarReader;
  supplies?: SupplyReader;
  now?: () => Date;
}) {
  assertGuardian(input.session);
  const studentId = input.session.studentId ?? input.session.actorId;
  const connections = (await input.store.findConnections(studentId, input.provider))
    .filter((item) => item.status === "active");
  if (connections.length === 0) {
    throw new OfficialSchoolConnectionError("SCHOOL_SOURCE_NOT_CONNECTED", "This official school source is not connected.");
  }
  const now = (input.now ?? (() => new Date()))();
  let recordCount = 0;
  for (const current of connections) {
    const updated = { ...current, lastSyncAt: now.toISOString(), lastErrorCode: null, updatedAt: now.toISOString() };
    if (current.provider === "school_calendar") {
      const snapshot = await (input.calendar ?? new OfficialSchoolCalendarAdapter()).sync({
        schoolUrl: current.sourceUrl,
        districtCalendarUrl: current.secondarySourceUrl ?? ""
      });
      recordCount += snapshot.events.length;
      await input.store.saveCalendarConnection({ connection: updated, events: snapshot.events });
    } else {
      const list = await (input.supplies ?? new OfficialSupplyListAdapter()).sync(current.sourceUrl);
      recordCount += list.items.length;
      await input.store.saveSupplyConnection({ connection: updated, list });
    }
  }
  return { synced: true as const, provider: input.provider, recordCount };
}
