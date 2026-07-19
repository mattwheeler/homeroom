import { env } from "cloudflare:workers";

import { completeGoogleIdentityAuthorization } from "../../../../../lib/auth/google-identity";
import { completeGoogleClassroomConnection } from "../../../../../lib/domain/source-connections";
import {
  clearGoogleOAuthIntentCookies,
  resolveGoogleOAuthCallbackFlow
} from "../../../../../lib/http/google-oauth-flow";
import { handleGoogleIdentityCallback } from "../../../../../lib/http/google-identity-handler";
import { handleGoogleClassroomCallback } from "../../../../../lib/http/source-handler";
import { D1SessionStore } from "../../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../../lib/storage/source-connection-store";

function emails(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export async function GET(request: Request) {
  const secureCookie = new URL(request.url).protocol === "https:";
  const flow = resolveGoogleOAuthCallbackFlow(request);
  if (flow === "invalid") {
    const headers = new Headers({
      location: new URL("/?auth=error", request.url).toString(),
      "cache-control": "no-store"
    });
    for (const value of clearGoogleOAuthIntentCookies(secureCookie)) {
      headers.append("set-cookie", value);
    }
    return new Response(null, { status: 303, headers });
  }
  if (
    !env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.GOOGLE_CLASSROOM_CLIENT_ID ||
    !env.GOOGLE_CLASSROOM_CLIENT_SECRET ||
    !env.GOOGLE_IDENTITY_REDIRECT_URI
  ) {
    return new Response(null, {
      status: 303,
      headers: { location: new URL("/?auth=not-configured", request.url).toString(), "cache-control": "no-store" }
    });
  }
  if (flow === "classroom") {
    if (!env.SOURCE_TOKEN_ENCRYPTION_KEY || env.SOURCE_TOKEN_ENCRYPTION_KEY.length < 32) {
      return Response.redirect(new URL("/guardian?source=google-not-configured#school-sources", request.url), 303);
    }
    const sessions = new D1SessionStore(env.HOMEROOM_DB);
    const sources = new D1SourceConnectionStore(env.HOMEROOM_DB);
    return handleGoogleClassroomCallback(request, {
      store: sessions,
      signingSecret: env.SESSION_SIGNING_SECRET,
      complete: (session, input) => completeGoogleClassroomConnection({
        session,
        ...input,
        store: sources,
        sourceEncryptionSecret: env.SOURCE_TOKEN_ENCRYPTION_KEY!,
        googleClientId: env.GOOGLE_CLASSROOM_CLIENT_ID!,
        googleClientSecret: env.GOOGLE_CLASSROOM_CLIENT_SECRET!,
        googleRedirectUri: env.GOOGLE_IDENTITY_REDIRECT_URI!
      })
    });
  }
  return handleGoogleIdentityCallback(request, {
    secureCookie,
    complete: (input) => completeGoogleIdentityAuthorization({
      ...input,
      clientId: env.GOOGLE_CLASSROOM_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLASSROOM_CLIENT_SECRET!,
      redirectUri: env.GOOGLE_IDENTITY_REDIRECT_URI!,
      signingSecret: env.SESSION_SIGNING_SECRET!,
      guardianEmails: emails(env.AUTH_GUARDIAN_EMAILS),
      studentEmails: emails(env.AUTH_STUDENT_EMAILS)
    })
  });
}
