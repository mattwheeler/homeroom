import { env } from "cloudflare:workers";

import { generatePracticeHint } from "../../../../lib/ai/practice-hint";
import { createOpenAIResponsesClient } from "../../../../lib/ai/openai-client";
import { startPracticeSession } from "../../../../lib/domain/practice";
import { handleStartPractice } from "../../../../lib/http/practice-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../../lib/storage/ai-turn-store";
import { D1PracticeStore } from "../../../../lib/storage/practice-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 4, windowMs: 60_000, namespace: "practice-start" });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32 || !env.OPENAI_API_KEY) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "The live practice service is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessionStore = new D1SessionStore(env.HOMEROOM_DB);
  const practiceStore = new D1PracticeStore(env.HOMEROOM_DB);
  const traceStore = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleStartPractice(request, {
    store: sessionStore,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    start: async (session) => {
      const generated = await generatePracticeHint({ session, client, traceStore });
      const started = await startPracticeSession({ session, store: practiceStore });
      return { ...generated, ...started };
    }
  });
}
