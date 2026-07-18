import { z } from "zod";

import { SourceConnectionError } from "../domain/source-connections";
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
import type { SourceSnapshot } from "../storage/source-connection-store";

const emptySchema = z.object({}).strict();
const bandSchema = z.object({
  calendarUrl: z.string().trim().min(1).max(2_048),
  displayName: z.string().trim().min(1).max(80)
}).strict();
const syncSchema = z.object({
  provider: z.enum(["google_classroom", "band_ical"])
}).strict();

interface BaseDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
}

interface AuthenticatedRequest<T> {
  session: SessionRecord;
  sessionToken: string;
  body: T;
}

export interface SourceStatusDependencies extends BaseDependencies {
  snapshot(session: SessionRecord): Promise<SourceSnapshot>;
}

export interface GoogleStartDependencies extends BaseDependencies {
  start(session: SessionRecord): Promise<unknown>;
}

export interface BandConnectionDependencies extends BaseDependencies {
  connect(session: SessionRecord, input: z.infer<typeof bandSchema>): Promise<unknown>;
}

export interface SourceSyncDependencies extends BaseDependencies {
  sync(session: SessionRecord, input: z.infer<typeof syncSchema>): Promise<unknown>;
}

export interface GoogleCallbackDependencies {
  store: SessionStore;
  signingSecret: string;
  now?: () => Date;
  complete(
    session: SessionRecord,
    input: { state: string; code: string }
  ): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers }
  });
}

function oauthCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `homeroom_oauth_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/integrations/google/callback",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function authenticateStudent(
  request: Request,
  dependencies: Pick<BaseDependencies, "store" | "signingSecret" | "now">,
  cookieName: "homeroom_session" | "homeroom_oauth_session"
): Promise<{ session: SessionRecord; sessionToken: string }> {
  const sessionToken = readCookie(request, cookieName);
  if (!sessionToken) {
    throw new SessionTokenError("INVALID_SESSION", "A Homeroom session is required.");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const payload = await verifySessionToken(sessionToken, dependencies.signingSecret, now.getTime());
  if (payload.role !== "student") {
    throw new SourceConnectionError(
      "SOURCE_SCOPE_MISMATCH",
      "Source connections belong to the student workspace."
    );
  }
  const session = await dependencies.store.findById(payload.sessionId);
  if (
    !session ||
    session.role !== "student" ||
    session.actorId !== "student_emily" ||
    Date.parse(session.expiresAt) < now.getTime()
  ) {
    throw new SessionTokenError("SESSION_EXPIRED", "The Homeroom session is no longer active.");
  }
  return { session, sessionToken };
}

async function readStudentJson<T>(input: {
  request: Request;
  dependencies: BaseDependencies;
  schema: z.ZodType<T>;
}): Promise<AuthenticatedRequest<T> | Response> {
  try {
    assertSameOrigin(input.request);
    assertJsonRequest(input.request);
    if (!input.dependencies.rateLimiter.consume(input.dependencies.clientKey)) {
      return json(
        { error: { code: "RATE_LIMITED", message: "Take a short pause before trying again." } },
        429,
        { "retry-after": "30" }
      );
    }
    const length = Number(input.request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 4_096) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The source request is too large." } }, 413);
    }
    let raw: unknown;
    try {
      raw = await input.request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid source request." } }, 400);
    }
    const body = input.schema.parse(raw);
    const authenticated = await authenticateStudent(input.request, input.dependencies, "homeroom_session");
    const csrf = input.request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, authenticated.session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }
    return { ...authenticated, body };
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new Homeroom session." } }, 401);
    }
    if (error instanceof SourceConnectionError && error.code === "SOURCE_SCOPE_MISMATCH") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: error.message } }, 403);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_REQUEST", message: "Invalid source request." } }, 400);
    }
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Sources are unavailable." } }, 500);
  }
}

async function runSource<T>(run: () => Promise<T>): Promise<Response> {
  try {
    return json(await run(), 200);
  } catch (error) {
    if (error instanceof SourceConnectionError) {
      return json({ error: { code: error.code, message: error.message } }, 409);
    }
    return json(
      { error: { code: "SOURCE_UNAVAILABLE", message: "The read-only source could not be updated yet." } },
      502,
      { "retry-after": "5" }
    );
  }
}

export async function handleSourceStatus(request: Request, dependencies: SourceStatusDependencies) {
  const authenticated = await readStudentJson({ request, dependencies, schema: emptySchema });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.snapshot(authenticated.session));
}

export async function handleGoogleClassroomStart(request: Request, dependencies: GoogleStartDependencies) {
  const authenticated = await readStudentJson({ request, dependencies, schema: emptySchema });
  if (authenticated instanceof Response) return authenticated;
  const response = await runSource(() => dependencies.start(authenticated.session));
  if (response.ok) {
    response.headers.set(
      "set-cookie",
      oauthCookie(authenticated.sessionToken, new URL(request.url).protocol === "https:", 10 * 60)
    );
  }
  return response;
}

export async function handleBandCalendarConnection(
  request: Request,
  dependencies: BandConnectionDependencies
) {
  const authenticated = await readStudentJson({ request, dependencies, schema: bandSchema });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.connect(authenticated.session, authenticated.body));
}

export async function handleSourceSync(request: Request, dependencies: SourceSyncDependencies) {
  const authenticated = await readStudentJson({ request, dependencies, schema: syncSchema });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.sync(authenticated.session, authenticated.body));
}

function callbackRedirect(request: Request, result: string, clearCookie = true): Response {
  const location = new URL(`/?source=${result}#sources`, new URL(request.url).origin);
  const headers = new Headers({ location: location.toString(), "cache-control": "no-store" });
  if (clearCookie) {
    headers.set(
      "set-cookie",
      oauthCookie("", new URL(request.url).protocol === "https:", 0)
    );
  }
  return new Response(null, { status: 303, headers });
}

export async function handleGoogleClassroomCallback(
  request: Request,
  dependencies: GoogleCallbackDependencies
): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return callbackRedirect(request, "google-declined");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (state.length < 32 || state.length > 512 || !code || code.length > 4_096) {
    return callbackRedirect(request, "google-error");
  }
  try {
    const { session } = await authenticateStudent(
      request,
      dependencies,
      "homeroom_oauth_session"
    );
    await dependencies.complete(session, { state, code });
    return callbackRedirect(request, "google-connected");
  } catch {
    return callbackRedirect(request, "google-error");
  }
}
