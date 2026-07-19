import type { BandCalendarEvent } from "../source/band-calendar";
import type {
  ClassroomCourse,
  ClassroomCoursework,
  ClassroomSnapshot
} from "../source/google-classroom";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "./session-store";

export type SourceProvider = "google_classroom" | "band_ical";

export interface SourceOAuthStateRecord {
  id: string;
  stateHash: string;
  sessionId: string;
  provider: "google_classroom";
  expiresAt: string;
  createdAt: string;
}

export interface SourceConnectionRecord {
  id: string;
  studentId: string;
  provider: SourceProvider;
  status: "active" | "error" | "revoked";
  displayName: string;
  secretCiphertext: string;
  scopes: string[];
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSourceConnection {
  provider: SourceProvider;
  status: SourceConnectionRecord["status"];
  displayName: string;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
}

export interface SourceSnapshot {
  connections: PublicSourceConnection[];
  courses: ClassroomCourse[];
  coursework: ClassroomCoursework[];
  events: BandCalendarEvent[];
}

interface OAuthStateRow {
  id: string;
  state_hash: string;
  session_id: string;
  provider: "google_classroom";
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

interface ConnectionRow {
  id: string;
  student_id: string;
  provider: SourceProvider;
  status: SourceConnectionRecord["status"];
  display_name: string;
  secret_ciphertext: string;
  scopes_json: string;
  last_sync_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface AggregateRow { records_json: string; }

export class SourceConnectionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceConnectionStoreError";
  }
}

function assertRun(result: D1RunResult, message: string): void {
  if (!result.success || (result.meta?.changes !== undefined && result.meta.changes !== 1)) {
    throw new SourceConnectionStoreError(message);
  }
}

function batchFor(database: D1DatabaseLike) {
  if (!database.batch) throw new SourceConnectionStoreError("D1 atomic batch support is required for source connections.");
  return database.batch.bind(database);
}

function assertBatch(results: D1RunResult[], expected: number, message: string): void {
  if (results.length !== expected || results.some((result) => !result.success)) {
    throw new SourceConnectionStoreError(message);
  }
}

function parseOAuthState(row: OAuthStateRow): SourceOAuthStateRecord {
  return {
    id: row.id,
    stateHash: row.state_hash,
    sessionId: row.session_id,
    provider: row.provider,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

function parseConnection(row: ConnectionRow): SourceConnectionRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    provider: row.provider,
    status: row.status,
    displayName: row.display_name,
    secretCiphertext: row.secret_ciphertext,
    scopes: JSON.parse(row.scopes_json) as string[],
    lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function connectionStatement(database: D1DatabaseLike, connection: SourceConnectionRecord): D1BoundStatementLike {
  return database.prepare(
    `INSERT INTO source_connections (
      id, student_id, provider, status, display_name, secret_ciphertext,
      scopes_json, last_sync_at, last_error_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, provider) DO UPDATE SET
      status = excluded.status,
      display_name = excluded.display_name,
      secret_ciphertext = excluded.secret_ciphertext,
      scopes_json = excluded.scopes_json,
      last_sync_at = excluded.last_sync_at,
      last_error_code = excluded.last_error_code,
      updated_at = excluded.updated_at`
  ).bind(
    connection.id,
    connection.studentId,
    connection.provider,
    connection.status,
    connection.displayName,
    connection.secretCiphertext,
    JSON.stringify(connection.scopes),
    connection.lastSyncAt,
    connection.lastErrorCode,
    connection.createdAt,
    connection.updatedAt
  );
}

export class D1SourceConnectionStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async createOAuthState(record: SourceOAuthStateRecord): Promise<void> {
    const result = await this.database.prepare(
      `INSERT INTO source_oauth_states (
        id, state_hash, session_id, provider, expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).bind(
      record.id,
      record.stateHash,
      record.sessionId,
      record.provider,
      record.expiresAt,
      record.createdAt
    ).run();
    assertRun(result, "Unable to save the Google authorization challenge.");
  }

  async consumeOAuthState(
    stateHash: string,
    sessionId: string,
    consumedAt: string
  ): Promise<SourceOAuthStateRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, state_hash, session_id, provider, expires_at, consumed_at, created_at
      FROM source_oauth_states
      WHERE state_hash = ? AND session_id = ? AND provider = ?
        AND consumed_at IS NULL AND expires_at > ? LIMIT 1`
    ).bind(stateHash, sessionId, "google_classroom", consumedAt).first<OAuthStateRow>();
    if (!row) return null;
    const result = await this.database.prepare(
      `UPDATE source_oauth_states SET consumed_at = ?
      WHERE id = ? AND state_hash = ? AND session_id = ? AND consumed_at IS NULL`
    ).bind(consumedAt, row.id, stateHash, sessionId).run();
    assertRun(result, "The Google authorization challenge was already consumed.");
    return parseOAuthState(row);
  }

  async findConnection(studentId: string, provider: SourceProvider): Promise<SourceConnectionRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, student_id, provider, status, display_name, secret_ciphertext,
        scopes_json, last_sync_at, last_error_code, created_at, updated_at
      FROM source_connections WHERE student_id = ? AND provider = ? LIMIT 1`
    ).bind(studentId, provider).first<ConnectionRow>();
    return row ? parseConnection(row) : null;
  }

  async saveClassroomConnection(write: {
    connection: SourceConnectionRecord;
    snapshot: ClassroomSnapshot;
  }): Promise<void> {
    const batch = batchFor(this.database);
    const statements: D1BoundStatementLike[] = [
      connectionStatement(this.database, write.connection),
      this.database.prepare(
        "DELETE FROM source_coursework WHERE student_id = ? AND provider = ?"
      ).bind(write.connection.studentId, "google_classroom"),
      this.database.prepare(
        "DELETE FROM source_courses WHERE student_id = ? AND provider = ?"
      ).bind(write.connection.studentId, "google_classroom")
    ];
    for (const course of write.snapshot.courses) {
      statements.push(this.database.prepare(
        `INSERT INTO source_courses (
          student_id, provider, external_id, name, section, subject, course_state,
          alternate_link, calendar_external_id, track_course_id, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        write.connection.studentId,
        course.provider,
        course.externalId,
        course.name,
        course.section,
        course.subject,
        course.courseState,
        course.alternateLink,
        course.calendarId,
        course.trackCourseId,
        write.connection.lastSyncAt
      ));
    }
    for (const work of write.snapshot.coursework) {
      statements.push(this.database.prepare(
        `INSERT INTO source_coursework (
          student_id, provider, course_external_id, external_id, title, description,
          work_type, due_date, due_time, alternate_link, source_updated_at,
          submission_state, late, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        write.connection.studentId,
        work.provider,
        work.courseExternalId,
        work.externalId,
        work.title,
        work.description,
        work.workType,
        work.dueDate,
        work.dueTime,
        work.alternateLink,
        work.updateTime,
        work.submissionState,
        work.late === null ? null : Number(work.late),
        write.connection.lastSyncAt
      ));
    }
    assertBatch(
      await batch(statements),
      statements.length,
      "Unable to save the Google Classroom snapshot."
    );
  }

  async saveBandConnection(write: {
    connection: SourceConnectionRecord;
    feedHash: string;
    events: BandCalendarEvent[];
  }): Promise<void> {
    const batch = batchFor(this.database);
    const statements: D1BoundStatementLike[] = [
      connectionStatement(this.database, write.connection),
      this.database.prepare(
        "DELETE FROM source_calendar_events WHERE student_id = ? AND provider = ?"
      ).bind(write.connection.studentId, "band_ical")
    ];
    for (const event of write.events) {
      statements.push(this.database.prepare(
        `INSERT INTO source_calendar_events (
          student_id, provider, uid, title, description, location, starts_at,
          ends_at, all_day, status, source_updated_at, feed_hash, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        write.connection.studentId,
        event.provider,
        event.uid,
        event.title,
        event.description,
        event.location,
        event.startsAt,
        event.endsAt,
        Number(event.allDay),
        event.status,
        event.sourceUpdatedAt,
        write.feedHash,
        write.connection.lastSyncAt
      ));
    }
    assertBatch(await batch(statements), statements.length, "Unable to save the BAND calendar snapshot.");
  }

  async getStudentSnapshot(studentId: string): Promise<SourceSnapshot> {
    const connections = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'provider', provider,
        'status', status,
        'displayName', display_name,
        'lastSyncAt', last_sync_at,
        'lastErrorCode', last_error_code
      )), '[]') AS records_json
      FROM source_connections WHERE student_id = ?`
    ).bind(studentId).first<AggregateRow>();
    const courses = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'provider', provider,
        'externalId', external_id,
        'name', name,
        'section', section,
        'subject', subject,
        'courseState', course_state,
        'alternateLink', alternate_link,
        'calendarId', calendar_external_id,
        'trackCourseId', track_course_id
      )), '[]') AS records_json
      FROM source_courses WHERE student_id = ? ORDER BY name`
    ).bind(studentId).first<AggregateRow>();
    const coursework = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'provider', provider,
        'externalId', external_id,
        'courseExternalId', course_external_id,
        'title', title,
        'description', description,
        'workType', work_type,
        'dueDate', due_date,
        'dueTime', due_time,
        'alternateLink', alternate_link,
        'updateTime', source_updated_at,
        'submissionState', submission_state,
        'late', CASE WHEN late IS NULL THEN NULL WHEN late = 1 THEN json('true') ELSE json('false') END
      )), '[]') AS records_json
      FROM source_coursework WHERE student_id = ? ORDER BY due_date, due_time`
    ).bind(studentId).first<AggregateRow>();
    const events = await this.database.prepare(
      `SELECT COALESCE(json_group_array(json_object(
        'provider', provider,
        'uid', uid,
        'title', title,
        'description', description,
        'location', location,
        'startsAt', starts_at,
        'endsAt', ends_at,
        'allDay', CASE WHEN all_day = 1 THEN json('true') ELSE json('false') END,
        'status', status,
        'sourceUpdatedAt', source_updated_at
      )), '[]') AS records_json
      FROM source_calendar_events WHERE student_id = ? ORDER BY starts_at`
    ).bind(studentId).first<AggregateRow>();
    return {
      connections: JSON.parse(connections?.records_json ?? "[]") as PublicSourceConnection[],
      courses: JSON.parse(courses?.records_json ?? "[]") as ClassroomCourse[],
      coursework: JSON.parse(coursework?.records_json ?? "[]") as ClassroomCoursework[],
      events: JSON.parse(events?.records_json ?? "[]") as BandCalendarEvent[]
    };
  }
}
