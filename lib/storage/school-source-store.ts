import type { OfficialSchoolCalendarEvent } from "../source/official-school-calendar";
import type { OfficialSupplyList } from "../source/official-school-supplies";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "./session-store";

export type SchoolSourceProvider = "school_calendar" | "school_supplies";

export interface SchoolSourceConnectionRecord {
  id: string;
  studentId: string;
  provider: SchoolSourceProvider;
  status: "active" | "error" | "revoked";
  displayName: string;
  sourceUrl: string;
  secondarySourceUrl: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSchoolSourceConnection {
  id: string;
  provider: SchoolSourceProvider;
  status: SchoolSourceConnectionRecord["status"];
  displayName: string;
  sourceUrl: string;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
}

export interface SchoolSourceSnapshot {
  connections: PublicSchoolSourceConnection[];
  events: OfficialSchoolCalendarEvent[];
  supplyLists: OfficialSupplyList[];
}

export interface SchoolSourceStore {
  findConnections(studentId: string, provider?: SchoolSourceProvider): Promise<SchoolSourceConnectionRecord[]>;
  saveCalendarConnection(write: {
    connection: SchoolSourceConnectionRecord;
    events: OfficialSchoolCalendarEvent[];
  }): Promise<void>;
  saveSupplyConnection(write: {
    connection: SchoolSourceConnectionRecord;
    list: OfficialSupplyList;
  }): Promise<void>;
  getStudentSnapshot(studentId: string): Promise<SchoolSourceSnapshot>;
}

interface ConnectionRow {
  id: string;
  student_id: string;
  provider: SchoolSourceProvider;
  status: SchoolSourceConnectionRecord["status"];
  display_name: string;
  source_url: string;
  secondary_source_url: string | null;
  last_sync_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface AggregateRow { records_json: string; }

export class SchoolSourceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchoolSourceStoreError";
  }
}

function connectionFromRow(row: ConnectionRow): SchoolSourceConnectionRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    provider: row.provider,
    status: row.status,
    displayName: row.display_name,
    sourceUrl: row.source_url,
    secondarySourceUrl: row.secondary_source_url,
    lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function connectionStatement(database: D1DatabaseLike, connection: SchoolSourceConnectionRecord): D1BoundStatementLike {
  return database.prepare(
    `INSERT INTO school_source_connections (
      id, student_id, provider, status, display_name, source_url, secondary_source_url,
      last_sync_at, last_error_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      display_name = excluded.display_name,
      source_url = excluded.source_url,
      secondary_source_url = excluded.secondary_source_url,
      last_sync_at = excluded.last_sync_at,
      last_error_code = excluded.last_error_code,
      updated_at = excluded.updated_at`
  ).bind(
    connection.id,
    connection.studentId,
    connection.provider,
    connection.status,
    connection.displayName,
    connection.sourceUrl,
    connection.secondarySourceUrl,
    connection.lastSyncAt,
    connection.lastErrorCode,
    connection.createdAt,
    connection.updatedAt
  );
}

function requireBatch(database: D1DatabaseLike) {
  if (!database.batch) throw new SchoolSourceStoreError("D1 atomic batch support is required for official school sources.");
  return database.batch.bind(database);
}

function assertBatch(results: D1RunResult[], expected: number, message: string) {
  if (results.length !== expected || results.some((result) => !result.success)) {
    throw new SchoolSourceStoreError(message);
  }
}

export class D1SchoolSourceStore implements SchoolSourceStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async findConnections(studentId: string, provider?: SchoolSourceProvider): Promise<SchoolSourceConnectionRecord[]> {
    const row = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'id', id,
        'student_id', student_id,
        'provider', provider,
        'status', status,
        'display_name', display_name,
        'source_url', source_url,
        'secondary_source_url', secondary_source_url,
        'last_sync_at', last_sync_at,
        'last_error_code', last_error_code,
        'created_at', created_at,
        'updated_at', updated_at
      )), '[]') AS records_json
      FROM school_source_connections
      WHERE student_id = ? AND (? IS NULL OR provider = ?)`
    ).bind(studentId, provider ?? null, provider ?? null).first<AggregateRow>();
    const records = JSON.parse(row?.records_json ?? "[]") as ConnectionRow[];
    return records.map(connectionFromRow);
  }

  async saveCalendarConnection(write: {
    connection: SchoolSourceConnectionRecord;
    events: OfficialSchoolCalendarEvent[];
  }): Promise<void> {
    const statements: D1BoundStatementLike[] = [
      connectionStatement(this.database, write.connection),
      this.database.prepare("DELETE FROM school_calendar_events WHERE connection_id = ?")
        .bind(write.connection.id)
    ];
    for (const event of write.events) {
      statements.push(this.database.prepare(
        `INSERT INTO school_calendar_events (
          connection_id, student_id, uid, title, description, location, starts_at,
          ends_at, all_day, category, audience, source_url, source_title,
          source_updated_at, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        write.connection.id,
        write.connection.studentId,
        event.uid,
        event.title,
        event.description,
        event.location,
        event.startsAt,
        event.endsAt,
        Number(event.allDay),
        event.category,
        event.audience,
        event.sourceUrl,
        event.sourceTitle,
        event.sourceUpdatedAt,
        write.connection.lastSyncAt
      ));
    }
    assertBatch(
      await requireBatch(this.database)(statements),
      statements.length,
      "Unable to save the official school calendar snapshot."
    );
  }

  async saveSupplyConnection(write: {
    connection: SchoolSourceConnectionRecord;
    list: OfficialSupplyList;
  }): Promise<void> {
    const listId = `list_${write.connection.id}`;
    const statements: D1BoundStatementLike[] = [
      connectionStatement(this.database, write.connection),
      this.database.prepare("DELETE FROM school_supply_items WHERE list_id = ?").bind(listId),
      this.database.prepare(
        `INSERT INTO school_supply_lists (
          id, connection_id, student_id, title, source_url, source_title, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          title = excluded.title,
          source_url = excluded.source_url,
          source_title = excluded.source_title,
          synced_at = excluded.synced_at`
      ).bind(
        listId,
        write.connection.id,
        write.connection.studentId,
        write.list.title,
        write.list.sourceUrl,
        write.list.sourceTitle,
        write.connection.lastSyncAt
      )
    ];
    for (const item of write.list.items) {
      statements.push(this.database.prepare(
        `INSERT INTO school_supply_items (
          list_id, item_id, text, quantity, source_ordinal, item_kind
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(listId, item.id, item.text, item.quantity, item.sourceOrdinal, item.kind));
    }
    assertBatch(
      await requireBatch(this.database)(statements),
      statements.length,
      "Unable to save the official school supply list."
    );
  }

  async getStudentSnapshot(studentId: string): Promise<SchoolSourceSnapshot> {
    const [connections, events, lists, items] = await Promise.all([
      this.database.prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'id', id, 'provider', provider, 'status', status, 'displayName', display_name,
          'sourceUrl', source_url, 'lastSyncAt', last_sync_at, 'lastErrorCode', last_error_code
        )), '[]') AS records_json FROM school_source_connections WHERE student_id = ?`
      ).bind(studentId).first<AggregateRow>(),
      this.database.prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'provider', 'school_calendar', 'uid', uid, 'title', title, 'description', description,
          'location', location, 'startsAt', starts_at, 'endsAt', ends_at,
          'allDay', CASE WHEN all_day = 1 THEN json('true') ELSE json('false') END,
          'category', category, 'audience', audience, 'sourceUrl', source_url,
          'sourceTitle', source_title, 'sourceUpdatedAt', source_updated_at
        )), '[]') AS records_json FROM school_calendar_events WHERE student_id = ? ORDER BY starts_at`
      ).bind(studentId).first<AggregateRow>(),
      this.database.prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'id', id, 'title', title, 'sourceUrl', source_url, 'sourceTitle', source_title
        )), '[]') AS records_json FROM school_supply_lists WHERE student_id = ? ORDER BY title`
      ).bind(studentId).first<AggregateRow>(),
      this.database.prepare(
        `SELECT COALESCE(json_group_array(json_object(
          'listId', list_id, 'id', item_id, 'text', text, 'quantity', quantity,
          'sourceOrdinal', source_ordinal, 'kind', item_kind
        )), '[]') AS records_json
        FROM school_supply_items WHERE list_id IN (
          SELECT id FROM school_supply_lists WHERE student_id = ?
        ) ORDER BY list_id, source_ordinal`
      ).bind(studentId).first<AggregateRow>()
    ]);
    const rawLists = JSON.parse(lists?.records_json ?? "[]") as Array<{
      id: string; title: string; sourceUrl: string; sourceTitle: string;
    }>;
    const rawItems = JSON.parse(items?.records_json ?? "[]") as Array<{
      listId: string; id: string; text: string; quantity: number | null; sourceOrdinal: number;
      kind: "item" | "group_label" | "separator";
    }>;
    return {
      connections: JSON.parse(connections?.records_json ?? "[]") as PublicSchoolSourceConnection[],
      events: JSON.parse(events?.records_json ?? "[]") as OfficialSchoolCalendarEvent[],
      supplyLists: rawLists.map((list) => ({
        provider: "school_supplies",
        title: list.title,
        sourceUrl: list.sourceUrl,
        sourceTitle: list.sourceTitle,
        items: rawItems
          .filter((item) => item.listId === list.id)
          .map((item) => ({
            id: item.id,
            text: item.text,
            quantity: item.quantity,
            sourceOrdinal: item.sourceOrdinal,
            kind: item.kind
          }))
      }))
    };
  }
}
