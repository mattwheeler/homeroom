import { env } from "cloudflare:workers";

import { generateLearningCoachTurn } from "../../../../lib/ai/learning-coach";
import { createOpenAIResponsesClient } from "../../../../lib/ai/openai-client";
import { LearningSessionError } from "../../../../lib/domain/learning-session";
import { getLearningTrack } from "../../../../lib/domain/learning-tracks";
import { handleLearningTurn } from "../../../../lib/http/learning-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1AiTurnStore } from "../../../../lib/storage/ai-turn-store";
import { D1LearningStore } from "../../../../lib/storage/learning-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 20, windowMs: 60_000, namespace: "learning-turn" });

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
  return handleLearningTurn(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    turn: async (session, input) => {
      const active = await learning.findSession(session.id, input.learningSessionId);
      if (!active || active.status !== "active") {
        throw new LearningSessionError("LEARNING_NOT_FOUND", "The active Learning session was not found.");
      }
      if (Date.parse(active.targetEndsAt) <= Date.now()) {
        throw new LearningSessionError("LEARNING_SESSION_EXPIRED", "The Learning timebox has ended.");
      }
      const context = await learning.listLearnerContext(active.studentId, active.courseId);
      const generated = await generateLearningCoachTurn({
        session,
        learningSession: active,
        track: getLearningTrack(active.courseId),
        learnerContext: context.signals,
        studentResponse: input.response,
        client,
        traceStore: traces
      });
      const nextTurnCount = active.turnCount + 1;
      await learning.appendTurn({
        demoSessionId: session.id,
        learningSessionId: active.id,
        expectedTurnCount: active.turnCount,
        studentResponse: input.response,
        coachTurn: generated.turn,
        nextTurnCount,
        updatedAt: new Date().toISOString()
      });
      return {
        learningSessionId: active.id,
        turnCount: nextTurnCount,
        turn: generated.turn,
        timing: generated.timing,
        memoryUsed: generated.memoryUsed,
        proof: generated.proof
      };
    }
  });
}
