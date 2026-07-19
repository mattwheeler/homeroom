import { describe, expect, it } from "vitest";

import { defaultGuardianSetupSettings } from "../lib/domain/guardian-setup-profile";
import {
  D1StudentSafetyPolicyStore,
  StudentSafetyPolicyStoreError
} from "../lib/storage/student-safety-policy-store";
import type { D1DatabaseLike } from "../lib/storage/session-store";

function fakeDatabase(firstRow: Record<string, unknown> | null) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes: 0 } }; },
            async first<T>() { return firstRow as T | null; }
          };
        }
      };
    }
  };
  return { database, calls };
}

describe("student safety policy lookup", () => {
  it.each(["blocked", "guardian_approval"] as const)(
    "loads the guardian external-link policy by authenticated student id: %s",
    async (externalLinks) => {
      const settings = defaultGuardianSetupSettings();
      settings.safety.externalLinks = externalLinks;
      const { database, calls } = fakeDatabase({ settings_json: JSON.stringify(settings) });

      await expect(new D1StudentSafetyPolicyStore(database).findExternalLinkPolicy("student_emily"))
        .resolves.toBe(externalLinks);
      expect(calls[0]?.values).toEqual(["student_emily"]);
      expect(calls[0]?.sql).toContain("ORDER BY updated_at DESC");
      expect(calls[0]?.sql).not.toContain("secret");
    }
  );

  it("returns no policy when the guardian has not saved settings", async () => {
    const { database } = fakeDatabase(null);
    await expect(new D1StudentSafetyPolicyStore(database).findExternalLinkPolicy("student_emily"))
      .resolves.toBeNull();
  });

  it("rejects malformed stored settings without exposing stored content", async () => {
    const { database } = fakeDatabase({ settings_json: '{"safety":{"externalLinks":"allow"}}' });
    await expect(new D1StudentSafetyPolicyStore(database).findExternalLinkPolicy("student_emily"))
      .rejects.toEqual(expect.objectContaining({
        name: "StudentSafetyPolicyStoreError",
        message: "The stored student safety policy is invalid."
      } satisfies Partial<StudentSafetyPolicyStoreError>));
  });
});
