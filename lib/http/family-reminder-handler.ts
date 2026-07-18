import { z } from "zod";

import { ApprovalError } from "../security/approval";
import { FamilyReminderError } from "../domain/family-reminder";
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

const previewSchema = z.object({}).strict();
const sendSchema = z.object({
  actionId: z.string().regex(/^action_[a-f0-9]{24}$/),
  receipt: z.string().min(20).max(256)
}).strict();

interface BaseDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
}

export interface PreviewFamilyDependencies extends BaseDependencies {
  preview(session: SessionRecord): Promise<unknown>;
}

export interface SendFamilyDependencies extends BaseDependencies {
  send(session: SessionRecord, approval: z.infer<typeof sendSchema>): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

async function handle<T>(
  request: Request,
  dependencies: BaseDependencies,
  schema: z.ZodType<T>,
  run: (session: SessionRecord, body: T) => Promise<unknown>
) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!dependencies.rateLimiter.consume(dependencies.clientKey)) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Please wait before trying again." } },
        429,
        { "retry-after": "30" }
      );
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 1_024) {
      return json(
        { error: { code: "BODY_TOO_LARGE", message: "The Family request is too large." } },
        413
      );
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Family request." } }, 400);
    }
    const body = schema.parse(raw);
    const token = readCookie(request, "homeroom_session");
    if (!token) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    const now = (dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json(
        { error: { code: "ROLE_NOT_ALLOWED", message: "Only Emily can send this reminder." } },
        403
      );
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
    const csrf = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json(
        { error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } },
        403
      );
    }
    return json(await run(session, body), 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Family request." } }, 400);
    }
    if (error instanceof ApprovalError) {
      return json(
        {
          error: {
            code: "APPROVAL_REJECTED",
            message: "The reminder changed or is no longer current."
          }
        },
        error.code === "INVALID_RECEIPT" ? 403 : 409
      );
    }
    if (error instanceof FamilyReminderError) {
      return json(
        { error: { code: error.code, message: "The Family reminder is unavailable." } },
        409
      );
    }
    return json(
      {
        error: {
          code: "FAMILY_UNAVAILABLE",
          message: "The Family reminder could not be completed yet."
        }
      },
      500
    );
  }
}

export function handlePreviewFamilyReminder(
  request: Request,
  dependencies: PreviewFamilyDependencies
) {
  return handle(request, dependencies, previewSchema, (session) => dependencies.preview(session));
}

export function handleSendFamilyReminder(
  request: Request,
  dependencies: SendFamilyDependencies
) {
  return handle(
    request,
    dependencies,
    sendSchema,
    (session, approval) => dependencies.send(session, approval)
  );
}
