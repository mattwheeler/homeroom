import { z } from "zod";

import { GuardianProjectionError } from "../domain/guardian-projection";
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

const previewRequestSchema = z.object({}).strict();
const publishRequestSchema = z.object({
  actionId: z.string().regex(/^action_[a-f0-9]{24}$/),
  receipt: z.string().min(20).max(256)
}).strict();

interface GuardianHandlerBaseDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
}

export interface GuardianPreviewHandlerDependencies extends GuardianHandlerBaseDependencies {
  preview(session: SessionRecord): Promise<unknown>;
}

export interface GuardianPublishHandlerDependencies extends GuardianHandlerBaseDependencies {
  publish(session: SessionRecord, input: z.infer<typeof publishRequestSchema>): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

async function handleGuardianRequest<T>(input: {
  request: Request;
  dependencies: GuardianHandlerBaseDependencies;
  schema: z.ZodType<T>;
  run(session: SessionRecord, body: T): Promise<unknown>;
  unavailableMessage: string;
}): Promise<Response> {
  try {
    assertSameOrigin(input.request);
    assertJsonRequest(input.request);
    if (!input.dependencies.rateLimiter.consume(input.dependencies.clientKey)) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Please wait a moment before trying again." } },
        429,
        { "retry-after": "30" }
      );
    }
    const declaredLength = Number(input.request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The guardian request is too large." } }, 413);
    }
    let rawBody: unknown;
    try {
      rawBody = await input.request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid guardian request." } }, 400);
    }
    const body = input.schema.parse(rawBody);

    const token = readCookie(input.request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    const now = (input.dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, input.dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "Only Emily can choose what is shared." } }, 403);
    }
    const session = await input.dependencies.store.findById(payload.sessionId);
    if (
      !session ||
      session.role !== "student" ||
      session.actorId !== "student_emily" ||
      Date.parse(session.expiresAt) < now.getTime()
    ) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const csrfToken = input.request.headers.get("x-homeroom-csrf") ?? "";
    if (csrfToken.length > 256 || !(await verifyCsrfToken(csrfToken, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }
    return json(await input.run(session, body), 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid guardian request." } }, 400);
    }
    if (error instanceof ApprovalError) {
      return json(
        {
          error: {
            code: error.code === "APPROVAL_EXPIRED" ? "APPROVAL_EXPIRED" : "APPROVAL_REJECTED",
            message: error.code === "APPROVAL_EXPIRED"
              ? "This sharing approval expired. Preview the guardian view again."
              : "This guardian preview changed or is no longer current."
          }
        },
        error.code === "INVALID_RECEIPT" ? 403 : 409
      );
    }
    if (error instanceof GuardianProjectionError) {
      return json(
        { error: { code: error.code, message: "The guardian view is unavailable or no longer current." } },
        409
      );
    }
    return json(
      { error: { code: "GUARDIAN_UNAVAILABLE", message: input.unavailableMessage } },
      500
    );
  }
}

export function handleGuardianPreview(
  request: Request,
  dependencies: GuardianPreviewHandlerDependencies
): Promise<Response> {
  return handleGuardianRequest({
    request,
    dependencies,
    schema: previewRequestSchema,
    run: (session) => dependencies.preview(session),
    unavailableMessage: "The private guardian preview could not be prepared yet. Please try again."
  });
}

export function handleGuardianPublish(
  request: Request,
  dependencies: GuardianPublishHandlerDependencies
): Promise<Response> {
  return handleGuardianRequest({
    request,
    dependencies,
    schema: publishRequestSchema,
    run: (session, approval) => dependencies.publish(session, approval),
    unavailableMessage: "The approved guardian view could not be shared yet. Please try again."
  });
}
