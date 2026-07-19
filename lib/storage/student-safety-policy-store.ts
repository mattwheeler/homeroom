import { guardianSetupSettingsSchema } from "../domain/guardian-setup-profile";
import type { StudentExternalLinkPolicy } from "../domain/student-external-links";
import type { D1DatabaseLike } from "./session-store";

interface StudentSafetySettingsRow {
  settings_json: string;
}

export class StudentSafetyPolicyStoreError extends Error {
  constructor(message = "The stored student safety policy is invalid.") {
    super(message);
    this.name = "StudentSafetyPolicyStoreError";
  }
}

export interface StudentSafetyPolicyStore {
  findExternalLinkPolicy(studentId: string): Promise<StudentExternalLinkPolicy | null>;
}

export class D1StudentSafetyPolicyStore implements StudentSafetyPolicyStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async findExternalLinkPolicy(studentId: string): Promise<StudentExternalLinkPolicy | null> {
    const row = await this.database
      .prepare(
        `SELECT settings_json
        FROM guardian_student_settings
        WHERE student_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`
      )
      .bind(studentId)
      .first<StudentSafetySettingsRow>();
    if (!row) return null;
    try {
      return guardianSetupSettingsSchema.parse(JSON.parse(row.settings_json)).safety.externalLinks;
    } catch {
      throw new StudentSafetyPolicyStoreError();
    }
  }
}
