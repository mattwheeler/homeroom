import { z } from "zod";

import { bandCampV1, bandCampV2, diffBandSource, emilyFixture, guardianAction, packingMaterial } from "../domain/fixtures";
import type { AiTurnRecord, AiTurnStore } from "../storage/ai-turn-store";
import type { SessionRecord } from "../storage/session-store";
import { morningPlanSchema, type MorningPlan } from "./morning-plan";
import { ResponsesLoopError, runResponsesTurn, type ResponsesClient } from "./responses-loop";

export const planRevisionSchema = z.object({
  change: z.object({
    title: z.string().min(1).max(100),
    summary: z.string().min(1).max(260),
    changedField: z.literal("checkIn"),
    before: z.literal("07:30"),
    after: z.literal("07:15"),
    minutesEarlier: z.literal(15),
    sourceLabel: z.string().min(1).max(100)
  }).strict(),
  plan: morningPlanSchema
}).strict();

export type PlanRevision = z.infer<typeof planRevisionSchema>;

const instructions = `You are Homeroom, a calm AI workspace for Emily, a 14-year-old entering ninth grade.
Call get_plan_revision_context exactly once. Explain only the validated BAND calendar change: check-in moved from 07:30 to 07:15.
Propose Plan V2 by shifting wake-up, bag check, departure, and check-in exactly 15 minutes earlier while preserving the 08:00 start, travel time, arrival buffer, packing responsibilities, and Matt's separate physical-form task.
Plan V1 remains active. You cannot save, sync, publish, or replace a plan. Ask Emily to review Plan V2 before it is saved.`;

export class PlanRevisionError extends Error {
  constructor(readonly code: "CONTEXT_MISMATCH" | "REVISION_INVALID", message: string) {
    super(message);
    this.name = "PlanRevisionError";
  }
}

const revisedTimes = ["06:15", "06:30", "06:45", "07:15"] as const;

function responseFormat() {
  return {
    type: "json_schema",
    name: "plan_revision",
    strict: true,
    schema: {
      type: "object",
      properties: {
        change: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            changedField: { type: "string", enum: ["checkIn"] },
            before: { type: "string", enum: ["07:30"] },
            after: { type: "string", enum: ["07:15"] },
            minutesEarlier: { type: "integer", enum: [15] },
            sourceLabel: { type: "string" }
          },
          required: ["title", "summary", "changedField", "before", "after", "minutesEarlier", "sourceLabel"],
          additionalProperties: false
        },
        plan: {
          type: "object",
          properties: {
            title: { type: "string" },
            intro: { type: "string" },
            steps: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  time: { type: "string", enum: revisedTimes },
                  title: { type: "string" },
                  detail: { type: "string" },
                  sourceLabel: { type: "string" }
                },
                required: ["time", "title", "detail", "sourceLabel"],
                additionalProperties: false
              }
            },
            guardianNote: { type: "string" },
            encouragement: { type: "string" },
            approvalPrompt: { type: "string" }
          },
          required: ["title", "intro", "steps", "guardianNote", "encouragement", "approvalPrompt"],
          additionalProperties: false
        }
      },
      required: ["change", "plan"],
      additionalProperties: false
    }
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateRevision(revision: PlanRevision): void {
  if (revision.plan.steps.some((step, index) => step.time !== revisedTimes[index])) {
    throw new PlanRevisionError("REVISION_INVALID", "The revised plan did not preserve the validated source times.");
  }
  if (!revision.plan.guardianNote.includes("Matt")) {
    throw new PlanRevisionError("REVISION_INVALID", "The guardian responsibility was not preserved.");
  }
}

function errorCode(error: unknown): string {
  if (error instanceof PlanRevisionError || error instanceof ResponsesLoopError) return error.code;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "REVISION_INVALID";
  return "MODEL_FAILED";
}

export async function generatePlanRevision(input: {
  session: SessionRecord;
  currentPlan: MorningPlan;
  client: ResponsesClient;
  traceStore: AiTurnStore;
  now?: () => Date;
  clock?: () => number;
  randomUUID?: () => string;
}) {
  if (
    input.session.state.phase !== "SOURCE_V2_SYNCED" ||
    input.session.state.sourceVersion !== 2 ||
    input.session.state.activePlanVersion !== 1
  ) {
    throw new PlanRevisionError("CONTEXT_MISMATCH", "Plan V2 requires a synced source and active Plan V1.");
  }
  const currentPlan = morningPlanSchema.parse(input.currentPlan);
  const now = input.now ?? (() => new Date());
  const clock = input.clock ?? (() => performance.now());
  const turnId = input.randomUUID?.() ?? crypto.randomUUID();
  const started = clock();
  let trace: Awaited<ReturnType<typeof runResponsesTurn>>["trace"] | null = null;

  try {
    const result = await runResponsesTurn({
      client: input.client,
      stage: "plan_revision",
      userInput: `Explain the BAND change and propose Plan V2 for sessionId=${input.session.id} and studentId=${input.session.actorId}.`,
      instructions,
      responseFormat: responseFormat(),
      safetyIdentifier: await sha256Hex(`homeroom:${input.session.actorId}`),
      toolExecutor: async (_name, rawArgs) => {
        const args = rawArgs as { sessionId: string; studentId: string };
        if (args.sessionId !== input.session.id || args.studentId !== input.session.actorId) {
          throw new PlanRevisionError("CONTEXT_MISMATCH", "The requested context did not match the authenticated session.");
        }
        return {
          student: { name: emilyFixture.name, age: emilyFixture.age, grade: emilyFixture.grade },
          activePlan: { planVersion: 1, sourceVersion: 1, plan: currentPlan },
          sourceChange: {
            source: "BAND calendar",
            sourceRecordId: bandCampV2.id,
            beforeVersion: 1,
            afterVersion: 2,
            changes: diffBandSource(bandCampV1, bandCampV2),
            before: bandCampV1,
            after: bandCampV2
          },
          unchangedContext: { packingMaterial, guardianAction },
          policy: { proposalOnly: true, activePlanRemains: 1, requiresStudentApprovalToSave: true }
        };
      }
    });
    trace = result.trace;
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new PlanRevisionError("REVISION_INVALID", "The model response was not valid structured JSON.");
    }
    const validated = planRevisionSchema.safeParse(parsed);
    if (!validated.success) {
      throw new PlanRevisionError("REVISION_INVALID", "The structured revision failed validation.");
    }
    validateRevision(validated.data);
    const record: AiTurnRecord = {
      id: turnId,
      sessionId: input.session.id,
      stage: "plan_revision",
      model: trace.model,
      status: "completed",
      responseIds: trace.responseIds,
      toolTrace: trace.toolCalls,
      latencyMs: Math.max(0, Math.round(clock() - started)),
      inputTokens: trace.usage.inputTokens,
      outputTokens: trace.usage.outputTokens,
      cachedTokens: trace.usage.cachedTokens,
      errorCode: null,
      createdAt: now().toISOString()
    };
    await input.traceStore.record(record);
    return {
      revision: validated.data,
      proof: {
        model: trace.model,
        responseIds: trace.responseIds,
        tools: trace.toolCalls.map((call) => call.name),
        sourceVersion: 2 as const,
        previousPlanVersion: 1 as const
      }
    };
  } catch (error) {
    await input.traceStore.record({
      id: turnId,
      sessionId: input.session.id,
      stage: "plan_revision",
      model: trace?.model ?? "gpt-5.6-sol",
      status: "failed",
      responseIds: trace?.responseIds ?? [],
      toolTrace: trace?.toolCalls ?? [],
      latencyMs: Math.max(0, Math.round(clock() - started)),
      inputTokens: trace?.usage.inputTokens ?? 0,
      outputTokens: trace?.usage.outputTokens ?? 0,
      cachedTokens: trace?.usage.cachedTokens ?? 0,
      errorCode: errorCode(error),
      createdAt: now().toISOString()
    });
    throw error;
  }
}
