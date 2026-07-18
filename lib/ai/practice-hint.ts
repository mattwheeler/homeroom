import { z } from "zod";

import { algebraExercise, emilyFixture } from "../domain/fixtures";
import type { AiTurnRecord, AiTurnStore } from "../storage/ai-turn-store";
import type { SessionRecord } from "../storage/session-store";
import { ResponsesLoopError, runResponsesTurn, type ResponsesClient } from "./responses-loop";

export const practiceHintSchema = z.object({
  title: z.string().min(1).max(80),
  encouragement: z.string().min(1).max(180),
  question: z.string().min(1).max(220),
  concept: z.literal("inverse operations"),
  answerPolicy: z.literal("hidden")
}).strict();

export type PracticeHint = z.infer<typeof practiceHintSchema>;

const instructions = `You are Homeroom, a calm Algebra I coach for Emily, age 14.
Call get_practice_exercise exactly once. Give one short Socratic hint that asks which inverse operation would remove the outer multiplication.
Do not name the operation, compute an intermediate equation, reveal the final answer, or solve the exercise. The application grades every response.`;

export class PracticeHintError extends Error {
  constructor(readonly code: "CONTEXT_MISMATCH" | "HINT_INVALID" | "ANSWER_REVEALED", message: string) {
    super(message);
    this.name = "PracticeHintError";
  }
}

function responseFormat() {
  return {
    type: "json_schema",
    name: "practice_hint",
    strict: true,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        encouragement: { type: "string" },
        question: { type: "string" },
        concept: { type: "string", enum: ["inverse operations"] },
        answerPolicy: { type: "string", enum: ["hidden"] }
      },
      required: ["title", "encouragement", "question", "concept", "answerPolicy"],
      additionalProperties: false
    }
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateNoAnswerDump(hint: PracticeHint): void {
  const text = `${hint.title} ${hint.encouragement} ${hint.question}`.toLowerCase();
  if (
    /\bx\s*=\s*4\b/.test(text) ||
    /answer\s+(?:is|:)\s*4\b/.test(text) ||
    text.includes("x + 2 = 6") ||
    text.includes("divide both sides by 3")
  ) {
    throw new PracticeHintError("ANSWER_REVEALED", "The generated hint revealed a grader-only step or answer.");
  }
}

function errorCode(error: unknown): string {
  if (error instanceof PracticeHintError || error instanceof ResponsesLoopError) return error.code;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "HINT_INVALID";
  return "MODEL_FAILED";
}

export async function generatePracticeHint(input: {
  session: SessionRecord;
  client: ResponsesClient;
  traceStore: AiTurnStore;
  now?: () => Date;
  clock?: () => number;
  randomUUID?: () => string;
}) {
  if (
    input.session.role !== "student" ||
    input.session.actorId !== "student_emily" ||
    input.session.state.phase !== "PLAN_V2_SAVED" ||
    input.session.state.sourceVersion !== 2 ||
    input.session.state.activePlanVersion !== 2
  ) {
    throw new PracticeHintError("CONTEXT_MISMATCH", "The hint requires Emily's active Plan V2 session.");
  }
  const now = input.now ?? (() => new Date());
  const clock = input.clock ?? (() => performance.now());
  const turnId = input.randomUUID?.() ?? crypto.randomUUID();
  const started = clock();
  let trace: Awaited<ReturnType<typeof runResponsesTurn>>["trace"] | null = null;

  try {
    const result = await runResponsesTurn({
      client: input.client,
      stage: "learning_hint",
      userInput: `Introduce exerciseId=${algebraExercise.id} for sessionId=${input.session.id}.`,
      instructions,
      responseFormat: responseFormat(),
      safetyIdentifier: await sha256Hex(`homeroom:${input.session.actorId}`),
      toolExecutor: async (_name, rawArgs) => {
        const args = rawArgs as { sessionId: string; exerciseId: string };
        if (args.sessionId !== input.session.id || args.exerciseId !== algebraExercise.id) {
          throw new PracticeHintError("CONTEXT_MISMATCH", "The requested exercise did not match the authenticated session.");
        }
        return {
          student: { name: emilyFixture.name, age: emilyFixture.age, grade: emilyFixture.grade },
          exercise: {
            id: algebraExercise.id,
            course: "Algebra I",
            prompt: algebraExercise.prompt,
            targetConcept: "inverse operations"
          },
          instructionalBoundary: {
            hintLevel: "Ask about the inverse of the outer operation without naming it.",
            prohibited: ["intermediate equation", "final answer", "worked solution"],
            deterministicGraderOwnsValidation: true
          }
        };
      }
    });
    trace = result.trace;
    if (
      trace.toolCalls.length !== 1 ||
      trace.toolCalls[0]?.name !== "get_practice_exercise"
    ) {
      throw new PracticeHintError("HINT_INVALID", "The hint did not use exactly one approved exercise lookup.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new PracticeHintError("HINT_INVALID", "The model response was not valid structured JSON.");
    }
    const hint = practiceHintSchema.parse(parsed);
    validateNoAnswerDump(hint);
    const record: AiTurnRecord = {
      id: turnId,
      sessionId: input.session.id,
      stage: "learning_hint",
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
      hint,
      proof: {
        model: trace.model,
        responseIds: trace.responseIds,
        tools: trace.toolCalls.map((call) => call.name),
        exerciseId: algebraExercise.id
      }
    };
  } catch (error) {
    await input.traceStore.record({
      id: turnId,
      sessionId: input.session.id,
      stage: "learning_hint",
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
