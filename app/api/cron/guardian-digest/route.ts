import { env } from "cloudflare:workers";

import { handleGuardianDigestCron } from "../../../../lib/http/guardian-digest-cron-handler";
import { sendGuardianDigestEmail } from "../../../../lib/notifications/guardian-digest-email";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1GuardianInboxStore } from "../../../../lib/storage/guardian-inbox-store";

const logger = new StructuredLogger("guardian-digest-cron");

export async function POST(request: Request) {
  return handleGuardianDigestCron(request, {
    cronSecret: env.CRON_SECRET ?? "",
    resendApiKey: env.RESEND_API_KEY ?? "",
    digestFrom: env.GUARDIAN_DIGEST_FROM ?? "",
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, {
      limit: 6,
      windowMs: 15 * 60_000,
      namespace: "guardian-digest-cron"
    }),
    store: new D1GuardianInboxStore(env.HOMEROOM_DB),
    sendEmail: sendGuardianDigestEmail,
    logger
  });
}
