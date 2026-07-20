import type { FocusBlockStore } from "../storage/focus-block-store";
import type { TaskSessionKind } from "./task-session-plan";

export async function completeFocusBlock(input: {
  store: FocusBlockStore;
  studentId: string;
  sessionId: string;
  task: {
    id: string;
    title: string;
    courseName: string;
    sourceProvider: string;
    sourceExternalId: string;
    estimatedMinutes: number;
    validChunkIds: string[];
    plannedChunkCount: number;
    taskKind: TaskSessionKind;
    sourceStatus: string;
  };
  selectedMinutes: number;
  elapsedSeconds: number;
  completedChunkIds: string[];
  now?: () => Date;
  randomUUID?: () => string;
}) {
  const completedChunkIds = [...new Set(input.completedChunkIds)]
    .filter((id) => input.task.validChunkIds.includes(id));
  if (completedChunkIds.length === 0) throw new Error("Complete at least one visible chunk before saving focus.");
  const record = {
    id: input.randomUUID?.() ?? crypto.randomUUID(),
    studentId: input.studentId,
    sessionId: input.sessionId,
    taskId: input.task.id,
    taskTitle: input.task.title,
    courseName: input.task.courseName,
    sourceProvider: input.task.sourceProvider,
    sourceExternalId: input.task.sourceExternalId,
    estimatedMinutes: Math.max(1, Math.round(input.task.estimatedMinutes)),
    selectedMinutes: Math.max(1, Math.min(60, Math.round(input.selectedMinutes))),
    elapsedSeconds: Math.max(0, Math.min(4 * 60 * 60, Math.round(input.elapsedSeconds))),
    completedChunkIds,
    completedChunkCount: completedChunkIds.length,
    plannedChunkCount: Math.max(completedChunkIds.length, Math.round(input.task.plannedChunkCount)),
    taskKind: input.task.taskKind,
    sourceStatus: input.task.sourceStatus,
    completedAt: (input.now ?? (() => new Date()))().toISOString()
  };
  return input.store.save(record);
}

export function buildReentry(input: { lastFocusAt: string | null; now: Date; nextTaskTitle: string }) {
  if (!input.lastFocusAt) return { active: false as const, title: "", message: "", missedDayCount: 0 };
  const elapsedDays = Math.max(0, Math.floor((input.now.getTime() - new Date(input.lastFocusAt).getTime()) / 86_400_000));
  const missedDayCount = Math.max(0, elapsedDays - 1);
  if (missedDayCount < 2) return { active: false as const, title: "", message: "", missedDayCount };
  return {
    active: true as const,
    title: "Today is a new start.",
    message: `No catching up all at once. Let’s begin with ${input.nextTaskTitle}.`,
    missedDayCount
  };
}
