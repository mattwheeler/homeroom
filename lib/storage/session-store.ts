import type { SessionState } from "../domain/state-machine";
import type { SessionRole } from "../security/session-token";

export interface SessionRecord {
  id: string;
  fixtureKey: string;
  actorId: string;
  role: SessionRole;
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

export interface D1RunResult {
  success: boolean;
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
}

interface SessionRow {
  id: string;
  fixture_key: string;
  actor_id: string;
  role: SessionRole;
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

export class D1SessionStore implements SessionStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async create(record: SessionRecord): Promise<void> {
    const result = await this.database
      .prepare(
        `INSERT INTO demo_sessions (
          id, seed_key, actor_id, role, state_json, state_version, source_version,
          active_plan_version, csrf_hash, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        record.updatedAt
      )
      .run();
    if (!result.success) throw new SessionStoreError("Unable to persist the demo session.");
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT id, seed_key, actor_id, role, state_json, csrf_hash,
          expires_at, created_at, updated_at
        FROM demo_sessions WHERE id = ? LIMIT 1`
      )
      .bind(id)
      .first<SessionRow>();
    if (!row) return null;
    return {
      id: row.id,
      fixtureKey: row.fixture_key,
      actorId: row.actor_id,
      role: row.role,
      state: JSON.parse(row.state_json) as SessionState,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
