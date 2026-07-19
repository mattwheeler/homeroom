import { env } from "cloudflare:workers";
import { z } from "zod";

import { buildReentry, completeFocusBlock } from "../../../lib/domain/focus-block";
import { projectStudentSources } from "../../../lib/domain/student-source-projection";
import { emilyFixture } from "../../../lib/domain/fixtures";
import { emilyStudentSupportProfile } from "../../../lib/domain/student-support-profile";
import { authenticatedSession, AuthenticatedSessionError } from "../../../lib/http/authenticated-session";
import { StructuredLogger } from "../../../lib/observability/logger";
import { assertJsonRequest, assertSameOrigin, HttpSecurityError } from "../../../lib/security/http";
import { D1FixedWindowRateLimiter } from "../../../lib/security/rate-limit";
import { SessionTokenError } from "../../../lib/security/session-token";
import { D1FocusBlockStore } from "../../../lib/storage/focus-block-store";
import { D1SchoolSourceStore } from "../../../lib/storage/school-source-store";
import { D1SessionStore } from "../../../lib/storage/session-store";
import { D1SourceConnectionStore } from "../../../lib/storage/source-connection-store";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({
    action: z.literal("complete"),
    priorityId: z.string().min(1).max(512),
    selectedMinutes: z.number().int().min(1).max(60),
    elapsedSeconds: z.number().int().min(0).max(14_400),
    completedChunkIds: z.array(z.string().min(1).max(512)).min(1).max(20)
  }).strict()
]);

const logger = new StructuredLogger("focus-blocks");

export async function POST(request: Request) {
  try {
    if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) throw new Error("Identity is not configured.");
    assertSameOrigin(request);
    assertJsonRequest(request);
    const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 40, windowMs: 60_000, namespace: "focus-blocks" });
    if (!(await limiter.consume(request.headers.get("cf-connecting-ip") ?? "local"))) {
      return Response.json({ error: { code: "RATE_LIMITED", message: "Take a short pause before saving focus." } }, { status: 429 });
    }
    const sessions = new D1SessionStore(env.HOMEROOM_DB);
    const session = await authenticatedSession({ request, store: sessions, signingSecret: env.SESSION_SIGNING_SECRET, role: "student" });
    if (!(await limiter.consume(`session:${session.id}`))) {
      return Response.json({ error: { code: "RATE_LIMITED", message: "Take a short pause before saving focus." } }, { status: 429 });
    }
    const body = schema.parse(await request.json());
    const studentId = session.studentId ?? session.actorId;
    const focus = new D1FocusBlockStore(env.HOMEROOM_DB);
    const rows = await focus.listRecent(studentId);
    const [snapshot, schoolSnapshot] = await Promise.all([
      new D1SourceConnectionStore(env.HOMEROOM_DB).getStudentSnapshot(studentId),
      new D1SchoolSourceStore(env.HOMEROOM_DB).getStudentSnapshot(studentId)
    ]);
    const projection = projectStudentSources({
      snapshot,
      schoolSnapshot,
      profile: { ...emilyStudentSupportProfile, timeZone: emilyFixture.timeZone, supportPreference: "example_first" },
      now: new Date()
    });
    if (body.action === "list") {
      return Response.json({
        focusBlocks: rows,
        reentry: buildReentry({
          lastFocusAt: rows[0]?.completedAt ?? null,
          now: new Date(),
          nextTaskTitle: projection.priorities[0]?.title ?? "one small next step"
        })
      });
    }
    const task = projection.priorities.find((item) => item.id === body.priorityId);
    if (!task) return Response.json({ error: { code: "TASK_CHANGED", message: "This task changed in the school source. Refresh Today before saving." } }, { status: 409 });
    const record = await completeFocusBlock({
      store: focus,
      studentId,
      sessionId: session.id,
      task: {
        id: task.id,
        title: task.title,
        courseName: task.course.name,
        sourceProvider: task.source.provider,
        sourceExternalId: task.source.externalId,
        estimatedMinutes: task.effort.estimatedMinutes,
        validChunkIds: task.chunks.map((chunk) => chunk.id)
      },
      selectedMinutes: body.selectedMinutes,
      elapsedSeconds: body.elapsedSeconds,
      completedChunkIds: body.completedChunkIds
    });
    return Response.json({ focusBlock: record, reentry: buildReentry({ lastFocusAt: record.completedAt, now: new Date(), nextTaskTitle: projection.priorities[0]?.title ?? "one small next step" }) });
  } catch (error) {
    logger.error("request_failed", error);
    if (error instanceof AuthenticatedSessionError) return Response.json({ error: { code: "AUTH_REQUIRED", message: error.message } }, { status: error.status });
    if (error instanceof HttpSecurityError) return Response.json({ error: { code: "REQUEST_REJECTED", message: error.message } }, { status: error.status });
    if (error instanceof SessionTokenError) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in again." } }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid focus-block request." } }, { status: 400 });
    return Response.json({ error: { code: "FOCUS_UNAVAILABLE", message: "Your focus could not be saved yet." } }, { status: 500 });
  }
}
