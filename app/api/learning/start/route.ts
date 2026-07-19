import { env } from "cloudflare:workers";

import { generateLearningCoachTurn } from "../../../../lib/ai/learning-coach";
import { createOpenAIResponsesClient } from "../../../../lib/ai/openai-client";
import { createLearningSession } from "../../../../lib/domain/learning-session";
import { handleStartLearning } from "../../../../lib/http/learning-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../../lib/storage/ai-turn-store";
import { D1LearningStore } from "../../../../lib/storage/learning-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 6, windowMs: 60_000, namespace: "learning-start" });

export async function POST(request: Request) {
  if (
    !env.SESSION_SIGNING_SECRET ||
    env.SESSION_SIGNING_SECRET.length < 32 ||
    !env.OPENAI_API_KEY
  ) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Live Learning is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const learning = new D1LearningStore(env.HOMEROOM_DB);
  const traces = new D1AiTurnStore(env.HOMEROOM_DB);
  const client = createOpenAIResponsesClient(env.OPENAI_API_KEY);
  return handleStartLearning(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    start: async (session, input) => {
      const context = await learning.listLearnerContext(session.actorId, input.courseId);
      const created = createLearningSession({
        session,
        ...input,
        existingSignals: context.signals
      });
      const generated = await generateLearningCoachTurn({
        session,
        learningSession: created.learningSession,
        track: created.track,
        learnerContext: created.learnerContext,
        client,
        traceStore: traces
      });
      await learning.startSession({
        learningSession: created.learningSession,
        initialTurn: generated.turn,
        updatedAt: new Date().toISOString()
      });
      return {
        learningSession: {
          id: created.learningSession.id,
          courseId: created.learningSession.courseId,
          durationMinutes: created.learningSession.durationMinutes,
          targetEndsAt: created.learningSession.targetEndsAt,
          turnCount: 0,
          status: "active" as const
        },
        track: created.track,
        turn: generated.turn,
        timing: generated.timing,
        learnerContext: created.learnerContext.map((signal) => ({
          id: signal.id,
          statement: signal.statement,
          learnedAt: signal.learnedAt
        })),
        proof: { ...created.proof, ...generated.proof }
      };
    }
  });
}
