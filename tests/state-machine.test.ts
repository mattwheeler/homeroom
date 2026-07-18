import { describe, expect, it } from "vitest";
import {
  StateTransitionError,
  createInitialSessionState,
  transitionSession
} from "../lib/domain/state-machine";

describe("golden-path state machine", () => {
  it("starts with immutable fixture source version one", () => {
    expect(createInitialSessionState()).toEqual({
      phase: "FRESH",
      stateVersion: 1,
      sourceVersion: 1,
      activePlanVersion: null
    });
  });

  it("rejects out-of-order actions without mutation", () => {
    const state = createInitialSessionState();
    expect(() => transitionSession(state, { type: "LOAD_ORIENTATION" })).toThrowError(
      StateTransitionError
    );
    expect(state.phase).toBe("FRESH");
  });

  it("requires verified approval for plan writes", () => {
    let state = createInitialSessionState();
    for (const type of [
      "SAVE_PROFILE",
      "SAVE_CONNECTIONS",
      "SAVE_PRIVACY_POLICY",
      "LOAD_ORIENTATION",
      "PROPOSE_PLAN"
    ] as const) {
      state = transitionSession(state, { type });
    }
    expect(() => transitionSession(state, { type: "APPROVE_PLAN_V1" })).toThrowError(
      /approval/i
    );
    expect(
      transitionSession(state, { type: "APPROVE_PLAN_V1", approvalVerified: true })
    ).toMatchObject({ phase: "PLAN_V1_SAVED", activePlanVersion: 1 });
  });

  it("supports optional edits without requiring an edit to approve an unchanged proposal", () => {
    let state = createInitialSessionState();
    for (const type of [
      "SAVE_PROFILE",
      "SAVE_CONNECTIONS",
      "SAVE_PRIVACY_POLICY",
      "LOAD_ORIENTATION",
      "PROPOSE_PLAN",
      "EDIT_PLAN"
    ] as const) state = transitionSession(state, { type });

    expect(
      transitionSession(state, { type: "APPROVE_PLAN_V1", approvalVerified: true })
    ).toMatchObject({ phase: "PLAN_V1_SAVED", activePlanVersion: 1 });
  });

  it("syncs source version two without changing plan version one", () => {
    let state = createInitialSessionState();
    const actions = [
      { type: "SAVE_PROFILE" },
      { type: "SAVE_CONNECTIONS" },
      { type: "SAVE_PRIVACY_POLICY" },
      { type: "LOAD_ORIENTATION" },
      { type: "PROPOSE_PLAN" },
      { type: "EDIT_PLAN" },
      { type: "APPROVE_PLAN_V1", approvalVerified: true },
      { type: "SYNC_SOURCE_V2", targetSourceVersion: 2 }
    ] as const;
    for (const action of actions) state = transitionSession(state, action);
    expect(state).toMatchObject({
      phase: "SOURCE_V2_SYNCED",
      sourceVersion: 2,
      activePlanVersion: 1
    });
  });

  it("enforces grading and completes the approved golden path", () => {
    let state = createInitialSessionState();
    const actions = [
      { type: "SAVE_PROFILE" },
      { type: "SAVE_CONNECTIONS" },
      { type: "SAVE_PRIVACY_POLICY" },
      { type: "LOAD_ORIENTATION" },
      { type: "PROPOSE_PLAN" },
      { type: "EDIT_PLAN" },
      { type: "APPROVE_PLAN_V1", approvalVerified: true },
      { type: "SYNC_SOURCE_V2", targetSourceVersion: 2 },
      { type: "PROPOSE_PLAN_V2" },
      { type: "APPROVE_PLAN_V2", approvalVerified: true },
      { type: "REQUEST_HINT" }
    ] as const;
    for (const action of actions) state = transitionSession(state, action);
    expect(() => transitionSession(state, { type: "COMPLETE_PRACTICE" })).toThrow(/grading/i);
    state = transitionSession(state, { type: "COMPLETE_PRACTICE", graderVerified: true });
    state = transitionSession(state, { type: "PREVIEW_GUARDIAN" });
    expect(() => transitionSession(state, { type: "PUBLISH_GUARDIAN" })).toThrow(/approval/i);
    state = transitionSession(state, { type: "PUBLISH_GUARDIAN", approvalVerified: true });
    state = transitionSession(state, { type: "OPEN_PROOF" });
    expect(state).toMatchObject({ phase: "COMPLETE", activePlanVersion: 2, sourceVersion: 2 });
  });

  it("rejects a source sync that does not target fixture version two", () => {
    let state = createInitialSessionState();
    for (const action of [
      { type: "SAVE_PROFILE" },
      { type: "SAVE_CONNECTIONS" },
      { type: "SAVE_PRIVACY_POLICY" },
      { type: "LOAD_ORIENTATION" },
      { type: "PROPOSE_PLAN" },
      { type: "EDIT_PLAN" },
      { type: "APPROVE_PLAN_V1", approvalVerified: true }
    ] as const) state = transitionSession(state, action);
    expect(() => transitionSession(state, { type: "SYNC_SOURCE_V2", targetSourceVersion: 3 })).toThrow(/version 2/i);
  });
});
