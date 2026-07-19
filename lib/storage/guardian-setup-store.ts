import {
  guardianSetupSettingsSchema,
  guardianSourceStatusSchema,
  type GuardianSetupSettings,
  type GuardianSourceStatus,
  type StoredGuardianSetup
} from "../domain/guardian-setup-profile";
import type { D1DatabaseLike } from "./session-store";

interface GuardianSettingsRow {
  settings_json: string;
  settings_version: number;
  updated_at: string;
}

interface GuardianSourceRow {
  provider: "google_classroom" | "band_ical";
  status: "active" | "error" | "revoked";
  display_name: string;
  last_sync_at: string | null;
}

export interface GuardianSettingsWrite {
  guardianId: string;
  studentId: string;
  expectedVersion: number;
  settings: GuardianSetupSettings;
  updatedAt: string;
}

export interface GuardianSetupStore {
  findSettings(guardianId: string, studentId: string): Promise<StoredGuardianSetup | null>;
  saveSettings(write: GuardianSettingsWrite): Promise<StoredGuardianSetup>;
  listSourceStatuses(studentId: string): Promise<GuardianSourceStatus[]>;
}

export class GuardianSetupStoreError extends Error {
  constructor(
    message: string,
    readonly code: "STALE_WRITE" | "PERSISTENCE_FAILED" | "INVALID_RECORD" = "STALE_WRITE"
  ) {
    super(message);
    this.name = "GuardianSetupStoreError";
  }
}

export class D1GuardianSetupStore implements GuardianSetupStore {
  constructor(private readonly database: D1DatabaseLike) {}

  async findSettings(
    guardianId: string,
    studentId: string
  ): Promise<StoredGuardianSetup | null> {
    const row = await this.database
      .prepare(
        `SELECT settings_json, settings_version, updated_at
        FROM guardian_student_settings
        WHERE guardian_id = ? AND student_id = ? LIMIT 1`
      )
      .bind(guardianId, studentId)
      .first<GuardianSettingsRow>();
    if (!row) return null;
    try {
      return {
        settings: guardianSetupSettingsSchema.parse(JSON.parse(row.settings_json)),
        settingsVersion: row.settings_version,
        updatedAt: row.updated_at
      };
    } catch {
      throw new GuardianSetupStoreError("The stored guardian settings are invalid.", "INVALID_RECORD");
    }
  }

  async saveSettings(write: GuardianSettingsWrite): Promise<StoredGuardianSetup> {
    const settings = guardianSetupSettingsSchema.parse(write.settings);
    const nextVersion = write.expectedVersion + 1;
    const result = await this.database
      .prepare(
        `INSERT INTO guardian_student_settings (
          guardian_id, student_id, settings_json, settings_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (guardian_id, student_id) DO UPDATE SET
          settings_json = excluded.settings_json,
          settings_version = excluded.settings_version,
          updated_at = excluded.updated_at
        WHERE guardian_student_settings.settings_version = ?`
      )
      .bind(
        write.guardianId,
        write.studentId,
        JSON.stringify(settings),
        nextVersion,
        write.updatedAt,
        write.updatedAt,
        write.expectedVersion
      )
      .run();
    if (!result.success) {
      throw new GuardianSetupStoreError("Unable to save guardian settings.", "PERSISTENCE_FAILED");
    }
    if (result.meta?.changes !== undefined && result.meta.changes !== 1) {
      throw new GuardianSetupStoreError("The guardian settings changed before this update completed.");
    }
    return { settings, settingsVersion: nextVersion, updatedAt: write.updatedAt };
  }

  async listSourceStatuses(studentId: string): Promise<GuardianSourceStatus[]> {
    const providers = ["google_classroom", "band_ical"] as const;
    const rows = await Promise.all(providers.map((provider) =>
      this.database
        .prepare(
          `SELECT provider, status, display_name, last_sync_at
          FROM source_connections
          WHERE student_id = ? AND provider = ? LIMIT 1`
        )
        .bind(studentId, provider)
        .first<GuardianSourceRow>()
    ));
    return rows.flatMap((row) => row
      ? [guardianSourceStatusSchema.parse({
          provider: row.provider,
          status: row.status,
          displayName: row.display_name,
          lastSyncAt: row.last_sync_at
        })]
      : []
    );
  }
}
