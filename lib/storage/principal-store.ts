import type { VerifiedIdentity } from "../security/identity-token";
import type { D1DatabaseLike } from "./session-store";

export interface ResolvedPrincipal {
  principalId: string;
  householdId: string;
  studentId: string;
  guardianId?: string;
}

export interface PrincipalResolver {
  resolve(identity: VerifiedIdentity): Promise<ResolvedPrincipal>;
}

export interface HouseholdBootstrap {
  guardianEmail: string;
  studentEmail: string;
  guardianName?: string;
  studentName?: string;
  householdName?: string;
}

async function stableId(prefix: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toLowerCase()));
  const suffix = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return `${prefix}_${suffix}`;
}

export class D1PrincipalStore implements PrincipalResolver {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly bootstrap: HouseholdBootstrap
  ) {}

  async resolve(identity: VerifiedIdentity): Promise<ResolvedPrincipal> {
    const guardianEmail = this.bootstrap.guardianEmail.trim().toLowerCase();
    const studentEmail = this.bootstrap.studentEmail.trim().toLowerCase();
    const identityEmail = identity.email.trim().toLowerCase();
    const expectedEmail = identity.role === "guardian" ? guardianEmail : studentEmail;
    if (identityEmail !== expectedEmail) throw new Error("This identity is not linked to the configured household.");

    const [householdId, guardianId, studentId] = await Promise.all([
      stableId("household", `${guardianEmail}|${studentEmail}`),
      stableId("principal", `guardian|${guardianEmail}`),
      stableId("principal", `student|${studentEmail}`)
    ]);
    const now = new Date().toISOString();
    const actorId = identity.role === "guardian" ? guardianId : studentId;
    const otherId = identity.role === "guardian" ? studentId : guardianId;
    const otherEmail = identity.role === "guardian" ? studentEmail : guardianEmail;
    const otherRole = identity.role === "guardian" ? "student" : "guardian";
    const actorName = identity.role === "guardian"
      ? this.bootstrap.guardianName ?? "Guardian"
      : this.bootstrap.studentName ?? "Student";
    const otherName = identity.role === "guardian"
      ? this.bootstrap.studentName ?? "Student"
      : this.bootstrap.guardianName ?? "Guardian";
    const placeholderSubject = `pending:${otherEmail}`;
    const statements = [
      this.database.prepare(
        `INSERT INTO households (id, name, bootstrap_key_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      ).bind(householdId, this.bootstrap.householdName ?? "Family", householdId.slice("household_".length), now, now),
      this.database.prepare(
        `INSERT INTO principals (id, identity_provider, identity_subject, email, role, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email, role) DO UPDATE SET
           identity_provider = excluded.identity_provider,
           identity_subject = excluded.identity_subject,
           display_name = excluded.display_name,
           updated_at = excluded.updated_at`
      ).bind(actorId, identity.provider, identity.subject, identityEmail, identity.role, actorName, now, now),
      this.database.prepare(
        `INSERT INTO principals (id, identity_provider, identity_subject, email, role, display_name, created_at, updated_at)
         VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email, role) DO NOTHING`
      ).bind(otherId, placeholderSubject, otherEmail, otherRole, otherName, now, now),
      this.database.prepare(
        `INSERT INTO household_members (household_id, principal_id, role, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(household_id, principal_id) DO NOTHING`
      ).bind(householdId, actorId, identity.role, now),
      this.database.prepare(
        `INSERT INTO household_members (household_id, principal_id, role, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(household_id, principal_id) DO NOTHING`
      ).bind(householdId, otherId, otherRole, now)
    ];
    if (!this.database.batch) throw new Error("D1 atomic batch support is required for household identity.");
    const results = await this.database.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("The household identity could not be saved.");
    return { principalId: actorId, householdId, studentId, guardianId };
  }
}
