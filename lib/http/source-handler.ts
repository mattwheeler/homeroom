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
import { googleOAuthIntentCookie } from "./google-oauth-flow";

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
  return googleOAuthIntentCookie({
    name: "homeroom_oauth_session",
    value: token,
    secure,
    maxAge: maxAgeSeconds
  });
}

type SourcePermission = "read" | "manage";

async function authenticateSourceActor(
  request: Request,
  dependencies: Pick<BaseDependencies, "store" | "signingSecret" | "now">,
  cookieName: "homeroom_session" | "homeroom_oauth_session",
  permission: SourcePermission
): Promise<{ session: SessionRecord; sessionToken: string }> {
  const sessionToken = readCookie(request, cookieName);
  if (!sessionToken) {
    throw new SessionTokenError("INVALID_SESSION", "A Homeroom session is required.");
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const payload = await verifySessionToken(sessionToken, dependencies.signingSecret, now.getTime());
  if (permission === "manage" && payload.role !== "guardian") {
    throw new SourceConnectionError(
      "SOURCE_SCOPE_MISMATCH",
      "Only Emily's guardian can manage source connections."
    );
  }
  const session = await dependencies.store.findById(payload.sessionId);
  const expectedActorId = payload.role === "guardian" ? "guardian_matt" : "student_emily";
  const identityMatches = session?.principalId
    ? session.actorId === session.principalId
    : session?.actorId === expectedActorId;
  if (
    !session ||
    session.role !== payload.role ||
    !identityMatches ||
    Date.parse(session.expiresAt) < now.getTime()
  ) {
    throw new SessionTokenError("SESSION_EXPIRED", "The Homeroom session is no longer active.");
  }
  return { session, sessionToken };
}

async function readSourceJson<T>(input: {
  request: Request;
  dependencies: BaseDependencies;
  schema: z.ZodType<T>;
  permission: SourcePermission;
}): Promise<AuthenticatedRequest<T> | Response> {
  try {
    assertSameOrigin(input.request);
    assertJsonRequest(input.request);
    if (!(await input.dependencies.rateLimiter.consume(input.dependencies.clientKey))) {
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
    const authenticated = await authenticateSourceActor(
      input.request,
      input.dependencies,
      "homeroom_session",
      input.permission
    );
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
  const authenticated = await readSourceJson({ request, dependencies, schema: emptySchema, permission: "read" });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.snapshot(authenticated.session));
}

export async function handleGoogleClassroomStart(request: Request, dependencies: GoogleStartDependencies) {
  const authenticated = await readSourceJson({ request, dependencies, schema: emptySchema, permission: "manage" });
  if (authenticated instanceof Response) return authenticated;
  const response = await runSource(() => dependencies.start(authenticated.session));
  if (response.ok) {
    response.headers.append(
      "set-cookie",
      oauthCookie(authenticated.sessionToken, new URL(request.url).protocol === "https:", 10 * 60)
    );
    response.headers.append(
      "set-cookie",
      googleOAuthIntentCookie({
        name: "homeroom_auth_intent",
        value: "",
        secure: new URL(request.url).protocol === "https:",
        maxAge: 0
      })
    );
  }
  return response;
}

export async function handleBandCalendarConnection(
  request: Request,
  dependencies: BandConnectionDependencies
) {
  const authenticated = await readSourceJson({ request, dependencies, schema: bandSchema, permission: "manage" });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.connect(authenticated.session, authenticated.body));
}

export async function handleSourceSync(request: Request, dependencies: SourceSyncDependencies) {
  const authenticated = await readSourceJson({ request, dependencies, schema: syncSchema, permission: "manage" });
  if (authenticated instanceof Response) return authenticated;
  return runSource(() => dependencies.sync(authenticated.session, authenticated.body));
}

function callbackRedirect(request: Request, result: string, clearCookie = true): Response {
  const location = new URL(`/guardian?source=${result}#school-sources`, new URL(request.url).origin);
  const headers = new Headers({ location: location.toString(), "cache-control": "no-store" });
  if (clearCookie) {
    headers.set(
      "set-cookie",
      oauthCookie("", new URL(request.url).protocol === "https:", 0)
    );
  }
  return new Response(null, { status: 303, headers });
}

function callbackFailureResult(error: unknown): string {
  if (!(error instanceof SourceConnectionError)) return "google-error";
  switch (error.code) {
    case "SOURCE_OAUTH_EXCHANGE_FAILED":
      return "google-oauth-error";
    case "SOURCE_OAUTH_INVALID_GRANT":
      return "google-invalid-grant";
    case "SOURCE_OAUTH_INVALID_CLIENT":
      return "google-client-error";
    case "SOURCE_OAUTH_TOKEN_REJECTED":
      return "google-token-rejected";
    case "SOURCE_OAUTH_NETWORK_FAILED":
      return "google-network-error";
    case "SOURCE_OAUTH_RESPONSE_INVALID":
      return "google-response-error";
    case "SOURCE_OAUTH_PROVIDER_UNAVAILABLE":
      return "google-provider-unavailable";
    case "SOURCE_CLASSROOM_READ_FAILED":
      return "google-classroom-error";
    case "SOURCE_CONNECTION_SAVE_FAILED":
      return "google-storage-error";
    case "SOURCE_REFRESH_MISSING":
      return "google-refresh-error";
    default:
      return "google-error";
  }
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
    const { session } = await authenticateSourceActor(
      request,
      dependencies,
      "homeroom_oauth_session",
      "manage"
    );
    await dependencies.complete(session, { state, code });
    return callbackRedirect(request, "google-connected");
  } catch (error) {
    return callbackRedirect(request, callbackFailureResult(error));
  }
}
