import { describe, expect, it } from "vitest";

import type { ClassroomSnapshot } from "../lib/source/google-classroom";
import {
  D1SourceConnectionStore,
  SourceConnectionStoreError,
  type SourceConnectionRecord
} from "../lib/storage/source-connection-store";
import type {
  D1BoundStatementLike,
  D1DatabaseLike,
  D1RunResult
} from "../lib/storage/session-store";

function fakeDatabase(firstRows: Array<Record<string, unknown> | null> = []) {
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
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } } satisfies D1RunResult));
    }
  };
  return { database, calls, batches };
}

const connection: SourceConnectionRecord = {
  id: "source_google_01",
  studentId: "student_emily",
  provider: "google_classroom",
  status: "active",
  displayName: "Google Classroom",
  secretCiphertext: "v1.iv.encrypted-refresh-token",
  scopes: [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
  ],
  lastSyncAt: "2026-07-18T18:00:00.000Z",
  lastErrorCode: null,
  createdAt: "2026-07-18T18:00:00.000Z",
  updatedAt: "2026-07-18T18:00:00.000Z"
};

const snapshot: ClassroomSnapshot = {
  courses: [{
    provider: "google_classroom",
    externalId: "google_algebra",
    name: "Algebra I - Period 2",
    section: "Period 2",
    subject: "Mathematics",
    courseState: "ACTIVE",
    alternateLink: "https://classroom.google.com/c/google_algebra",
    calendarId: null,
    trackCourseId: "course_algebra_1"
  }],
  coursework: [{
    provider: "google_classroom",
    externalId: "work_01",
    courseExternalId: "google_algebra",
    title: "Equations review",
    description: null,
    workType: "ASSIGNMENT",
    dueDate: "2026-08-20",
    dueTime: "16:30:00",
    alternateLink: null,
    updateTime: "2026-07-18T12:00:00Z",
    submissionState: "CREATED",
    late: false
  }],
  evidenceIds: ["google_algebra", "work_01"]
};

describe("D1 read-only source connection store", () => {
  it("stores an OAuth challenge by hash and consumes it exactly once", async () => {
    const { database, calls } = fakeDatabase([{
      id: "oauth_01",
      state_hash: "a".repeat(64),
      session_id: "session_01",
      provider: "google_classroom",
      expires_at: "2026-07-18T18:10:00.000Z",
      consumed_at: null,
      created_at: "2026-07-18T18:00:00.000Z"
    }]);
    const store = new D1SourceConnectionStore(database);

    await store.createOAuthState({
      id: "oauth_01",
      stateHash: "a".repeat(64),
      sessionId: "session_01",
      provider: "google_classroom",
      expiresAt: "2026-07-18T18:10:00.000Z",
      createdAt: "2026-07-18T18:00:00.000Z"
    });
    await expect(store.consumeOAuthState(
      "a".repeat(64), "session_01", "2026-07-18T18:01:00.000Z"
    )).resolves.toMatchObject({ provider: "google_classroom", sessionId: "session_01" });

    expect(calls[0]?.values).not.toContain("state_raw_value");
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO source_oauth_states"),
      expect.stringContaining("consumed_at IS NULL"),
      expect.stringContaining("UPDATE source_oauth_states SET consumed_at")
    ]));
  });

  it("atomically replaces a Classroom snapshot without persisting plaintext credentials", async () => {
    const { database, calls, batches } = fakeDatabase();
    await new D1SourceConnectionStore(database).saveClassroomConnection({ connection, snapshot });

    expect(batches).toHaveLength(1);
    expect(calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO source_connections"),
      expect.stringContaining("DELETE FROM source_courses"),
      expect.stringContaining("DELETE FROM source_coursework"),
      expect.stringContaining("INSERT INTO source_courses"),
      expect.stringContaining("INSERT INTO source_coursework")
    ]));
    expect(JSON.stringify(calls)).not.toContain("refresh-token-plaintext");
    expect(JSON.stringify(calls)).toContain(connection.secretCiphertext);
  });

  it("returns only public connection metadata and normalized records", async () => {
    const { database } = fakeDatabase([
      { records_json: JSON.stringify([{
        provider: "google_classroom", status: "active", displayName: "Google Classroom",
        lastSyncAt: "2026-07-18T18:00:00.000Z", lastErrorCode: null
      }]) },
      { records_json: JSON.stringify(snapshot.courses) },
      { records_json: JSON.stringify(snapshot.coursework) },
      { records_json: "[]" }
    ]);
    const result = await new D1SourceConnectionStore(database).getStudentSnapshot("student_emily");

    expect(result.connections).toEqual([expect.objectContaining({ provider: "google_classroom" })]);
    expect(result.courses).toEqual(snapshot.courses);
    expect(JSON.stringify(result)).not.toContain("secretCiphertext");
  });

  it("fails closed when atomic batch support is unavailable", async () => {
    const database: D1DatabaseLike = {
      prepare() {
        return {
          bind() {
            return {
              async run() { return { success: true, meta: { changes: 1 } }; },
              async first<T>() { return null as T | null; }
            };
          }
        };
      }
    };
    await expect(new D1SourceConnectionStore(database).saveClassroomConnection({ connection, snapshot }))
      .rejects.toBeInstanceOf(SourceConnectionStoreError);
  });
});
