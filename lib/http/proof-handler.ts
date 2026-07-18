import { z } from "zod";

import { ProofViewError } from "../domain/proof-view";
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

const openProofRequestSchema = z.object({}).strict();

export interface ProofHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  open(session: SessionRecord): Promise<unknown>;
  now?: () => Date;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

export async function handleOpenProof(
  request: Request,
  dependencies: ProofHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!dependencies.rateLimiter.consume(dependencies.clientKey)) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Please wait a moment before reopening proof." } },
        429,
        { "retry-after": "30" }
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The proof request is too large." } }, 413);
    }
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid proof request." } }, 400);
    }
    openProofRequestSchema.parse(rawBody);

    const token = readCookie(request, "homeroom_session");
    if (!token) return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    const now = (dependencies.now ?? (() => new Date()))();
    const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
    if (payload.role !== "student") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "The proof belongs to Emily's workspace." } }, 403);
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
    return json(await dependencies.open(session), 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid proof request." } }, 400);
    }
    if (error instanceof ProofViewError) {
      return json(
        { error: { code: error.code, message: "The judge proof is unavailable or not ready." } },
        409
      );
    }
    return json(
      { error: { code: "PROOF_UNAVAILABLE", message: "The judge proof could not be opened yet. Please try again." } },
      500
    );
  }
}
