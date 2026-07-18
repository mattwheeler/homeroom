import { z } from "zod";

import { createDemoSession, type DemoSessionDependencies } from "../domain/demo-session";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  serializeSessionCookie
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";

export interface DemoSessionHandlerDependencies extends DemoSessionDependencies {
  rateLimiter: RateLimiter;
  clientKey: string;
  secureCookie: boolean;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

export async function handleCreateDemoSession(
  request: Request,
  dependencies: DemoSessionHandlerDependencies
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
    if (Number.isFinite(declaredLength) && declaredLength > 2_048) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The request is too large." } }, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid demo session request." } }, 400);
    }
    const result = await createDemoSession(body, dependencies);
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
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid demo session request." } }, 400);
    }
    return json(
      { error: { code: "SESSION_UNAVAILABLE", message: "The demo session could not be started." } },
      500
    );
  }
}
