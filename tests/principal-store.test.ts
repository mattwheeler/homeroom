import { describe, expect, it } from "vitest";

import { createProductSession } from "../lib/domain/product-session";
import type { PrincipalResolver } from "../lib/storage/principal-store";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";

class MemorySessions implements SessionStore {
  record: SessionRecord | null = null;
  async create(record: SessionRecord) { this.record = record; }
  async findById(id: string) { return this.record?.id === id ? this.record : null; }
}

describe("verified principals and households", () => {
  it("uses the verified principal instead of collapsing every student to the fixture actor", async () => {
    const sessions = new MemorySessions();
    const principals: PrincipalResolver = {
      async resolve() {
        return {
          principalId: "principal_google_student_01",
          householdId: "household_wheeler",
          studentId: "principal_google_student_01"
        };
      }
    };
    await createProductSession(
      { fixtureKey: "emily_band_camp_v1", role: "student" },
      {
        store: sessions,
        principalResolver: principals,
        identity: { provider: "google", subject: "google-subject-emily", email: "emily@example.com", role: "student" },
        signingSecret,
        randomUUID: () => "session_identity",
        randomBytes: () => Buffer.from("identity-csrf")
      }
    );
    expect(sessions.record).toMatchObject({
      actorId: "principal_google_student_01",
      principalId: "principal_google_student_01",
      householdId: "household_wheeler",
      studentId: "principal_google_student_01"
    });
  });

  it("binds a guardian session to the linked student in the same household", async () => {
    const sessions = new MemorySessions();
    const principals: PrincipalResolver = {
      async resolve() {
        return {
          principalId: "principal_google_guardian_01",
          householdId: "household_wheeler",
          studentId: "principal_google_student_01"
        };
      }
    };
    await createProductSession(
      { fixtureKey: "emily_band_camp_v1", role: "guardian" },
      {
        store: sessions,
        principalResolver: principals,
        identity: { provider: "google", subject: "google-subject-matt", email: "matt@example.com", role: "guardian" },
        signingSecret,
        randomUUID: () => "session_guardian_identity",
        randomBytes: () => Buffer.from("guardian-identity-csrf")
      }
    );
    expect(sessions.record).toMatchObject({
      actorId: "principal_google_guardian_01",
      studentId: "principal_google_student_01",
      householdId: "household_wheeler"
    });
  });
});
