import { describe, expect, it } from "vitest";

import { defaultGuardianSetupSettings } from "../lib/domain/guardian-setup-profile";
import {
  D1GuardianSetupStore,
  GuardianSetupStoreError
} from "../lib/storage/guardian-setup-store";
import type { D1DatabaseLike } from "../lib/storage/session-store";

function fakeDatabase(firstRows: Array<Record<string, unknown> | null> = [], changes = 1) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes } }; },
            async first<T>() { return (firstRows.shift() ?? null) as T | null; }
          };
        }
      };
    }
  };
  return { database, calls };
}

describe("D1 guardian setup store", () => {
  it("reads settings and only non-secret source metadata with bound parameters", async () => {
    const settings = defaultGuardianSetupSettings();
    const { database, calls } = fakeDatabase([
      {
        settings_json: JSON.stringify(settings),
        settings_version: 3,
        updated_at: "2026-07-18T22:00:00.000Z"
      },
      {
        provider: "google_classroom",
        status: "active",
        display_name: "Google Classroom",
        last_sync_at: "2026-07-18T21:59:00.000Z"
      },
      null
    ]);
    const store = new D1GuardianSetupStore(database);

    await expect(store.findSettings("guardian_matt", "student_emily")).resolves.toEqual({
      settings,
      settingsVersion: 3,
      updatedAt: "2026-07-18T22:00:00.000Z"
    });
    await expect(store.listSourceStatuses("student_emily")).resolves.toEqual([
      expect.objectContaining({ provider: "google_classroom", status: "active" })
    ]);
    expect(calls.every((call) => !call.sql.includes("secret_ciphertext"))).toBe(true);
    expect(calls[0]?.values).toEqual(["guardian_matt", "student_emily"]);
    expect(calls[1]?.values).toEqual(["student_emily", "google_classroom"]);
  });

  it("uses optimistic versioning for guardian updates", async () => {
    const { database, calls } = fakeDatabase();
    const store = new D1GuardianSetupStore(database);
    const settings = defaultGuardianSetupSettings();

    await expect(store.saveSettings({
      guardianId: "guardian_matt",
      studentId: "student_emily",
      expectedVersion: 2,
      settings,
      updatedAt: "2026-07-18T22:01:00.000Z"
    })).resolves.toEqual({ settings, settingsVersion: 3, updatedAt: "2026-07-18T22:01:00.000Z" });

    expect(calls[0]?.sql).toContain("ON CONFLICT");
    expect(calls[0]?.sql).toContain("settings_version = ?");
    expect(calls[0]?.values).toContain(2);
    expect(calls[0]?.values).toContain(3);
  });

  it("fails closed on a stale update", async () => {
    const { database } = fakeDatabase([], 0);
    const store = new D1GuardianSetupStore(database);

    await expect(store.saveSettings({
      guardianId: "guardian_matt",
      studentId: "student_emily",
      expectedVersion: 1,
      settings: defaultGuardianSetupSettings(),
      updatedAt: "2026-07-18T22:01:00.000Z"
    })).rejects.toBeInstanceOf(GuardianSetupStoreError);
  });
});
