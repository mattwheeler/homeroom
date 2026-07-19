import { z } from "zod";

import { PracticeDomainError, type PracticeAttempt } from "../domain/practice";
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

const startRequestSchema = z.object({}).strict();
const attemptRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("first_step"),
    answer: z.enum(["divide_both_sides_by_3", "subtract_3", "multiply_both_sides_by_3"])
  }).strict(),
  z.object({
    kind: z.literal("final_answer"),
    answer: z.string().trim().min(1).max(16).regex(/^-?\d+(?:\.\d+)?$/)
  }).strict()
]);

interface PracticeHandlerBaseDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
}

export interface StartPracticeHandlerDependencies extends PracticeHandlerBaseDependencies {
  start(session: SessionRecord): Promise<unknown>;
}

export interface PracticeAttemptHandlerDependencies extends PracticeHandlerBaseDependencies {
  attempt(session: SessionRecord, attempt: PracticeAttempt): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

async function handlePracticeRequest<T>(input: {
  request: Request;
  dependencies: PracticeHandlerBaseDependencies;
  schema: z.ZodType<T>;
  run(session: SessionRecord, body: T): Promise<unknown>;
  unavailableMessage: string;
}): Promise<Response> {
  try {
    assertSameOrigin(input.request);
    assertJsonRequest(input.request);
    if (!(await input.dependencies.rateLimiter.consume(input.dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before trying again." } },
        429,
        { "retry-after": "30" }
      );
    }
    const declaredLength = Number(input.request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 2_048) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The practice response is too large." } }, 413);
    }
    let rawBody: unknown;
    try {
      rawBody = await input.request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid practice request." } }, 400);
    }
    const body = input.schema.parse(rawBody);

    const token = readCookie(input.request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    const now = (input.dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, input.dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "This practice belongs to the student workspace." } }, 403);
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
      return json({ error: { code: "RATE_LIMITED", message: "Take a short pause before trying again." } }, 429, { "retry-after": "30" });
    }
    const csrfToken = input.request.headers.get("x-homeroom-csrf") ?? "";
    if (csrfToken.length > 256 || !(await verifyCsrfToken(csrfToken, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }

    try {
      return json(await input.run(session, body), 200);
    } catch (error) {
      if (error instanceof PracticeDomainError) {
        return json({ error: { code: error.code, message: error.message } }, 409);
      }
      return json(
        { error: { code: "PRACTICE_UNAVAILABLE", message: input.unavailableMessage } },
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
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid practice request." } }, 400);
    }
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "The practice service is unavailable." } }, 500);
  }
}

export function handleStartPractice(
  request: Request,
  dependencies: StartPracticeHandlerDependencies
): Promise<Response> {
  return handlePracticeRequest({
    request,
    dependencies,
    schema: startRequestSchema,
    run: (session) => dependencies.start(session),
    unavailableMessage: "I could not prepare the Algebra hint yet. Please try again."
  });
}

export function handlePracticeAttempt(
  request: Request,
  dependencies: PracticeAttemptHandlerDependencies
): Promise<Response> {
  return handlePracticeRequest({
    request,
    dependencies,
    schema: attemptRequestSchema,
    run: (session, attempt) => dependencies.attempt(session, attempt),
    unavailableMessage: "I could not check that step yet. Please try again."
  });
}
