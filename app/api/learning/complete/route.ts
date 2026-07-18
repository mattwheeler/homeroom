import { env } from "cloudflare:workers";

import {
  completeLearningSession,
  LearningSessionError
} from "../../../../lib/domain/learning-session";
import { handleCompleteLearning } from "../../../../lib/http/learning-handler";
import { FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1LearningStore } from "../../../../lib/storage/learning-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new FixedWindowRateLimiter({ limit: 8, windowMs: 60_000 });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Learning is not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const learning = new D1LearningStore(env.HOMEROOM_DB);
  return handleCompleteLearning(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-preview",
    complete: async (session, input) => {
      const active = await learning.findSession(session.id, input.learningSessionId);
      if (!active || active.status !== "active") {
        throw new LearningSessionError("LEARNING_NOT_FOUND", "The active Learning session was not found.");
      }
      const context = await learning.listLearnerContext(active.studentId, active.courseId);
      const prior = context.progress.find(
        (progress) => progress.objectiveId === active.objectiveId
      )?.sessionsCompleted ?? 0;
      const completedAt = new Date().toISOString();
      const completed = completeLearningSession({
        learningSession: active,
        priorSessionsCompleted: prior,
        now: () => new Date(completedAt)
      });
      await learning.completeSession({
        demoSessionId: session.id,
        learningSessionId: active.id,
        expectedTurnCount: active.turnCount,
        completedAt,
        summary: completed.summary,
        signal: completed.signal,
        progress: completed.progress,
        memoryEventId: `memory_${crypto.randomUUID()}`
      });
      return {
        completed: true as const,
        learningSessionId: active.id,
        summary: completed.summary,
        memory: {
          id: completed.signal.id,
          statement: completed.signal.statement,
          why: "Emily selected this support preference when the session began.",
          canDelete: true as const
        },
        progress: completed.progress,
        proof: {
          activeDialogueDeleted: true as const,
          goldenStateUnchanged: true as const,
          goldenStateVersion: session.state.stateVersion
        }
      };
    }
  });
}
