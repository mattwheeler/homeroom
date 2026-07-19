import { describe, expect, it } from "vitest";

import type { OfficialSchoolCalendarEvent } from "../lib/source/official-school-calendar";
import type { OfficialSupplyList } from "../lib/source/official-school-supplies";
import {
  D1SchoolSourceStore,
  SchoolSourceStoreError,
  type SchoolSourceConnectionRecord
} from "../lib/storage/school-source-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

function fakeDatabase(input: {
  firstRows?: Array<Record<string, unknown> | null>;
  batchResult?: (statements: D1BoundStatementLike[]) => D1RunResult[];
  withBatch?: boolean;
} = {}) {
  const firstRows = [...(input.firstRows ?? [])];
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const batches: D1BoundStatementLike[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes: 1 } }; },
            async first<T>() { return (firstRows.shift() ?? null) as T | null; }
          };
        }
      };
    }
  };
  if (input.withBatch !== false) {
    database.batch = async (statements) => {
      batches.push(statements);
      return input.batchResult?.(statements)
        ?? statements.map(() => ({ success: true, meta: { changes: 1 } }));
    };
  }
  return { database, calls, batches };
}

const calendarConnection: SchoolSourceConnectionRecord = {
  id: "school_calendar_student_emily",
  studentId: "student_emily",
  provider: "school_calendar",
  status: "active",
  displayName: "Comal ISD official calendar",
  sourceUrl: "https://www.comalisd.org/apps/pages/calendars",
  secondarySourceUrl: "https://phs.comalisd.org/",
  lastSyncAt: "2026-07-19T12:00:00.000Z",
  lastErrorCode: null,
  createdAt: "2026-07-19T12:00:00.000Z",
  updatedAt: "2026-07-19T12:00:00.000Z"
};

const events: OfficialSchoolCalendarEvent[] = [{
  provider: "school_calendar",
  uid: "district-first-day",
  title: "First Day of School",
  description: null,
  location: null,
  startsAt: "2026-08-25",
  endsAt: null,
  allDay: true,
  category: "school_event",
  audience: "all_students",
  sourceUrl: "https://4.files.edl.io/calendar.pdf",
  sourceTitle: "Comal ISD 2026–27 Academic Calendar",
  sourceUpdatedAt: "2026-03-02"
}];

const supplyConnection: SchoolSourceConnectionRecord = {
  ...calendarConnection,
  id: "school_supplies_student_emily_algebra",
  provider: "school_supplies",
  displayName: "Algebra I Supply List",
  sourceUrl: "https://phs.comalisd.org/apps/pages/algebra-supplies",
  secondarySourceUrl: null
};

const supplyList: OfficialSupplyList = {
  provider: "school_supplies",
  title: "Algebra I Supply List",
  sourceUrl: supplyConnection.sourceUrl,
  sourceTitle: "Algebra I Supply List",
  items: [
    { id: "notebook", text: "Composition notebook", quantity: null, sourceOrdinal: 1, kind: "item" },
    { id: "pencils", text: "Pencils", quantity: 2, sourceOrdinal: 2, kind: "item" }
  ]
};

describe("D1 official school source store", () => {
  it("finds connections with and without a provider filter using bound parameters", async () => {
    const row = {
      id: calendarConnection.id,
      student_id: calendarConnection.studentId,
      provider: calendarConnection.provider,
      status: calendarConnection.status,
      display_name: calendarConnection.displayName,
      source_url: calendarConnection.sourceUrl,
      secondary_source_url: calendarConnection.secondarySourceUrl,
      last_sync_at: calendarConnection.lastSyncAt,
      last_error_code: calendarConnection.lastErrorCode,
      created_at: calendarConnection.createdAt,
      updated_at: calendarConnection.updatedAt
    };
    const { database, calls } = fakeDatabase({
      firstRows: [{ records_json: JSON.stringify([row]) }, { records_json: "[]" }]
    });
    const store = new D1SchoolSourceStore(database);

    await expect(store.findConnections("student_emily", "school_calendar")).resolves.toEqual([calendarConnection]);
    await expect(store.findConnections("student_emily")).resolves.toEqual([]);
    expect(calls[0]?.values).toEqual(["student_emily", "school_calendar", "school_calendar"]);
    expect(calls[1]?.values).toEqual(["student_emily", null, null]);
  });

  it("atomically replaces attributed calendar and supply snapshots", async () => {
    const { database, calls, batches } = fakeDatabase();
    const store = new D1SchoolSourceStore(database);

    await store.saveCalendarConnection({ connection: calendarConnection, events });
    await store.saveSupplyConnection({ connection: supplyConnection, list: supplyList });

    expect(batches).toHaveLength(2);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO school_source_connections"),
      expect.stringContaining("DELETE FROM school_calendar_events"),
      expect.stringContaining("INSERT INTO school_calendar_events"),
      expect.stringContaining("DELETE FROM school_supply_items"),
      expect.stringContaining("INSERT INTO school_supply_lists"),
      expect.stringContaining("INSERT INTO school_supply_items")
    ]));
    expect(JSON.stringify(calls)).toContain("Comal ISD 2026–27 Academic Calendar");
    expect(JSON.stringify(calls)).toContain("Composition notebook");
  });

  it("reconstructs public snapshots and preserves source attribution", async () => {
    const publicConnection = {
      id: calendarConnection.id,
      provider: calendarConnection.provider,
      status: calendarConnection.status,
      displayName: calendarConnection.displayName,
      sourceUrl: calendarConnection.sourceUrl,
      lastSyncAt: calendarConnection.lastSyncAt,
      lastErrorCode: null
    };
    const { database } = fakeDatabase({ firstRows: [
      { records_json: JSON.stringify([publicConnection]) },
      { records_json: JSON.stringify(events) },
      { records_json: JSON.stringify([{ id: "list_1", title: supplyList.title, sourceUrl: supplyList.sourceUrl, sourceTitle: supplyList.sourceTitle }]) },
      { records_json: JSON.stringify(supplyList.items.map((item) => ({ ...item, listId: "list_1" }))) }
    ] });

    const result = await new D1SchoolSourceStore(database).getStudentSnapshot("student_emily");
    expect(result.connections).toEqual([publicConnection]);
    expect(result.events).toEqual(events);
    expect(result.supplyLists).toEqual([supplyList]);
  });

  it("fails closed when atomic batch support is missing or a write fails", async () => {
    const missing = fakeDatabase({ withBatch: false }).database;
    await expect(new D1SchoolSourceStore(missing).saveCalendarConnection({
      connection: calendarConnection,
      events
    })).rejects.toBeInstanceOf(SchoolSourceStoreError);

    const failed = fakeDatabase({
      batchResult: (statements) => statements.map((_, index) => ({ success: index !== 1 }))
    }).database;
    await expect(new D1SchoolSourceStore(failed).saveSupplyConnection({
      connection: supplyConnection,
      list: supplyList
    })).rejects.toBeInstanceOf(SchoolSourceStoreError);
  });
});
