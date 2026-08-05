import { z } from "zod";

import { establishStudentSession } from "../domain/student-session-lifecycle";
import type { Logger } from "../observability/logger";
import type { VerifiedIdentity } from "../security/identity-token";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie,
  serializeSessionCookie
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import type { PrincipalResolver } from "../storage/principal-store";
import type { ReusableSessionStore } from "../storage/session-store";

const emptyRequest = z.object({}).strict();

export interface StudentBootstrapDependencies {
  store: ReusableSessionStore;
  signingSecret: string;
  identity?: VerifiedIdentity;
  principalResolver: PrincipalResolver;
  rateLimiter: RateLimiter;
  clientKey: string;
  secureCookie: boolean;
  now?: () => Date;
  randomUUID?: () => string;
  randomBytes?: () => Uint8Array;
  logger?: Logger;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers }
  });
}

function sessionCookie(token: string, expiresAt: string, now: Date, secure: boolean): string {
  return serializeSessionCookie(token, {
    secure,
    maxAgeSeconds: Math.max(0, Math.min(7_200, Math.floor((Date.parse(expiresAt) - now.getTime()) / 1_000)))
  });
}

export async function handleStudentBootstrap(
  request: Request,
  dependencies: StudentBootstrapDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before reopening Today." } },
        429,
        { "retry-after": "30" }
      );
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The Today request is too large." } }, 413);
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Today request." } }, 400);
    }
    emptyRequest.parse(raw);

    if (!dependencies.identity) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Sign in with the linked Google account first." } }, 401);
    }
    if (dependencies.identity.role !== "student") {
      return json(
        { error: { code: "ROLE_NOT_ALLOWED", message: "This Google account is linked to the guardian workspace." } },
        403
      );
    }

    const now = (dependencies.now ?? (() => new Date()))();
    const established = await establishStudentSession(readCookie(request, "homeroom_session"), {
      store: dependencies.store,
      signingSecret: dependencies.signingSecret,
      identity: dependencies.identity,
      principalResolver: dependencies.principalResolver,
      now: () => now,
      randomUUID: dependencies.randomUUID,
      randomBytes: dependencies.randomBytes
    });
    const cookie = sessionCookie(
      established.sessionToken,
      established.session.expiresAt,
      now,
      dependencies.secureCookie
    );

    return json(
      {
        csrfToken: established.csrfToken,
        profile: established.profile,
        session: { reused: established.reused, expiresAt: established.session.expiresAt }
      },
      200,
      { "set-cookie": cookie }
    );
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid Today request." } }, 400);
    }
    dependencies.logger?.error("student_bootstrap_failed", error, { clientKey: dependencies.clientKey });
    return json(
      { error: { code: "BOOTSTRAP_UNAVAILABLE", message: "Your Today page could not be opened yet." } },
      500
    );
  }
}
