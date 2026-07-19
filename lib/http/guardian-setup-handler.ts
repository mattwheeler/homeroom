import { z } from "zod";

import { guardianSetupSettingsSchema } from "../domain/guardian-setup-profile";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie,
  verifyCsrfToken
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import { SessionTokenError, verifySessionToken } from "../security/session-token";
import { GuardianSetupStoreError } from "../storage/guardian-setup-store";
import type { SessionRecord, SessionStore } from "../storage/session-store";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }).strict(),
  z.object({
    action: z.literal("save"),
    expectedVersion: z.number().int().min(0).max(1_000_000),
    settings: guardianSetupSettingsSchema
  }).strict()
]);

type GuardianSetupRequest = z.infer<typeof requestSchema>;

export interface GuardianSetupHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
  read(session: SessionRecord): Promise<unknown>;
  save(
    session: SessionRecord,
    input: Extract<GuardianSetupRequest, { action: "save" }> extends infer T
      ? T extends { expectedVersion: infer V; settings: infer S }
        ? { expectedVersion: V; settings: S }
        : never
      : never
  ): Promise<unknown>;
}

class GuardianSetupAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super("Guardian access is required.");
    this.name = "GuardianSetupAccessError";
  }
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

async function authenticateGuardian(
  request: Request,
  dependencies: Pick<GuardianSetupHandlerDependencies, "store" | "signingSecret" | "now">
): Promise<SessionRecord> {
  const token = readCookie(request, "homeroom_session");
  if (!token) throw new GuardianSetupAccessError(401);
  const now = (dependencies.now ?? (() => new Date()))();
  const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
  if (payload.role !== "guardian") throw new GuardianSetupAccessError(403);
  const session = await dependencies.store.findById(payload.sessionId);
  if (!session || Date.parse(session.expiresAt) < now.getTime()) {
    throw new GuardianSetupAccessError(401);
  }
  if (session.role !== "guardian") {
    throw new GuardianSetupAccessError(403);
  }
  return session;
}

export async function handleGuardianSetup(
  request: Request,
  dependencies: GuardianSetupHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before trying again." } },
        429,
        { "retry-after": "30" }
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The guardian request is too large." } }, 413);
    }
    let body: GuardianSetupRequest;
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid guardian settings request." } }, 400);
    }
    const session = await authenticateGuardian(request, dependencies);
    const csrf = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }
    const result = body.action === "read"
      ? await dependencies.read(session)
      : await dependencies.save(session, {
          expectedVersion: body.expectedVersion,
          settings: body.settings
        });
    return json(result, 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof GuardianSetupAccessError) {
      return json(
        { error: { code: error.status === 401 ? "AUTH_REQUIRED" : "ROLE_NOT_ALLOWED", message: "Guardian access is required." } },
        error.status
      );
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new guardian session." } }, 401);
    }
    if (error instanceof GuardianSetupStoreError && error.code === "STALE_WRITE") {
      return json(
        { error: { code: "SETTINGS_CHANGED", message: "These settings changed. Reload them before saving again." } },
        409
      );
    }
    return json(
      { error: { code: "GUARDIAN_SETUP_UNAVAILABLE", message: "Guardian settings are unavailable right now." } },
      500
    );
  }
}
