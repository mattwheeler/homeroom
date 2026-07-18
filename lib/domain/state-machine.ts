export const sessionPhases = [
  "FRESH",
  "PROFILE_SAVED",
  "CONNECTIONS_SAVED",
  "POLICY_SAVED",
  "ORIENTATION_READY",
  "PLAN_PROPOSED",
  "PLAN_EDITED",
  "PLAN_V1_SAVED",
  "SOURCE_V2_SYNCED",
  "PLAN_V2_PROPOSED",
  "PLAN_V2_SAVED",
  "HINT_USED",
  "PRACTICE_COMPLETE",
  "GUARDIAN_PREVIEWED",
  "GUARDIAN_PUBLISHED",
  "COMPLETE"
] as const;

export type SessionPhase = (typeof sessionPhases)[number];

export interface SessionState {
  phase: SessionPhase;
  stateVersion: number;
  sourceVersion: 1 | 2;
  activePlanVersion: 1 | 2 | null;
}

export type SessionAction =
  | { type: "SAVE_PROFILE" }
  | { type: "SAVE_CONNECTIONS" }
  | { type: "SAVE_PRIVACY_POLICY" }
  | { type: "LOAD_ORIENTATION" }
  | { type: "PROPOSE_PLAN" }
  | { type: "EDIT_PLAN" }
  | { type: "APPROVE_PLAN_V1"; approvalVerified?: boolean }
  | { type: "SYNC_SOURCE_V2"; targetSourceVersion?: number }
  | { type: "PROPOSE_PLAN_V2" }
  | { type: "APPROVE_PLAN_V2"; approvalVerified?: boolean }
  | { type: "REQUEST_HINT" }
  | { type: "COMPLETE_PRACTICE"; graderVerified?: boolean }
  | { type: "PREVIEW_GUARDIAN" }
  | { type: "PUBLISH_GUARDIAN"; approvalVerified?: boolean }
  | { type: "OPEN_PROOF" };

const transitionMap: Record<SessionPhase, SessionAction["type"] | null> = {
  FRESH: "SAVE_PROFILE",
  PROFILE_SAVED: "SAVE_CONNECTIONS",
  CONNECTIONS_SAVED: "SAVE_PRIVACY_POLICY",
  POLICY_SAVED: "LOAD_ORIENTATION",
  ORIENTATION_READY: "PROPOSE_PLAN",
  PLAN_PROPOSED: "EDIT_PLAN",
  PLAN_EDITED: "APPROVE_PLAN_V1",
  PLAN_V1_SAVED: "SYNC_SOURCE_V2",
  SOURCE_V2_SYNCED: "PROPOSE_PLAN_V2",
  PLAN_V2_PROPOSED: "APPROVE_PLAN_V2",
  PLAN_V2_SAVED: "REQUEST_HINT",
  HINT_USED: "COMPLETE_PRACTICE",
  PRACTICE_COMPLETE: "PREVIEW_GUARDIAN",
  GUARDIAN_PREVIEWED: "PUBLISH_GUARDIAN",
  GUARDIAN_PUBLISHED: "OPEN_PROOF",
  COMPLETE: null
};

const nextPhase: Record<SessionAction["type"], SessionPhase> = {
  SAVE_PROFILE: "PROFILE_SAVED",
  SAVE_CONNECTIONS: "CONNECTIONS_SAVED",
  SAVE_PRIVACY_POLICY: "POLICY_SAVED",
  LOAD_ORIENTATION: "ORIENTATION_READY",
  PROPOSE_PLAN: "PLAN_PROPOSED",
  EDIT_PLAN: "PLAN_EDITED",
  APPROVE_PLAN_V1: "PLAN_V1_SAVED",
  SYNC_SOURCE_V2: "SOURCE_V2_SYNCED",
  PROPOSE_PLAN_V2: "PLAN_V2_PROPOSED",
  APPROVE_PLAN_V2: "PLAN_V2_SAVED",
  REQUEST_HINT: "HINT_USED",
  COMPLETE_PRACTICE: "PRACTICE_COMPLETE",
  PREVIEW_GUARDIAN: "GUARDIAN_PREVIEWED",
  PUBLISH_GUARDIAN: "GUARDIAN_PUBLISHED",
  OPEN_PROOF: "COMPLETE"
};

export class StateTransitionError extends Error {
  readonly code = "STATE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export function createInitialSessionState(): SessionState {
  return { phase: "FRESH", stateVersion: 1, sourceVersion: 1, activePlanVersion: null };
}

export function transitionSession(state: SessionState, action: SessionAction): SessionState {
  const allowed = transitionMap[state.phase];
  if (allowed !== action.type) {
    throw new StateTransitionError(
      "Action " + action.type + " is not allowed from " + state.phase + ". Expected " + (allowed ?? "none") + "."
    );
  }
  if (
    (action.type === "APPROVE_PLAN_V1" ||
      action.type === "APPROVE_PLAN_V2" ||
      action.type === "PUBLISH_GUARDIAN") &&
    !action.approvalVerified
  ) {
    throw new StateTransitionError("A verified approval is required for this write.");
  }
  if (action.type === "COMPLETE_PRACTICE" && !action.graderVerified) {
    throw new StateTransitionError("Deterministic grading is required before completion.");
  }
  if (action.type === "SYNC_SOURCE_V2" && action.targetSourceVersion !== 2) {
    throw new StateTransitionError("The controlled source transition must target version 2.");
  }

  const updated: SessionState = {
    ...state,
    phase: nextPhase[action.type],
    stateVersion: state.stateVersion + 1
  };
  if (action.type === "APPROVE_PLAN_V1") updated.activePlanVersion = 1;
  if (action.type === "SYNC_SOURCE_V2") updated.sourceVersion = 2;
  if (action.type === "APPROVE_PLAN_V2") updated.activePlanVersion = 2;
  return updated;
}
