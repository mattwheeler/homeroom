import type { SessionState } from "../domain/state-machine";
import type { SessionRole } from "../security/session-token";

export interface SessionRecord {
  id: string;
  fixtureKey: string;
  actorId: string;
  principalId?: string;
  householdId?: string;
  studentId?: string;
  guardianId?: string;
  role: SessionRole;
  identityProvider?: "google" | "judge";
  identitySubject?: string;
  identityEmail?: string;
  state: SessionState;
  csrfHash: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  findById(id: string): Promise<SessionRecord | null>;
}

export interface ReusableSessionStore extends SessionStore {
  updateCsrfHash(id: string, csrfHash: string, updatedAt: string): Promise<void>;
}

export interface D1RunResult {
  success: boolean;
  meta?: { changes?: number };
}

export interface D1BoundStatementLike {
  run(): Promise<D1RunResult>;
  first<T>(): Promise<T | null>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1BoundStatementLike;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch?(statements: D1BoundStatementLike[]): Promise<D1RunResult[]>;
}

interface SessionRow {
  id: string;
  fixture_key: string;
  actor_id: string;
  principal_id: string | null;
  household_id: string | null;
  student_id: string | null;
  guardian_id: string | null;
  role: SessionRole;
  identity_provider: "google" | "judge" | null;
  identity_subject: string | null;
  identity_email: string | null;
  state_json: string;
  csrf_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreError";
  }
}

export class D1SessionStore implements ReusableSessionStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async create(record: SessionRecord): Promise<void> {
    const result = await this.database
      .prepare(
        `INSERT INTO demo_sessions (
          id, seed_key, actor_id, role, state_json, state_version, source_version,
          active_plan_version, csrf_hash, expires_at, created_at, updated_at,
          identity_provider, identity_subject, identity_email,
          principal_id, household_id, student_id, guardian_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.id,
        record.fixtureKey,
        record.actorId,
        record.role,
        JSON.stringify(record.state),
        record.state.stateVersion,
        record.state.sourceVersion,
        record.state.activePlanVersion,
        record.csrfHash,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
        record.identityProvider ?? null,
        record.identitySubject ?? null,
        record.identityEmail ?? null,
        record.principalId ?? null,
        record.householdId ?? null,
        record.studentId ?? null,
        record.guardianId ?? null
      )
      .run();
    if (!result.success) throw new SessionStoreError("Unable to persist the session.");
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT id, seed_key, actor_id, role, state_json, csrf_hash,
          expires_at, created_at, updated_at, identity_provider, identity_subject, identity_email,
          principal_id, household_id, student_id, guardian_id
        FROM demo_sessions WHERE id = ? LIMIT 1`
      )
      .bind(id)
      .first<SessionRow>();
    if (!row) return null;
    const record: SessionRecord = {
      id: row.id,
      fixtureKey: row.fixture_key,
      actorId: row.actor_id,
      ...(row.principal_id ? { principalId: row.principal_id } : {}),
      ...(row.household_id ? { householdId: row.household_id } : {}),
      ...(row.student_id ? { studentId: row.student_id } : {}),
      ...(row.guardian_id ? { guardianId: row.guardian_id } : {}),
      role: row.role,
      state: JSON.parse(row.state_json) as SessionState,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.identity_provider && row.identity_subject && row.identity_email) {
      record.identityProvider = row.identity_provider;
      record.identitySubject = row.identity_subject;
      record.identityEmail = row.identity_email;
    }
    return record;
  }

  async updateCsrfHash(id: string, csrfHash: string, updatedAt: string): Promise<void> {
    const result = await this.database
      .prepare("UPDATE demo_sessions SET csrf_hash = ?, updated_at = ? WHERE id = ?")
      .bind(csrfHash, updatedAt, id)
      .run();
    if (!result.success || result.meta?.changes === 0) {
      throw new SessionStoreError("Unable to rotate the session request token.");
    }
  }
}
