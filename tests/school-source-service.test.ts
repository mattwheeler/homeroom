import { describe, expect, it, vi } from "vitest";

import {
  connectOfficialSchoolCalendar,
  connectOfficialSupplyList,
  syncOfficialSchoolSources
} from "../lib/domain/official-school-sources";
import type { OfficialSchoolCalendarEvent } from "../lib/source/official-school-calendar";
import type { OfficialSupplyList } from "../lib/source/official-school-supplies";
import type {
  SchoolSourceConnectionRecord,
  SchoolSourceProvider
} from "../lib/storage/school-source-store";
import type { SessionRecord } from "../lib/storage/session-store";

const guardianSession: SessionRecord = {
  id: "session_guardian",
  fixtureKey: "emily_band_camp_v1",
  actorId: "guardian_matt",
  role: "guardian",
  state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "hash",
  expiresAt: "2026-07-19T20:00:00.000Z",
  createdAt: "2026-07-19T18:00:00.000Z",
  updatedAt: "2026-07-19T18:00:00.000Z"
};

const calendarEvent: OfficialSchoolCalendarEvent = {
  provider: "school_calendar",
  uid: "district-labor-day",
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
};

const supplyList: OfficialSupplyList = {
  provider: "school_supplies",
  title: "Algebra 1 Supply List",
  sourceUrl: "https://phs.comalisd.org/apps/pages/algebra-supplies",
  sourceTitle: "Algebra 1 Supply List",
  items: [{ id: "supply-pencil", text: "Pencils", quantity: null, sourceOrdinal: 1, kind: "item" }]
};

class MemorySchoolStore {
  connections: SchoolSourceConnectionRecord[] = [];
  calendarWrites: unknown[] = [];
  supplyWrites: unknown[] = [];

  async findConnections(_studentId: string, provider?: SchoolSourceProvider) {
    return provider ? this.connections.filter((item) => item.provider === provider) : this.connections;
  }
  async saveCalendarConnection(write: { connection: SchoolSourceConnectionRecord }) {
    this.connections = this.connections.filter((item) => item.id !== write.connection.id);
    this.connections.push(write.connection);
    this.calendarWrites.push(write);
  }
  async saveSupplyConnection(write: { connection: SchoolSourceConnectionRecord }) {
    this.connections = this.connections.filter((item) => item.id !== write.connection.id);
    this.connections.push(write.connection);
    this.supplyWrites.push(write);
  }
}

describe("guardian-managed official school sources", () => {
  it("connects a calendar and persists only attributed records", async () => {
    const store = new MemorySchoolStore();
    const sync = vi.fn().mockResolvedValue({
      provider: "school_calendar",
      events: [calendarEvent],
      sourceEvidence: [
        { kind: "school_events", title: "Pieper High School events", url: "https://phs.comalisd.org/" },
        { kind: "published_calendar", title: "Comal calendar", url: calendarEvent.sourceUrl }
      ]
    });

    const result = await connectOfficialSchoolCalendar({
      session: guardianSession,
      store,
      schoolUrl: "https://phs.comalisd.org/",
      districtCalendarUrl: "https://www.comalisd.org/apps/pages/calendars",
      calendar: { sync },
      now: () => new Date("2026-07-19T18:00:00.000Z"),
      randomUUID: () => "11111111-2222-4333-8444-555555555555"
    });

    expect(result).toMatchObject({ connected: true, provider: "school_calendar", eventCount: 1 });
    expect(store.calendarWrites).toEqual([
      expect.objectContaining({ events: [expect.objectContaining({ sourceUrl: calendarEvent.sourceUrl })] })
    ]);
    expect(store.connections[0]).toMatchObject({ status: "active", displayName: "Pieper High School + Comal ISD" });
  });

  it("supports multiple official supply lists without inventing a list or quantity", async () => {
    const store = new MemorySchoolStore();
    const sync = vi.fn().mockResolvedValue(supplyList);

    await connectOfficialSupplyList({
      session: guardianSession,
      store,
      sourceUrl: supplyList.sourceUrl,
      supplies: { sync },
      now: () => new Date("2026-07-19T18:00:00.000Z"),
      randomUUID: () => "22222222-2222-4333-8444-555555555555"
    });
    await connectOfficialSupplyList({
      session: guardianSession,
      store,
      sourceUrl: "https://phs.comalisd.org/apps/pages/biology-supplies",
      supplies: { sync: vi.fn().mockResolvedValue({ ...supplyList, title: "Biology Supply List", sourceUrl: "https://phs.comalisd.org/apps/pages/biology-supplies" }) },
      randomUUID: () => "33333333-2222-4333-8444-555555555555"
    });

    expect(store.connections.filter((item) => item.provider === "school_supplies")).toHaveLength(2);
    expect(store.supplyWrites).toHaveLength(2);
    expect(JSON.stringify(store.supplyWrites)).not.toContain("recommended calculator");
    expect(supplyList.items[0]?.quantity).toBeNull();
  });

  it("refreshes all connected lists and rejects student source management", async () => {
    const store = new MemorySchoolStore();
    await connectOfficialSupplyList({
      session: guardianSession,
      store,
      sourceUrl: supplyList.sourceUrl,
      supplies: { sync: vi.fn().mockResolvedValue(supplyList) },
      randomUUID: () => "44444444-2222-4333-8444-555555555555"
    });
    const refresh = vi.fn().mockResolvedValue(supplyList);
    await expect(syncOfficialSchoolSources({
      session: guardianSession,
      provider: "school_supplies",
      store,
      supplies: { sync: refresh },
      calendar: { sync: vi.fn() }
    })).resolves.toMatchObject({ synced: true, recordCount: 1 });
    expect(refresh).toHaveBeenCalledWith(supplyList.sourceUrl);

    await expect(connectOfficialSupplyList({
      session: { ...guardianSession, role: "student", actorId: "student_emily" },
      store,
      sourceUrl: supplyList.sourceUrl,
      supplies: { sync: refresh }
    })).rejects.toMatchObject({ code: "SCHOOL_SOURCE_SCOPE_MISMATCH" });
  });
});
