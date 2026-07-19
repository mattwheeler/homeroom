import { z } from "zod";

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

const emptySchema = z.object({}).strict();

export interface StudentProjectionDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
  projection(session: SessionRecord, now: Date): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers }
  });
}

export async function handleStudentProjection(
  request: Request,
  dependencies: StudentProjectionDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before refreshing your plan." } },
        429,
        { "retry-after": "30" }
      );
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The projection request is too large." } }, 413);
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid projection request." } }, 400);
    }
    emptySchema.parse(raw);

    const token = readCookie(request, "homeroom_session");
    if (!token) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const now = dependencies.now ? dependencies.now() : new Date();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json(
        { error: { code: "ROLE_NOT_ALLOWED", message: "This plan belongs to the student workspace." } },
        403
      );
    }
    const session = await dependencies.store.findById(payload.sessionId);
    if (
      !session ||
      session.role !== "student" ||
      Date.parse(session.expiresAt) < now.getTime()
    ) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const csrf = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json(
        { error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } },
        403
      );
    }
    try {
      return json(await dependencies.projection(session, now), 200);
    } catch {
      return json(
        { error: { code: "PROJECTION_UNAVAILABLE", message: "Your live school plan could not be refreshed yet." } },
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
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid projection request." } }, 400);
    }
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Your live school plan is unavailable." } }, 500);
  }
}
