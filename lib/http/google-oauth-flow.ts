import { readCookie } from "../security/http";

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/google/callback";

export type GoogleOAuthIntentCookieName =
  | "homeroom_auth_intent"
  | "homeroom_oauth_session";

export type GoogleOAuthCallbackFlow = "identity" | "classroom" | "invalid";

export function googleOAuthIntentCookie(input: {
  name: GoogleOAuthIntentCookieName;
  value: string;
  maxAge: number;
  secure: boolean;
}): string {
  const parts = [
    `${input.name}=${encodeURIComponent(input.value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${GOOGLE_OAUTH_CALLBACK_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(input.maxAge))}`
  ];
  if (input.secure) parts.push("Secure");
  return parts.join("; ");
}

export function resolveGoogleOAuthCallbackFlow(request: Request): GoogleOAuthCallbackFlow {
  const identityIntent = Boolean(readCookie(request, "homeroom_auth_intent"));
  const classroomIntent = Boolean(readCookie(request, "homeroom_oauth_session"));
  if (identityIntent === classroomIntent) return "invalid";
  return identityIntent ? "identity" : "classroom";
}

export function clearGoogleOAuthIntentCookies(secure: boolean): string[] {
  return [
    googleOAuthIntentCookie({ name: "homeroom_auth_intent", value: "", maxAge: 0, secure }),
    googleOAuthIntentCookie({ name: "homeroom_oauth_session", value: "", maxAge: 0, secure })
  ];
}
