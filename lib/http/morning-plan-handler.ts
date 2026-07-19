import { z } from "zod";

import type { RateLimiter } from "../security/rate-limit";
import { SessionTokenError, verifySessionToken } from "../security/session-token";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie,
  verifyCsrfToken
} from "../security/http";
import type { SessionRecord, SessionStore } from "../storage/session-store";
import type { Logger } from "../observability/logger";

const emptyRequest = z.object({}).strict();

export interface MorningPlanHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  generate(session: SessionRecord): Promise<unknown>;
  now?: () => Date;
  logger?: Logger;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

export async function handleGenerateMorningPlan(
  request: Request,
  dependencies: MorningPlanHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Please wait a moment before trying again." } },
        429,
        { "retry-after": "60" }
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The request is too large." } }, 413);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid morning-plan request." } }, 400);
    }
    emptyRequest.parse(body);

    const token = readCookie(request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    const now = (dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "This action belongs to the student workspace." } }, 403);
    }
    const session = await dependencies.store.findById(payload.sessionId);
    if (
      !session ||
      session.role !== "student" ||
      Date.parse(session.expiresAt) < now.getTime()
    ) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (!(await dependencies.rateLimiter.consume(`${dependencies.clientKey}:session:${session.id}`))) {
      return json({ error: { code: "RATE_LIMITED", message: "Please wait a moment before trying again." } }, 429, { "retry-after": "60" });
    }
    const csrfToken = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrfToken.length > 256 || !(await verifyCsrfToken(csrfToken, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }

    try {
      return json(await dependencies.generate(session), 200);
    } catch (error) {
      dependencies.logger?.error("live_plan_generation_failed", error, { sessionId: session.id });
      return json(
        { error: { code: "PLAN_UNAVAILABLE", message: "I could not build the plan just yet. Please try again." } },
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
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid morning-plan request." } }, 400);
    }
    dependencies.logger?.error("morning_plan_request_failed", error, { clientKey: dependencies.clientKey });
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "The plan service is unavailable." } }, 500);
  }
}
