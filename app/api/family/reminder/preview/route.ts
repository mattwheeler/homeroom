import { env } from "cloudflare:workers";

import { stageFamilyReminder } from "../../../../../lib/domain/family-reminder";
import { handlePreviewFamilyReminder } from "../../../../../lib/http/family-reminder-handler";
import { FixedWindowRateLimiter } from "../../../../../lib/security/rate-limit";
import { D1FamilyReminderStore } from "../../../../../lib/storage/family-reminder-store";
import { D1SessionStore } from "../../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 6, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The Family service is not configured." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const reminders = new D1FamilyReminderStore(env.HOMEROOM_DB);
  return handlePreviewFamilyReminder(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    preview: (session) => stageFamilyReminder({ session, store: reminders })
  });
}
