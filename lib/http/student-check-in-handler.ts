import { z } from "zod";

import type { StudentFocusState } from "../ai/student-check-in-response";
import type { Logger } from "../observability/logger";
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

const requestSchema = z.object({
  focusState: z.enum(["ready", "scattered", "low_energy"]).nullable().optional().default(null),
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(["student", "homeroom"]),
    text: z.string().trim().min(1).max(500)
  }).strict()).max(10).optional().default([])
}).strict();

export interface StudentCheckInInput {
  focusState: StudentFocusState | null;
  message: string;
  history: Array<{ role: "student" | "homeroom"; text: string }>;
}

export interface StudentCheckInHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
  respond(session: SessionRecord, input: StudentCheckInInput): Promise<unknown>;
  logger?: Logger;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", ...headers } });
}

export async function handleStudentCheckIn(
  request: Request,
  dependencies: StudentCheckInHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json({ error: { code: "RATE_LIMITED", message: "Take a short pause before checking in again." } }, 429, { "retry-after": "60" });
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 8_192) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The check-in message is too large." } }, 413);
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid check-in request." } }, 400);
    }
    const input = requestSchema.parse(raw);
    const token = readCookie(request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Open your student workspace first." } }, 401);
    const now = (dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "This check-in belongs to the student workspace." } }, 403);
    }
    const session = await dependencies.store.findById(payload.sessionId);
    if (!session || session.role !== "student" || Date.parse(session.expiresAt) < now.getTime()) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Open your student workspace first." } }, 401);
    }
    if (!(await dependencies.rateLimiter.consume(`${dependencies.clientKey}:session:${session.id}`))) {
      return json({ error: { code: "RATE_LIMITED", message: "Take a short pause before checking in again." } }, 429, { "retry-after": "60" });
    }
    const csrf = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The check-in could not be verified." } }, 403);
    }
    try {
      return json(await dependencies.respond(session, input), 200);
    } catch (error) {
      dependencies.logger?.error("student_check_in_failed", error, { sessionId: session.id });
      return json({ error: { code: "CHECK_IN_UNAVAILABLE", message: "I could not respond just yet. Your recommended next step is still available." } }, 502, { "retry-after": "5" });
    }
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Open your student workspace first." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Enter a short check-in message." } }, 400);
    }
    dependencies.logger?.error("student_check_in_request_failed", error, { clientKey: dependencies.clientKey });
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "The check-in is unavailable right now." } }, 500);
  }
}
