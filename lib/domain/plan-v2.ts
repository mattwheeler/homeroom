import { morningPlanSchema, type MorningPlan } from "../ai/morning-plan";
import type { PlanV2Store } from "../storage/plan-store";
import type { SessionRecord } from "../storage/session-store";
import { stagePlanV2Proposal } from "./plan-approval";
import { syncBandSourceV2 } from "./source-sync";
import { StateTransitionError } from "./state-machine";

interface GeneratedPlanRevision {
  revision: { plan: MorningPlan };
}

export async function preparePlanV2Proposal<TGenerated extends GeneratedPlanRevision>(input: {
  session: SessionRecord;
  store: PlanV2Store;
  generate: (session: SessionRecord, currentPlan: MorningPlan) => Promise<TGenerated>;
  now?: () => Date;
  randomUUID?: () => string;
  nonce?: string;
}) {
  let syncedSession: SessionRecord;
  if (input.session.state.phase === "PLAN_V1_SAVED") {
    syncedSession = (await syncBandSourceV2({
      session: input.session,
      store: input.store,
      now: input.now,
      randomUUID: input.randomUUID
    })).session;
  } else if (input.session.state.phase === "SOURCE_V2_SYNCED") {
    syncedSession = input.session;
  } else {
    throw new StateTransitionError("Plan V2 can only be proposed after Plan V1 is saved.");
  }

  const currentPlanValue = await input.store.findApprovedPlan(syncedSession.id, 1);
  if (!currentPlanValue) {
    throw new StateTransitionError("Approved Plan V1 could not be found.");
  }
  const currentPlan = morningPlanSchema.parse(currentPlanValue);
  const generated = await input.generate(syncedSession, currentPlan);
  const proposedPlan = morningPlanSchema.parse(generated.revision.plan);
  const staged = await stagePlanV2Proposal({
    session: syncedSession,
    plan: proposedPlan,
    store: input.store,
    now: input.now,
    nonce: input.nonce
  });
  return { ...generated, ...staged };
}
