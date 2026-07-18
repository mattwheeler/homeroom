import { describe, expect, it } from "vitest";

import { syncBandSourceV2 } from "../lib/domain/source-sync";
import type { SourceSyncStore, SourceSyncWrite } from "../lib/storage/plan-store";
import type { SessionRecord } from "../lib/storage/session-store";

function savedV1Session(): SessionRecord {
  return {
    id: "session_01",
    fixtureKey: "emily_band_camp_v1",
    actorId: "student_emily",
    role: "student",
    state: { phase: "PLAN_V1_SAVED", stateVersion: 7, sourceVersion: 1, activePlanVersion: 1 },
    csrfHash: "hash",
    expiresAt: "2026-07-18T14:00:00.000Z",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:06:00.000Z"
  };
}

class MemorySourceSyncStore implements SourceSyncStore {
  writes: SourceSyncWrite[] = [];
  async syncSourceV2(write: SourceSyncWrite) { this.writes.push(write); }
}

describe("controlled BAND source version two sync", () => {
  it("advances only the source version while preserving active Plan V1", async () => {
    const store = new MemorySourceSyncStore();
    const result = await syncBandSourceV2({
      session: savedV1Session(),
      store,
      now: () => new Date("2026-07-18T12:07:00.000Z"),
      randomUUID: () => "audit_source_v2"
    });

    expect(result.session.state).toEqual({
      phase: "SOURCE_V2_SYNCED",
      stateVersion: 8,
      sourceVersion: 2,
      activePlanVersion: 1
    });
    expect(result.change).toEqual({
      id: "band_camp_check_in_v2",
      source: "BAND calendar",
      sourceRecordId: "event_band_camp_day_1",
      beforeVersion: 1,
      afterVersion: 2,
      changedAt: "2026-07-18T12:07:00.000Z",
      changes: [{ field: "checkIn", before: "07:30", after: "07:15" }],
      before: { wake: "06:30", departure: "07:00", checkIn: "07:30", start: "08:00" },
      after: { wake: "06:15", departure: "06:45", checkIn: "07:15", start: "08:00" }
    });
    expect(store.writes).toEqual([
      expect.objectContaining({
        sessionId: "session_01",
        previousStateVersion: 7,
        nextState: expect.objectContaining({ phase: "SOURCE_V2_SYNCED", sourceVersion: 2, activePlanVersion: 1 }),
        auditEventId: "audit_source_v2"
      })
    ]);
  });

  it("rejects source sync before Plan V1 is approved", async () => {
    const session = savedV1Session();
    session.state = { phase: "PLAN_PROPOSED", stateVersion: 6, sourceVersion: 1, activePlanVersion: null };
    await expect(syncBandSourceV2({ session, store: new MemorySourceSyncStore() }))
      .rejects.toThrow(/not allowed/i);
  });

  it("rejects a source sync outside Emily's student scope", async () => {
    const session = savedV1Session();
    session.actorId = "student_other";

    await expect(syncBandSourceV2({ session, store: new MemorySourceSyncStore() }))
      .rejects.toThrow("outside this student session");
  });
});
