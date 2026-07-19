import { z } from "zod";

import { createProductSession, type ProductSessionDependencies } from "../domain/product-session";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  serializeSessionCookie
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import type { Logger } from "../observability/logger";

export interface SessionHandlerDependencies extends ProductSessionDependencies {
  rateLimiter: RateLimiter;
  clientKey: string;
  secureCookie: boolean;
  requireVerifiedIdentity?: boolean;
  logger?: Logger;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

export async function handleCreateSession(
  request: Request,
  dependencies: SessionHandlerDependencies
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
    if (Number.isFinite(declaredLength) && declaredLength > 2_048) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The request is too large." } }, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid session request." } }, 400);
    }
    const requestedRole = body && typeof body === "object" && "role" in body
      ? (body as { role?: unknown }).role
      : null;
    if (dependencies.requireVerifiedIdentity && !dependencies.identity) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Sign in with the linked Google account first." } }, 401);
    }
    if (dependencies.identity && requestedRole !== dependencies.identity.role) {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "This Google account is linked to the other Homeroom workspace." } }, 403);
    }
    const result = await createProductSession(body, dependencies);
    return json(
      {
        sessionId: result.sessionId,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
        phase: result.phase,
        profile: result.profile
      },
      201,
      {
        "set-cookie": serializeSessionCookie(result.sessionToken, {
          secure: dependencies.secureCookie,
          maxAgeSeconds: 7_200
        })
      }
    );
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid session request." } }, 400);
    }
    dependencies.logger?.error("session_create_failed", error, { clientKey: dependencies.clientKey });
    return json(
      { error: { code: "SESSION_UNAVAILABLE", message: "The session could not be started." } },
      500
    );
  }
}
