import { z } from "zod";

import {
  assertJsonRequest,
  assertSameOrigin,
  HttpSecurityError,
  readCookie
} from "../security/http";
import type { RateLimiter } from "../security/rate-limit";
import { googleOAuthIntentCookie } from "./google-oauth-flow";

const startSchema = z.object({ role: z.enum(["student", "guardian"]) }).strict();

export interface GoogleIdentityStartDependencies {
  rateLimiter: RateLimiter;
  clientKey: string;
  secureCookie: boolean;
  start(role: "student" | "guardian"): Promise<{ authorizationUrl: string; intentToken: string }>;
}

export interface GoogleIdentityCallbackDependencies {
  secureCookie: boolean;
  complete(input: {
    intentToken: string;
    state: string;
    code: string;
  }): Promise<{ identityToken: string; redirectPath: string }>;
}

function json(body: unknown, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

function cookie(input: {
  name: "homeroom_auth_intent" | "homeroom_identity";
  value: string;
  path: string;
  maxAge: number;
  secure: boolean;
}) {
  const parts = [
    `${input.name}=${encodeURIComponent(input.value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${input.path}`,
    `Max-Age=${Math.max(0, Math.floor(input.maxAge))}`
  ];
  if (input.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function handleGoogleIdentityStart(
  request: Request,
  dependencies: GoogleIdentityStartDependencies
): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    if (!(await dependencies.rateLimiter.consume(dependencies.clientKey))) {
      return json({ error: { code: "RATE_LIMITED", message: "Wait a moment before trying to sign in again." } }, 429, { "retry-after": "60" });
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > 1_024) {
      return json({ error: { code: "BODY_TOO_LARGE", message: "The sign-in request is too large." } }, 413);
    }
    let body: z.infer<typeof startSchema>;
    try {
      body = startSchema.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST", message: "Choose a valid Homeroom workspace." } }, 400);
    }
    const result = await dependencies.start(body.role);
    const authorization = new URL(result.authorizationUrl);
    if (authorization.origin !== "https://accounts.google.com") {
      return json({ error: { code: "IDENTITY_UNAVAILABLE", message: "Google sign-in is unavailable." } }, 502);
    }
    const headers = new Headers();
    headers.append(
      "set-cookie",
      googleOAuthIntentCookie({
        name: "homeroom_auth_intent",
        value: result.intentToken,
        maxAge: 10 * 60,
        secure: dependencies.secureCookie
      })
    );
    headers.append(
      "set-cookie",
      googleOAuthIntentCookie({
        name: "homeroom_oauth_session",
        value: "",
        maxAge: 0,
        secure: dependencies.secureCookie
      })
    );
    return json({ authorizationUrl: authorization.toString() }, 200, headers);
  } catch (error) {
    if (error instanceof HttpSecurityError) {
      return json({ error: { code: "REQUEST_REJECTED", message: error.message } }, error.status);
    }
    return json({ error: { code: "IDENTITY_UNAVAILABLE", message: "Google sign-in is unavailable." } }, 502);
  }
}

function redirect(request: Request, path: string, cookies: string[]): Response {
  const headers = new Headers({ location: new URL(path, new URL(request.url).origin).toString(), "cache-control": "no-store" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}

export async function handleGoogleIdentityCallback(
  request: Request,
  dependencies: GoogleIdentityCallbackDependencies
): Promise<Response> {
  const clearIntent = googleOAuthIntentCookie({
    name: "homeroom_auth_intent",
    value: "",
    maxAge: 0,
    secure: dependencies.secureCookie
  });
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return redirect(request, "/?auth=declined", [clearIntent]);
  const intentToken = readCookie(request, "homeroom_auth_intent") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!intentToken || !state || !code || state.length > 512 || code.length > 4_096) {
    return redirect(request, "/?auth=error", [clearIntent]);
  }
  try {
    const result = await dependencies.complete({ intentToken, state, code });
    const destination = result.redirectPath.startsWith("/student") || result.redirectPath.startsWith("/guardian")
      ? result.redirectPath
      : "/?auth=error";
    return redirect(request, destination, [
      clearIntent,
      cookie({
        name: "homeroom_identity",
        value: result.identityToken,
        path: "/",
        maxAge: 8 * 60 * 60,
        secure: dependencies.secureCookie
      })
    ]);
  } catch {
    return redirect(request, "/?auth=error", [clearIntent]);
  }
}
