import { z } from "zod";

import type { Logger } from "../observability/logger";
import {
  assertJsonRequest,
  assertSameOrigin,
  clearSessionCookie,
  constantTimeEqual,
  HttpSecurityError,
  serializeIdentityCookie
} from "../security/http";
import { signIdentityToken } from "../security/identity-token";
import type { RateLimiter } from "../security/rate-limit";

const requestSchema = z.object({
  role: z.enum(["student", "guardian"]),
  code: z.string().min(1).max(256)
}).strict();

export interface JudgeAccessDependencies {
  accessCode: string;
  signingSecret: string;
  studentEmail: string;
  guardianEmail: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  secureCookie: boolean;
  now?: () => number;
  logger?: Logger;
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "private, no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

export async function handleJudgeAccess(
  request: Request,
  dependencies: JudgeAccessDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Wait a moment before trying the review code again." } },
        429,
        { "retry-after": "300" }
      );
    }
    if (dependencies.accessCode.length < 24 || dependencies.signingSecret.length < 32) {
      return json(
        { error: { code: "SERVICE_NOT_CONFIGURED", message: "Build Week review access is not configured." } },
        503
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The review request is too large." } }, 413);
    }

    let body: z.infer<typeof requestSchema>;
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Enter the review code and choose a workspace." } }, 400);
    }
    if (!constantTimeEqual(body.code, dependencies.accessCode)) {
      return json({ error: { code: "ACCESS_DENIED", message: "That review code was not recognized." } }, 403);
    }

    const now = (dependencies.now ?? Date.now)();
    const maxAgeSeconds = 2 * 60 * 60;
    const identityToken = await signIdentityToken(
      {
        provider: "judge",
        subject: `openai-build-week-judge-v1:${body.role}`,
        email: body.role === "student" ? dependencies.studentEmail : dependencies.guardianEmail,
        role: body.role
      },
      dependencies.signingSecret,
      now + maxAgeSeconds * 1_000
    );
    const headers = new Headers();
    headers.append("set-cookie", serializeIdentityCookie(identityToken, {
      secure: dependencies.secureCookie,
      maxAgeSeconds
    }));
    headers.append("set-cookie", clearSessionCookie(dependencies.secureCookie));
    return json(
      { redirectPath: body.role === "student" ? "/student" : "/guardian" },
      200,
      headers
    );
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    dependencies.logger?.error("judge_access_failed", error, { clientKey: dependencies.clientKey });
    return json(
      { error: { code: "ACCESS_UNAVAILABLE", message: "Build Week review access is unavailable." } },
      500
    );
  }
}
