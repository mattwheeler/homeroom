import { z } from "zod";

import { OfficialSchoolConnectionError } from "../domain/official-school-sources";
import { normalizeOfficialSchoolUrl, OfficialSchoolSourceError } from "../source/official-school-calendar";
import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie,
  verifyCsrfToken
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import { SessionTokenError, verifySessionToken } from "../security/session-token";
import type { SchoolSourceProvider } from "../storage/school-source-store";
import type { SessionRecord, SessionStore } from "../storage/session-store";

const officialUrl = z.string().trim().min(1).max(2_048).refine((value) => {
  try {
    normalizeOfficialSchoolUrl(value);
    return true;
  } catch {
    return false;
  }
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect_calendar"),
    schoolUrl: officialUrl,
    districtCalendarUrl: officialUrl
  }).strict(),
  z.object({ action: z.literal("connect_supplies"), sourceUrl: officialUrl }).strict(),
  z.object({
    action: z.literal("sync"),
    provider: z.enum(["school_calendar", "school_supplies"])
  }).strict()
]);

type RequestBody = z.infer<typeof requestSchema>;

export interface OfficialSchoolSourceHandlerDependencies {
  store: SessionStore;
  signingSecret: string;
  rateLimiter: RateLimiter;
  clientKey: string;
  now?: () => Date;
  connectCalendar(
    session: SessionRecord,
    input: Extract<RequestBody, { action: "connect_calendar" }>
  ): Promise<unknown>;
  connectSupplies(
    session: SessionRecord,
    input: Extract<RequestBody, { action: "connect_supplies" }>
  ): Promise<unknown>;
  sync(session: SessionRecord, provider: SchoolSourceProvider): Promise<unknown>;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

async function guardianSession(request: Request, dependencies: OfficialSchoolSourceHandlerDependencies) {
  const token = readCookie(request, "homeroom_session");
  if (!token) throw new SessionTokenError("INVALID_SESSION", "A guardian session is required.");
  const now = (dependencies.now ?? (() => new Date()))();
  const payload = await verifySessionToken(token, dependencies.signingSecret, now.getTime());
  if (payload.role !== "guardian") {
    throw new OfficialSchoolConnectionError("SCHOOL_SOURCE_SCOPE_MISMATCH", "Guardian access is required.");
  }
  const session = await dependencies.store.findById(payload.sessionId);
  if (!session || Date.parse(session.expiresAt) < now.getTime()) {
    throw new SessionTokenError("SESSION_EXPIRED", "The guardian session expired.");
  }
  if (session.role !== "guardian") {
    throw new OfficialSchoolConnectionError("SCHOOL_SOURCE_SCOPE_MISMATCH", "Guardian access is required.");
  }
  return session;
}

export async function handleOfficialSchoolSource(
  request: Request,
  dependencies: OfficialSchoolSourceHandlerDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json({ error: { code: "RATE_LIMITED", message: "Take a short pause before refreshing school sources." } }, 429, { "retry-after": "30" });
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 8_192) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The school source request is too large." } }, 413);
    }
    let body: RequestBody;
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Enter a valid official Comal ISD source." } }, 400);
    }
    const session = await guardianSession(request, dependencies);
    const csrf = request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      return json({ error: { code: "REQUEST_REJECTED", message: "The request could not be verified." } }, 403);
    }
    const result = body.action === "connect_calendar"
      ? await dependencies.connectCalendar(session, body)
      : body.action === "connect_supplies"
        ? await dependencies.connectSupplies(session, body)
        : await dependencies.sync(session, body.provider);
    return json(result, 200);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    if (error instanceof SessionTokenError) {
      return json({ error: { code: "AUTH_REQUIRED", message: "Start a new guardian session." } }, 401);
    }
    if (error instanceof OfficialSchoolConnectionError && error.code === "SCHOOL_SOURCE_SCOPE_MISMATCH") {
      return json({ error: { code: "ROLE_NOT_ALLOWED", message: "Guardian access is required." } }, 403);
    }
    if (error instanceof OfficialSchoolConnectionError || error instanceof OfficialSchoolSourceError) {
      return json({ error: { code: "SCHOOL_SOURCE_UNAVAILABLE", message: error.message } }, 409);
    }
    return json({ error: { code: "SCHOOL_SOURCE_UNAVAILABLE", message: "The official school source could not be updated." } }, 502, { "retry-after": "5" });
  }
}
