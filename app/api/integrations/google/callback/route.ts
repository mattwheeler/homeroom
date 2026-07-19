import { env } from "cloudflare:workers";

import { completeGoogleClassroomConnection } from "../../../../../lib/domain/source-connections";
import { handleGoogleClassroomCallback } from "../../../../../lib/http/source-handler";
import { D1SessionStore } from "../../../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../../../lib/storage/source-connection-store";

export async function GET(request: Request) {
  if (
    !env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.SOURCE_TOKEN_ENCRYPTION_KEY || env.SOURCE_TOKEN_ENCRYPTION_KEY.length < 32 ||
    !env.GOOGLE_CLASSROOM_CLIENT_ID ||
    !env.GOOGLE_CLASSROOM_CLIENT_SECRET ||
    !env.GOOGLE_IDENTITY_REDIRECT_URI
  ) {
    return Response.redirect(new URL("/?source=google-not-configured#sources", request.url), 303);
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
