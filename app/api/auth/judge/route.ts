import { env } from "cloudflare:workers";

import { handleJudgeAccess } from "../../../../lib/http/judge-access-handler";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";

function firstEmail(value: string | undefined): string {
  return (value ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return handleJudgeAccess(request, {
    accessCode: env.JUDGE_ACCESS_CODE ?? "",
    signingSecret: env.SESSION_SIGNING_SECRET ?? "",
    studentEmail: firstEmail(env.AUTH_STUDENT_EMAILS),
    guardianEmail: firstEmail(env.AUTH_GUARDIAN_EMAILS),
    rateLimiter: new D1FixedWindowRateLimiter(env.HOMEROOM_DB, {
      limit: 6,
      windowMs: 5 * 60_000,
      namespace: "judge-access"
    }),
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-reviewer",
    secureCookie: url.protocol === "https:",
    logger: new StructuredLogger("judge-access")
  });
}
