import { z } from "zod";

import { LearningSessionError } from "../domain/learning-session";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie,
  verifyCsrfToken
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import { SessionTokenError, verifySessionToken } from "../security/session-token";
import type { SessionRecord, SessionStore } from "../storage/session-store";

const courseIdSchema = z.enum([
  "course_english_1",
  "course_algebra_1",
  "course_biology",
  "course_world_geography",
  "course_band",
  "course_art_1",
  "course_spanish_1"
]);
const learningSessionIdSchema = z.string().regex(/^learning_[a-f0-9]{24}$/);
const startSchema = z.object({
  courseId: courseIdSchema,
  durationMinutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  supportPreference: z.enum(["example_first", "questions_first", "mix_it_up"])
}).strict();
const turnSchema = z.object({
  learningSessionId: learningSessionIdSchema,
  response: z.string().trim().min(1).max(500)
}).strict();
const completeSchema = z.object({ learningSessionId: learningSessionIdSchema }).strict();
const contextSchema = z.object({ courseId: courseIdSchema }).strict();
const deleteSignalSchema = z.object({
  signalId: z.string().regex(/^signal_[a-f0-9]{24}$/)
}).strict();

interface BaseDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
}

export interface StartLearningDependencies extends BaseDependencies {
  start(session: SessionRecord, input: z.infer<typeof startSchema>): Promise<unknown>;
}

export interface LearningTurnDependencies extends BaseDependencies {
  turn(session: SessionRecord, input: z.infer<typeof turnSchema>): Promise<unknown>;
}

export interface CompleteLearningDependencies extends BaseDependencies {
  complete(session: SessionRecord, input: z.infer<typeof completeSchema>): Promise<unknown>;
}

export interface LearningContextDependencies extends BaseDependencies {
  context(session: SessionRecord, input: z.infer<typeof contextSchema>): Promise<unknown>;
}

export interface DeleteLearnerSignalDependencies extends BaseDependencies {
  deleteSignal(session: SessionRecord, input: z.infer<typeof deleteSignalSchema>): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

async function handleLearningRequest<T>(input: {
  request: Request;
  dependencies: BaseDependencies;
  schema: z.ZodType<T>;
  run(session: SessionRecord, body: T): Promise<unknown>;
}): Promise<Response> {
  try {
    assertSameOrigin(input.request);
    assertJsonRequest(input.request);
    if (!(await input.dependencies.rateLimiter.consume(input.dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before continuing." } },
        429,
        { "retry-after": "30" }
      );
    }
    const length = Number(input.request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 4_096) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The Learning response is too large." } }, 413);
    }
    let raw: unknown;
    try {
      raw = await input.request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Learning request." } }, 400);
    }
    const body = input.schema.parse(raw);
    const token = readCookie(input.request, "homeroom_session");
    if (!token) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const now = (input.dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, input.dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json(
        { error: { code: "ROLE_NOT_ALLOWED", message: "Learning belongs to the student workspace." } },
        403
      );
    }
    const session = await input.dependencies.store.findById(payload.sessionId);
    if (
      !session ||
      session.role !== "student" ||
      Date.parse(session.expiresAt) < now.getTime()
    ) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (!(await input.dependencies.rateLimiter.consume(`${input.dependencies.clientKey}:session:${session.id}`))) {
      return json({ error: { code: "RATE_LIMITED", message: "Take a short pause before continuing." } }, 429, { "retry-after": "30" });
    }
    const csrf = input.request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json(
        { error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } },
        403
      );
    }
    try {
      return json(await input.run(session, body), 200);
    } catch (error) {
      if (error instanceof LearningSessionError) {
        return json({ error: { code: error.code, message: error.message } }, 409);
      }
      return json(
        { error: { code: "LEARNING_UNAVAILABLE", message: "The Learning session could not continue yet." } },
        502,
        { "retry-after": "5" }
      );
    }
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Learning request." } }, 400);
    }
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Learning is unavailable." } }, 500);
  }
}

export function handleStartLearning(request: Request, dependencies: StartLearningDependencies) {
  return handleLearningRequest({
    request,
    dependencies,
    schema: startSchema,
    run: (session, body) => dependencies.start(session, body)
  });
}

export function handleLearningTurn(request: Request, dependencies: LearningTurnDependencies) {
  return handleLearningRequest({
    request,
    dependencies,
    schema: turnSchema,
    run: (session, body) => dependencies.turn(session, body)
  });
}

export function handleCompleteLearning(
  request: Request,
  dependencies: CompleteLearningDependencies
) {
  return handleLearningRequest({
    request,
    dependencies,
    schema: completeSchema,
    run: (session, body) => dependencies.complete(session, body)
  });
}

export function handleLearningContext(
  request: Request,
  dependencies: LearningContextDependencies
) {
  return handleLearningRequest({
    request,
    dependencies,
    schema: contextSchema,
    run: (session, body) => dependencies.context(session, body)
  });
}

export function handleDeleteLearnerSignal(
  request: Request,
  dependencies: DeleteLearnerSignalDependencies
) {
  return handleLearningRequest({
    request,
    dependencies,
    schema: deleteSignalSchema,
    run: (session, body) => dependencies.deleteSignal(session, body)
  });
}
