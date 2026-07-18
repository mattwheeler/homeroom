import { z } from "zod";

import { PlanApprovalError } from "../domain/plan-approval";
import { ApprovalError } from "../security/approval";
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

const approveRequest = z.object({
  actionId: z.string().regex(/^action_[a-f0-9]{24}$/),
  receipt: z.string().min(20).max(256)
}).strict();

export interface PlanApprovalHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  approve(session: SessionRecord, input: z.infer<typeof approveRequest>): Promise<unknown>;
  now?: () => Date;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

export async function handleApprovePlanV1(
  request: Request,
  dependencies: PlanApprovalHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!dependencies.rateLimiter.consume(dependencies.clientKey)) {
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
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid approval request." } }, 400);
    }
    const approval = approveRequest.parse(body);

    const token = readCookie(request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    const now = (dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "Only Emily can approve her personal plan." } }, 403);
    }
    const session = await dependencies.store.findById(payload.sessionId);
    if (
      !session ||
      session.role !== "student" ||
      session.actorId !== "student_emily" ||
      Date.parse(session.expiresAt) < now.getTime()
    ) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const csrfToken = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrfToken.length > 256 || !(await verifyCsrfToken(csrfToken, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }
    return json(await dependencies.approve(session, approval), 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid approval request." } }, 400);
    }
    if (error instanceof ApprovalError) {
      const expired = error.code === "APPROVAL_EXPIRED";
      return json({
        error: {
          code: expired ? "APPROVAL_EXPIRED" : "APPROVAL_REJECTED",
          message: expired
            ? "This approval expired. Build a fresh proposal to continue."
            : "This proposal changed or is no longer current."
        }
      }, error.code === "INVALID_RECEIPT" ? 403 : 409);
    }
    if (error instanceof PlanApprovalError) {
      return json({
        error: { code: "APPROVAL_REJECTED", message: "This proposal is unavailable or no longer current." }
      }, 409);
    }
    // Errors may cross runtime boundaries without preserving instanceof.
    if (
      typeof error === "object" && error !== null &&
      "code" in error && error.code === "APPROVAL_EXPIRED"
    ) {
      return json({
        error: { code: "APPROVAL_EXPIRED", message: "This approval expired. Build a fresh proposal to continue." }
      }, 409);
    }
    return json(
      { error: { code: "SAVE_UNAVAILABLE", message: "Your plan could not be saved just yet. Please try again." } },
      500
    );
  }
}
