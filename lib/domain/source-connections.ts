import {
  openSourceSecret,
  sealSourceSecret
} from "../security/source-secrets";
import {
  BandCalendarAdapter,
  normalizeCalendarFeedUrl,
  type BandCalendarEvent
} from "../source/band-calendar";
import {
  GOOGLE_CLASSROOM_SCOPES,
  GoogleClassroomAdapter,
  createGoogleClassroomAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  refreshGoogleAccessToken,
  type ClassroomSnapshot,
  type GoogleTokenResult
} from "../source/google-classroom";
import type { SessionRecord } from "../storage/session-store";
import type {
  SourceConnectionRecord,
  SourceOAuthStateRecord,
  SourceProvider
} from "../storage/source-connection-store";

interface SourceStore {
  createOAuthState(record: SourceOAuthStateRecord): Promise<void>;
  consumeOAuthState(stateHash: string, sessionId: string, consumedAt: string): Promise<SourceOAuthStateRecord | null>;
  findConnection(studentId: string, provider: SourceProvider): Promise<SourceConnectionRecord | null>;
  saveClassroomConnection(write: {
    connection: SourceConnectionRecord;
    snapshot: ClassroomSnapshot;
  }): Promise<void>;
  saveBandConnection(write: {
    connection: SourceConnectionRecord;
    feedHash: string;
    events: BandCalendarEvent[];
  }): Promise<void>;
}

interface ClassroomReader {
  syncStudentSnapshot(accessToken: string): Promise<ClassroomSnapshot>;
}

interface CalendarReader {
  sync(sourceUrl: string): Promise<{
    provider: "band_ical";
    events: BandCalendarEvent[];
    feedHash: string;
    evidenceIds: string[];
  }>;
}

export class SourceConnectionError extends Error {
  readonly code:
    | "SOURCE_SCOPE_MISMATCH"
    | "SOURCE_NOT_CONNECTED"
    | "SOURCE_OAUTH_INVALID"
    | "SOURCE_REFRESH_MISSING";

  constructor(code: SourceConnectionError["code"], message: string) {
    super(message);
    this.name = "SourceConnectionError";
    this.code = code;
  }
}

function assertStudent(session: SessionRecord): void {
  if (session.role !== "student" || session.actorId !== "student_emily") {
    throw new SourceConnectionError(
      "SOURCE_SCOPE_MISMATCH",
      "Source connections belong to Emily's student workspace."
    );
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceId(provider: SourceProvider, randomUUID?: () => string): string {
  const value = (randomUUID?.() ?? crypto.randomUUID()).replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 24);
  return `source_${provider === "google_classroom" ? "google" : "band"}_${value}`;
}

export async function startGoogleClassroomConnection(input: {
  session: SessionRecord;
  store: Pick<SourceStore, "createOAuthState">;
  sourceEncryptionSecret: string;
  googleClientId: string;
  googleRedirectUri: string;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  randomUUID?: () => string;
}) {
  assertStudent(input.session);
  const now = (input.now ?? (() => new Date()))();
  const randomBytes = input.randomBytes ?? ((size: number) => crypto.getRandomValues(new Uint8Array(size)));
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const stateHash = await sha256(state);
  const codeVerifierCiphertext = await sealSourceSecret(
    codeVerifier,
    input.sourceEncryptionSecret,
    randomBytes
  );
  await input.store.createOAuthState({
    id: `oauth_${(input.randomUUID?.() ?? crypto.randomUUID()).replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 24)}`,
    stateHash,
    sessionId: input.session.id,
    provider: "google_classroom",
    codeVerifierCiphertext,
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    createdAt: now.toISOString()
  });
  return {
    authorizationUrl: await createGoogleClassroomAuthorizationUrl({
      clientId: input.googleClientId,
      redirectUri: input.googleRedirectUri,
      state,
      codeVerifier
    }),
    proof: {
      provider: "google_classroom" as const,
      scopes: GOOGLE_CLASSROOM_SCOPES,
      stateBoundToSession: true as const,
      pkce: "S256" as const
    }
  };
}

export async function completeGoogleClassroomConnection(input: {
  session: SessionRecord;
  state: string;
  code: string;
  store: SourceStore;
  sourceEncryptionSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  exchange?: typeof exchangeGoogleAuthorizationCode;
  classroom?: ClassroomReader;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertStudent(input.session);
  if (input.state.length < 32 || input.state.length > 512 || !input.code || input.code.length > 4_096) {
    throw new SourceConnectionError("SOURCE_OAUTH_INVALID", "The Google authorization response is invalid.");
  }
  const now = (input.now ?? (() => new Date()))();
  const challenge = await input.store.consumeOAuthState(
    await sha256(input.state),
    input.session.id,
    now.toISOString()
  );
  if (!challenge) {
    throw new SourceConnectionError("SOURCE_OAUTH_INVALID", "The Google authorization response is invalid or expired.");
  }
  const codeVerifier = await openSourceSecret(challenge.codeVerifierCiphertext, input.sourceEncryptionSecret);
  const token = await (input.exchange ?? exchangeGoogleAuthorizationCode)({
    code: input.code,
    codeVerifier,
    clientId: input.googleClientId,
    clientSecret: input.googleClientSecret,
    redirectUri: input.googleRedirectUri
  });
  const existing = await input.store.findConnection(input.session.actorId, "google_classroom");
  const refreshToken = token.refreshToken ?? (
    existing ? await openSourceSecret(existing.secretCiphertext, input.sourceEncryptionSecret) : null
  );
  if (!refreshToken) {
    throw new SourceConnectionError("SOURCE_REFRESH_MISSING", "Google did not return an offline refresh credential.");
  }
  const snapshot = await (input.classroom ?? new GoogleClassroomAdapter()).syncStudentSnapshot(token.accessToken);
  const secretCiphertext = await sealSourceSecret(refreshToken, input.sourceEncryptionSecret);
  const connection: SourceConnectionRecord = {
    id: existing?.id ?? sourceId("google_classroom", input.randomUUID),
    studentId: "student_emily",
    provider: "google_classroom",
    status: "active",
    displayName: "Google Classroom",
    secretCiphertext,
    scopes: [...GOOGLE_CLASSROOM_SCOPES],
    lastSyncAt: now.toISOString(),
    lastErrorCode: null,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  await input.store.saveClassroomConnection({ connection, snapshot });
  return {
    connected: true as const,
    provider: "google_classroom" as const,
    courseCount: snapshot.courses.length,
    courseworkCount: snapshot.coursework.length,
    lastSyncAt: now.toISOString()
  };
}

export async function connectBandCalendar(input: {
  session: SessionRecord;
  calendarUrl: string;
  displayName: string;
  store: SourceStore;
  sourceEncryptionSecret: string;
  calendar?: CalendarReader;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  assertStudent(input.session);
  const now = (input.now ?? (() => new Date()))();
  const normalizedUrl = normalizeCalendarFeedUrl(input.calendarUrl);
  const result = await (input.calendar ?? new BandCalendarAdapter()).sync(normalizedUrl);
  const existing = await input.store.findConnection(input.session.actorId, "band_ical");
  const connection: SourceConnectionRecord = {
    id: existing?.id ?? sourceId("band_ical", input.randomUUID),
    studentId: "student_emily",
    provider: "band_ical",
    status: "active",
    displayName: input.displayName.trim().slice(0, 80) || "BAND calendar",
    secretCiphertext: await sealSourceSecret(normalizedUrl, input.sourceEncryptionSecret),
    scopes: ["calendar.readonly"],
    lastSyncAt: now.toISOString(),
    lastErrorCode: null,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  await input.store.saveBandConnection({ connection, feedHash: result.feedHash, events: result.events });
  return {
    connected: true as const,
    provider: "band_ical" as const,
    eventCount: result.events.length,
    lastSyncAt: now.toISOString()
  };
}

export async function syncSourceConnection(input: {
  session: SessionRecord;
  provider: SourceProvider;
  store: SourceStore;
  sourceEncryptionSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  refreshGoogle?: (input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<GoogleTokenResult>;
  classroom?: ClassroomReader;
  calendar?: CalendarReader;
  now?: () => Date;
}) {
  assertStudent(input.session);
  const connection = await input.store.findConnection(input.session.actorId, input.provider);
  if (!connection || connection.status !== "active") {
    throw new SourceConnectionError("SOURCE_NOT_CONNECTED", "This read-only source is not connected.");
  }
  const now = (input.now ?? (() => new Date()))();
  if (input.provider === "google_classroom") {
    const refreshToken = await openSourceSecret(connection.secretCiphertext, input.sourceEncryptionSecret);
    const token = await (input.refreshGoogle ?? refreshGoogleAccessToken)({
      refreshToken,
      clientId: input.googleClientId,
      clientSecret: input.googleClientSecret
    });
    const snapshot = await (input.classroom ?? new GoogleClassroomAdapter()).syncStudentSnapshot(token.accessToken);
    await input.store.saveClassroomConnection({
      connection: { ...connection, lastSyncAt: now.toISOString(), lastErrorCode: null, updatedAt: now.toISOString() },
      snapshot
    });
    return { synced: true as const, provider: input.provider, recordCount: snapshot.courses.length + snapshot.coursework.length };
  }
  const calendarUrl = await openSourceSecret(connection.secretCiphertext, input.sourceEncryptionSecret);
  const result = await (input.calendar ?? new BandCalendarAdapter()).sync(calendarUrl);
  await input.store.saveBandConnection({
    connection: { ...connection, lastSyncAt: now.toISOString(), lastErrorCode: null, updatedAt: now.toISOString() },
    feedHash: result.feedHash,
    events: result.events
  });
  return { synced: true as const, provider: input.provider, recordCount: result.events.length };
}
