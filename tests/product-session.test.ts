import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createProductSession } from "../lib/domain/product-session";
import {
  D1SessionStore,
  type D1DatabaseLike,
  type SessionRecord,
  type SessionStore
} from "../lib/storage/session-store";
import { verifySessionToken } from "../lib/security/session-token";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";

class MemorySessionStore implements SessionStore {
  readonly records = new Map<string, SessionRecord>();

  async create(record: SessionRecord) {
    this.records.set(record.id, record);
  }

  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
}

describe("secure product session creation", () => {
  it("creates Emily's versioned student session and signed role token", async () => {
    const store = new MemorySessionStore();
    const result = await createProductSession(
      { fixtureKey: "emily_band_camp_v1", role: "student" },
      {
        store,
        signingSecret,
        now: () => new Date("2026-07-18T12:00:00.000Z"),
        randomUUID: () => "session_01",
        randomBytes: () => Buffer.from("csrf-test-value")
      }
    );

    expect(result).toMatchObject({
      sessionId: "session_01",
      phase: "ORIENTATION_READY",
      profile: { name: "Emily", grade: 9 },
      expiresAt: "2026-07-18T14:00:00.000Z"
    });
    await expect(verifySessionToken(result.sessionToken, signingSecret, Date.parse("2026-07-18T12:30:00.000Z"))).resolves.toMatchObject({
      sessionId: "session_01",
      role: "student"
    });

    const persisted = await store.findById("session_01");
    expect(persisted?.state).toMatchObject({
      phase: "ORIENTATION_READY",
      stateVersion: 5,
      sourceVersion: 1
    });
    expect(persisted?.csrfHash).toBe(createHash("sha256").update(result.csrfToken).digest("hex"));
    expect(persisted?.csrfHash).not.toContain(result.csrfToken);
  });

  it("creates a separately scoped guardian session", async () => {
    const store = new MemorySessionStore();
    const result = await createProductSession(
      { fixtureKey: "emily_band_camp_v1", role: "guardian" },
      {
        store,
        signingSecret,
        randomUUID: () => "session_guardian",
        randomBytes: () => Buffer.from("guardian-csrf")
      }
    );

    await expect(verifySessionToken(result.sessionToken, signingSecret, Date.now())).resolves.toMatchObject({
      role: "guardian"
    });
  });

  it("rejects unknown fixtures and extra input", async () => {
    const store = new MemorySessionStore();
    await expect(
      createProductSession(
        { fixtureKey: "real_student_data", role: "student" },
        { store, signingSecret }
      )
    ).rejects.toThrow();
    await expect(
      createProductSession(
        { fixtureKey: "emily_band_camp_v1", role: "student", admin: true },
        { store, signingSecret }
      )
    ).rejects.toThrow();
  });
});

describe("D1 session store", () => {
  it("uses bound parameters for inserts and reads", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const database: D1DatabaseLike = {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values });
            return {
              async run() {
                return { success: true };
              },
              async first<T>() {
                return {
                  id: "session_01",
                  fixture_key: "emily_band_camp_v1",
                  actor_id: "student_emily",
                  role: "student",
                  state_json: '{"phase":"FRESH","stateVersion":1,"sourceVersion":1,"activePlanVersion":null}',
                  csrf_hash: "hash",
                  expires_at: "2026-07-18T14:00:00.000Z",
                  created_at: "2026-07-18T12:00:00.000Z",
                  updated_at: "2026-07-18T12:00:00.000Z"
                } as T;
              }
            };
          }
        };
      }
    };
    const store = new D1SessionStore(database);
    const record: SessionRecord = {
      id: "session_01",
      fixtureKey: "emily_band_camp_v1",
      actorId: "student_emily",
      role: "student",
      state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
      csrfHash: "hash",
      expiresAt: "2026-07-18T14:00:00.000Z",
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z"
    };

    await store.create(record);
    expect(await store.findById("session_01")).toEqual(record);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(calls[1]?.sql).toContain("WHERE id = ?");
    expect(calls[1]?.values).toEqual(["session_01"]);
  });

  it("fails closed when D1 does not confirm the write", async () => {
    const database: D1DatabaseLike = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return { success: false };
              },
              async first<T>() {
                return null as T | null;
              }
            };
          }
        };
      }
    };
    const store = new D1SessionStore(database);
    await expect(
      store.create({
        id: "s",
        fixtureKey: "emily_band_camp_v1",
        actorId: "student_emily",
        role: "student",
        state: { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null },
        csrfHash: "hash",
        expiresAt: "2026-07-18T14:00:00.000Z",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z"
      })
    ).rejects.toThrow("persist");
  });
});
