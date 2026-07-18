import { bandCampV1, bandCampV2 } from "./fixtures";
import { transitionSession } from "./state-machine";
import { BandFixtureAdapter } from "../source/adapters";
import type { SourceSyncStore } from "../storage/plan-store";
import type { SessionRecord } from "../storage/session-store";

export interface BandSourceChange {
  id: "band_camp_check_in_v2";
  source: "BAND calendar";
  sourceRecordId: "event_band_camp_day_1";
  beforeVersion: 1;
  afterVersion: 2;
  changedAt: string;
  changes: Array<{ field: "checkIn"; before: string; after: string }>;
  before: { wake: string; departure: string; checkIn: string; start: string };
  after: { wake: string; departure: string; checkIn: string; start: string };
}

export class SourceSyncError extends Error {
  readonly code = "SOURCE_SYNC_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "SourceSyncError";
  }
}

export async function syncBandSourceV2(input: {
  session: SessionRecord;
  store: SourceSyncStore;
  now?: () => Date;
  randomUUID?: () => string;
}) {
  if (input.session.role !== "student" || input.session.actorId !== "student_emily") {
    throw new SourceSyncError("The source update is outside this student session.");
  }
  const nextState = transitionSession(input.session.state, {
    type: "SYNC_SOURCE_V2",
    targetSourceVersion: 2
  });
  if (
    nextState.phase !== "SOURCE_V2_SYNCED" ||
    nextState.sourceVersion !== 2 ||
    nextState.activePlanVersion !== 1
  ) {
    throw new SourceSyncError("The source update did not reach the required versioned state.");
  }
  const syncedState = {
    ...nextState,
    phase: "SOURCE_V2_SYNCED" as const,
    sourceVersion: 2 as const,
    activePlanVersion: 1 as const
  };
  const adapter = new BandFixtureAdapter();
  adapter.currentVersion = 1;
  const synced = await adapter.sync(1, 2);
  const now = (input.now ?? (() => new Date()))();
  const changes = synced.data.diff;
  if (
    changes.length !== 1 ||
    changes[0]?.field !== "checkIn" ||
    changes[0].before !== "07:30" ||
    changes[0].after !== "07:15"
  ) {
    throw new SourceSyncError("The controlled source update did not match the Golden Experience fixture.");
  }
  const change: BandSourceChange = {
    id: "band_camp_check_in_v2",
    source: "BAND calendar",
    sourceRecordId: "event_band_camp_day_1",
    beforeVersion: 1,
    afterVersion: 2,
    changedAt: now.toISOString(),
    changes: [{ field: "checkIn", before: "07:30", after: "07:15" }],
    before: {
      wake: bandCampV1.wake,
      departure: bandCampV1.departure,
      checkIn: bandCampV1.checkIn,
      start: bandCampV1.start
    },
    after: {
      wake: bandCampV2.wake,
      departure: bandCampV2.departure,
      checkIn: bandCampV2.checkIn,
      start: bandCampV2.start
    }
  };
  await input.store.syncSourceV2({
    sessionId: input.session.id,
    previousStateVersion: input.session.state.stateVersion,
    nextState: syncedState,
    change,
    syncedAt: now.toISOString(),
    auditEventId: input.randomUUID?.() ?? crypto.randomUUID()
  });
  return {
    session: { ...input.session, state: syncedState, updatedAt: now.toISOString() },
    change
  };
}
