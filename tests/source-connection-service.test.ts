import { describe, expect, it, vi } from "vitest";

import {
  completeGoogleClassroomConnection,
  connectBandCalendar,
  startGoogleClassroomConnection,
  syncSourceConnection
} from "../lib/domain/source-connections";
import type { SessionRecord } from "../lib/storage/session-store";
import type {
  SourceConnectionRecord,
  SourceOAuthStateRecord,
  SourceProvider
} from "../lib/storage/source-connection-store";

const session: SessionRecord = {
  id: "session_01",
  fixtureKey: "emily_band_camp_v1",
  actorId: "student_emily",
  role: "student",
  state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
  csrfHash: "hash",
  expiresAt: "2026-07-18T20:00:00.000Z",
  createdAt: "2026-07-18T18:00:00.000Z",
  updatedAt: "2026-07-18T18:00:00.000Z"
};

class MemorySourceStore {
  oauth: SourceOAuthStateRecord[] = [];
  connections: SourceConnectionRecord[] = [];
  classroomWrites: unknown[] = [];
  bandWrites: unknown[] = [];
  async createOAuthState(record: SourceOAuthStateRecord) { this.oauth.push(record); }
  async consumeOAuthState(hash: string, sessionId: string) {
    return this.oauth.find((item) => item.stateHash === hash && item.sessionId === sessionId) ?? null;
  }
  async findConnection(_studentId: string, provider: SourceProvider) {
    return this.connections.find((item) => item.provider === provider) ?? null;
  }
  async saveClassroomConnection(write: { connection: SourceConnectionRecord }) {
    this.connections = this.connections.filter((item) => item.provider !== "google_classroom");
    this.connections.push(write.connection);
    this.classroomWrites.push(write);
  }
  async saveBandConnection(write: { connection: SourceConnectionRecord }) {
    this.connections = this.connections.filter((item) => item.provider !== "band_ical");
    this.connections.push(write.connection);
    this.bandWrites.push(write);
  }
}

const sourceSecret = "source-encryption-key-that-is-longer-than-thirty-two-characters";

describe("read-only source connection orchestration", () => {
  it("binds Google authorization to Emily's session using hashed state and encrypted PKCE", async () => {
    const store = new MemorySourceStore();
    const result = await startGoogleClassroomConnection({
      session,
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      now: () => new Date("2026-07-18T18:00:00.000Z"),
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => (index % 251) + 1),
      randomUUID: () => "11111111-2222-4333-8444-555555555555"
    });
    const state = new URL(result.authorizationUrl).searchParams.get("state")!;

    expect(store.oauth).toHaveLength(1);
    expect(store.oauth[0]).toMatchObject({
      sessionId: "session_01",
      provider: "google_classroom",
      expiresAt: "2026-07-18T18:10:00.000Z"
    });
    expect(store.oauth[0]?.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.oauth[0]?.stateHash).not.toBe(state);
    expect(store.oauth[0]?.codeVerifierCiphertext).toMatch(/^v1\./);
    expect(store.oauth[0]?.codeVerifierCiphertext).not.toBe(
      new URL(result.authorizationUrl).searchParams.get("code_challenge")
    );
  });

  it("completes Google OAuth, syncs live records, and persists only the encrypted refresh token", async () => {
    const store = new MemorySourceStore();
    const started = await startGoogleClassroomConnection({
      session,
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      now: () => new Date("2026-07-18T18:00:00.000Z"),
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => (index % 251) + 1),
      randomUUID: () => "11111111-2222-4333-8444-555555555555"
    });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const snapshot = { courses: [], coursework: [], evidenceIds: [] };
    const exchange = vi.fn().mockResolvedValue({
      accessToken: "access-plaintext", refreshToken: "refresh-plaintext", expiresIn: 3_600
    });
    const syncStudentSnapshot = vi.fn().mockResolvedValue(snapshot);

    await completeGoogleClassroomConnection({
      session,
      state,
      code: "authorization-code",
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      exchange,
      classroom: { syncStudentSnapshot },
      now: () => new Date("2026-07-18T18:01:00.000Z"),
      randomUUID: () => "99999999-2222-4333-8444-555555555555"
    });

    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({
      code: "authorization-code",
      codeVerifier: expect.any(String)
    }));
    expect(syncStudentSnapshot).toHaveBeenCalledWith("access-plaintext");
    expect(store.connections[0]?.secretCiphertext).not.toContain("refresh-plaintext");
    expect(JSON.stringify(store.classroomWrites)).not.toContain("access-plaintext");
  });

  it("connects and re-syncs a BAND feed using an encrypted URL", async () => {
    const store = new MemorySourceStore();
    const sync = vi.fn().mockResolvedValue({ provider: "band_ical", events: [], feedHash: "f".repeat(64), evidenceIds: [] });

    await connectBandCalendar({
      session,
      calendarUrl: "https://calendar.band.us/export/private-token.ics",
      displayName: "Emily's marching band",
      store,
      sourceEncryptionSecret: sourceSecret,
      calendar: { sync },
      now: () => new Date("2026-07-18T18:00:00.000Z"),
      randomUUID: () => "77777777-2222-4333-8444-555555555555"
    });
    expect(store.connections[0]?.secretCiphertext).not.toContain("private-token");
    expect(JSON.stringify(store.bandWrites)).not.toContain("private-token");

    await syncSourceConnection({
      session,
      provider: "band_ical",
      store,
      sourceEncryptionSecret: sourceSecret,
      calendar: { sync },
      classroom: { syncStudentSnapshot: vi.fn() },
      refreshGoogle: vi.fn(),
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      now: () => new Date("2026-07-18T18:05:00.000Z")
    });
    expect(sync).toHaveBeenLastCalledWith("https://calendar.band.us/export/private-token.ics");
    expect(store.bandWrites).toHaveLength(2);
  });

  it("reconnects Google without rotating a missing refresh token and performs a later refresh", async () => {
    const store = new MemorySourceStore();
    const classroom = { syncStudentSnapshot: vi.fn().mockResolvedValue({ courses: [], coursework: [], evidenceIds: [] }) };
    const start = async (minute: number) => {
      const result = await startGoogleClassroomConnection({
        session,
        store,
        sourceEncryptionSecret: sourceSecret,
        googleClientId: "client.apps.googleusercontent.com",
        googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
        now: () => new Date(`2026-07-18T18:0${minute}:00.000Z`),
        randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => ((index + minute) % 251) + 1),
        randomUUID: () => `${minute}`.repeat(8) + "-2222-4333-8444-555555555555"
      });
      return new URL(result.authorizationUrl).searchParams.get("state")!;
    };
    const firstState = await start(1);
    await completeGoogleClassroomConnection({
      session,
      state: firstState,
      code: "first-code",
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      exchange: vi.fn().mockResolvedValue({ accessToken: "access-1", refreshToken: "refresh-stable", expiresIn: 3_600, scope: null }),
      classroom,
      now: () => new Date("2026-07-18T18:01:30.000Z"),
      randomUUID: () => "aaaaaaaa-2222-4333-8444-555555555555"
    });
    const originalId = store.connections[0]!.id;
    const originalCreatedAt = store.connections[0]!.createdAt;

    const secondState = await start(2);
    await completeGoogleClassroomConnection({
      session,
      state: secondState,
      code: "second-code",
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      exchange: vi.fn().mockResolvedValue({ accessToken: "access-2", refreshToken: null, expiresIn: 3_600, scope: null }),
      classroom,
      now: () => new Date("2026-07-18T18:02:30.000Z")
    });
    expect(store.connections[0]).toMatchObject({ id: originalId, createdAt: originalCreatedAt });

    const refreshGoogle = vi.fn().mockResolvedValue({ accessToken: "access-3", refreshToken: null, expiresIn: 3_600, scope: null });
    const result = await syncSourceConnection({
      session,
      provider: "google_classroom",
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      refreshGoogle,
      classroom,
      now: () => new Date("2026-07-18T18:05:00.000Z")
    });
    expect(result).toEqual({ synced: true, provider: "google_classroom", recordCount: 0 });
    expect(refreshGoogle).toHaveBeenCalledWith({
      refreshToken: "refresh-stable",
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "client-secret"
    });
    expect(classroom.syncStudentSnapshot).toHaveBeenLastCalledWith("access-3");
  });

  it("fails closed for invalid OAuth responses, consumed state, and absent offline credentials", async () => {
    const store = new MemorySourceStore();
    const common = {
      session,
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback",
      exchange: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: null, expiresIn: 3_600, scope: null }),
      classroom: { syncStudentSnapshot: vi.fn() }
    };
    await expect(completeGoogleClassroomConnection({ ...common, state: "short", code: "code" })).rejects.toThrow(/invalid/i);
    await expect(completeGoogleClassroomConnection({ ...common, state: "s".repeat(33), code: "" })).rejects.toThrow(/invalid/i);
    await expect(completeGoogleClassroomConnection({ ...common, state: "s".repeat(33), code: "c".repeat(4_097) })).rejects.toThrow(/invalid/i);
    await expect(completeGoogleClassroomConnection({ ...common, state: "s".repeat(33), code: "code" })).rejects.toThrow(/expired/i);

    const started = await startGoogleClassroomConnection({
      session,
      store,
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback"
    });
    await expect(completeGoogleClassroomConnection({
      ...common,
      state: new URL(started.authorizationUrl).searchParams.get("state")!,
      code: "code"
    })).rejects.toThrow(/offline refresh/i);
  });

  it("reuses a BAND connection and applies its safe default display name", async () => {
    const store = new MemorySourceStore();
    const calendar = { sync: vi.fn().mockResolvedValue({ provider: "band_ical", events: [], feedHash: "a".repeat(64), evidenceIds: [] }) };
    await connectBandCalendar({
      session,
      calendarUrl: "https://calendar.band.us/export/private.ics",
      displayName: "   ",
      store,
      sourceEncryptionSecret: sourceSecret,
      calendar,
      now: () => new Date("2026-07-18T18:00:00.000Z"),
      randomUUID: () => "bbbbbbbb-2222-4333-8444-555555555555"
    });
    const first = store.connections[0]!;
    await connectBandCalendar({
      session,
      calendarUrl: "https://calendar.band.us/export/private-v2.ics",
      displayName: "Emily's band",
      store,
      sourceEncryptionSecret: sourceSecret,
      calendar,
      now: () => new Date("2026-07-18T18:10:00.000Z")
    });
    expect(first.displayName).toBe("BAND calendar");
    expect(store.connections[0]).toMatchObject({ id: first.id, createdAt: first.createdAt, displayName: "Emily's band" });
  });

  it("rejects guardian scope and missing source connections", async () => {
    await expect(startGoogleClassroomConnection({
      session: { ...session, actorId: "guardian_matt", role: "guardian" },
      store: new MemorySourceStore(),
      sourceEncryptionSecret: sourceSecret,
      googleClientId: "client.apps.googleusercontent.com",
      googleRedirectUri: "https://homeroom.example/api/integrations/google/callback"
    })).rejects.toThrow(/student/i);

    await expect(syncSourceConnection({
      session,
      provider: "google_classroom",
      store: new MemorySourceStore(),
      sourceEncryptionSecret: sourceSecret,
      classroom: { syncStudentSnapshot: vi.fn() },
      calendar: { sync: vi.fn() },
      refreshGoogle: vi.fn(),
      googleClientId: "client.apps.googleusercontent.com",
      googleClientSecret: "client-secret"
    })).rejects.toThrow(/not connected/i);
  });
});
